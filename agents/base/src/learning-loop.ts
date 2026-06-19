import { db, agentLearningSignals, companyMemory, companies } from "@mammoth/memory-database";
import { eq, and, desc, sql, isNull, or, gt } from "drizzle-orm";
import { upsertMemory } from "@mammoth/memory-retrieval";
import { callModel, MODELS } from "./model-router.js";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("learning-loop");

/** Minimum unprocessed signals before synthesis is triggered. */
export const MIN_SIGNALS_FOR_SYNTHESIS = 5;

export type WriteLearningSignalOptions = {
  companyId: string;
  department: string;
  actionType: string;
  signalType: "approved" | "vetoed" | "modified" | "eval_pass" | "eval_fail";
  originalContent: string;
  correctedContent?: string;
  correctionNote?: string;
  evalScore?: number;
};

/**
 * Appends a founder feedback or eval result to the learning signal stream.
 * Returns the total count of unprocessed signals for this company+department
 * so the caller can decide whether to trigger a synthesis cycle.
 *
 * @returns Unprocessed signal count after insert
 */
export async function writeLearningSignal(
  options: WriteLearningSignalOptions
): Promise<number> {
  await db.insert(agentLearningSignals).values({
    companyId: options.companyId,
    department: options.department,
    actionType: options.actionType,
    signalType: options.signalType,
    originalContent: options.originalContent.slice(0, 3000),
    correctedContent: options.correctedContent?.slice(0, 3000),
    correctionNote: options.correctionNote?.slice(0, 500),
    evalScore: options.evalScore?.toString(),
  });

  const [row] = await db
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(agentLearningSignals)
    .where(
      and(
        eq(agentLearningSignals.companyId, options.companyId),
        eq(agentLearningSignals.department, options.department),
        eq(agentLearningSignals.isProcessed, false)
      )
    );

  return parseInt(row?.count ?? "0", 10);
}

/**
 * Finds all (companyId, department) pairs with enough unprocessed signals
 * to justify a synthesis cycle.
 */
export async function findDepartmentsReadyToLearn(): Promise<
  { companyId: string; department: string }[]
> {
  return db
    .select({
      companyId: agentLearningSignals.companyId,
      department: agentLearningSignals.department,
    })
    .from(agentLearningSignals)
    .where(eq(agentLearningSignals.isProcessed, false))
    .groupBy(agentLearningSignals.companyId, agentLearningSignals.department)
    .having(sql`COUNT(*) >= ${MIN_SIGNALS_FOR_SYNTHESIS}`);
}

/**
 * Core learning cycle for one department.
 *
 * 1. Fetch unprocessed signals — founder approvals, vetoes, modifications, eval results.
 * 2. Fetch recent product lessons already in memory.
 * 3. Call Claude to synthesize behavioral rules from the evidence.
 * 4. Upsert the rules as a `playbook_refinement` memory entry.
 * 5. Mark all processed signals — they contributed to this synthesis round.
 *
 * Runs in the background — never throws to caller.
 * On LLM failure, signals stay unprocessed and get picked up in the next cycle.
 *
 * @param companyId  - Company to synthesize for
 * @param department - Department name (lowercase, e.g. "sales", "marketing")
 */
export async function synthesizeDepartmentPlaybook(
  companyId: string,
  department: string
): Promise<void> {
  const signals = await db.query.agentLearningSignals.findMany({
    where: and(
      eq(agentLearningSignals.companyId, companyId),
      eq(agentLearningSignals.department, department),
      eq(agentLearningSignals.isProcessed, false)
    ),
    orderBy: [desc(agentLearningSignals.createdAt)],
    limit: 30,
    columns: {
      id: true,
      actionType: true,
      signalType: true,
      originalContent: true,
      correctedContent: true,
      correctionNote: true,
      evalScore: true,
      createdAt: true,
    },
  });

  if (signals.length < MIN_SIGNALS_FOR_SYNTHESIS) return;

  const recentLessons = await db.query.companyMemory.findMany({
    where: and(
      eq(companyMemory.companyId, companyId),
      eq(companyMemory.memoryType, "product_lesson"),
      or(isNull(companyMemory.expiresAt), gt(companyMemory.expiresAt, new Date()))
    ),
    orderBy: [desc(companyMemory.updatedAt)],
    limit: 10,
    columns: { key: true, value: true },
  });

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { name: true },
  });

  const companyName = company?.name ?? companyId;

  const formattedSignals = signals
    .map((s, i) => {
      const date = s.createdAt.toISOString().slice(0, 10);
      const base = `[${i + 1}] ${date} | ${s.signalType.toUpperCase()} | action: ${s.actionType}`;

      if (s.signalType === "modified" && s.correctedContent) {
        const note = s.correctionNote ? `\n    Founder note: ${s.correctionNote}` : "";
        return `${base}\n    Original: ${s.originalContent.slice(0, 300)}\n    Founder changed to: ${s.correctedContent.slice(0, 300)}${note}`;
      }

      if (s.signalType === "eval_fail") {
        return `${base} | eval score: ${s.evalScore}\n    Content: ${s.originalContent.slice(0, 200)}`;
      }

      return `${base}\n    Content: ${s.originalContent.slice(0, 200)}`;
    })
    .join("\n\n");

  const formattedLessons = recentLessons.length > 0
    ? recentLessons.map((l) => `[${l.key}] ${l.value.slice(0, 300)}`).join("\n")
    : "No prior lessons captured yet.";

  const vetoes = signals.filter((s) => s.signalType === "vetoed").length;
  const modifications = signals.filter((s) => s.signalType === "modified").length;
  const approvals = signals.filter((s) => s.signalType === "approved").length;
  const evalFails = signals.filter((s) => s.signalType === "eval_fail").length;

  const systemPrompt = `You are the continuous learning engine for the ${department} department AI agent at ${companyName}.

Your job is to analyze recent founder feedback and completed action history to extract behavioral rules that will improve this department's future outputs.

You write rules that are specific, actionable, and grounded in the evidence provided.
You never write vague rules like "be better" or "improve quality".
You always explain WHAT specifically changed and WHY based on real signals.`;

  const userMessage = `SIGNAL SUMMARY (${signals.length} signals):
- Approved unmodified: ${approvals}
- Modified by founder: ${modifications}
- Vetoed: ${vetoes}
- Eval gate failures: ${evalFails}

RECENT FOUNDER FEEDBACK SIGNALS:
${formattedSignals}

RECENT COMPLETED ACTIONS (from memory):
${formattedLessons}

Based on this evidence, generate 3-8 specific behavioral rules for the ${department} department agent.
Each rule must be directly supported by at least one signal above.

Respond with a JSON array ONLY — no markdown, no explanation outside the array:
[
  {
    "rule": "Specific actionable instruction for the agent",
    "evidence": "Which signal(s) support this (max 80 chars)",
    "priority": "high|medium|low"
  }
]`;

  let synthesisText: string;

  try {
    const callResult = await callModel({
      model: MODELS.HAIKU,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 1500,
      companyId,
    });
    synthesisText = callResult.content;
  } catch (error) {
    log.errorWithStack(
      "Learning synthesis LLM call failed — signals stay unprocessed",
      error as Error,
      { companyId, department }
    );
    return;
  }

  const playbookText = parseAndFormatRules(synthesisText, department);
  if (!playbookText) {
    log.warn("Could not parse synthesis output — skipping upsert", { companyId, department });
    return;
  }

  const cycleDate = new Date().toISOString().slice(0, 10);
  const key = `${department}:auto-refined:${cycleDate}`;

  await upsertMemory({
    companyId,
    memoryType: "playbook_refinement",
    key,
    value: playbookText,
    source: "learning-loop",
    confidence: 0.85,
  });

  // Mark signals as processed — they are now folded into the playbook.
  // Use an ANY($1::uuid[]) clause so IDs are parameterised, not interpolated.
  const processedIds = signals.map((s) => s.id);
  await db
    .update(agentLearningSignals)
    .set({ isProcessed: true })
    .where(
      and(
        eq(agentLearningSignals.companyId, companyId),
        sql`${agentLearningSignals.id} = ANY(ARRAY[${sql.join(processedIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
      )
    );

  log.info("Learning cycle complete", {
    companyId,
    department,
    signalsProcessed: signals.length,
    playbookKey: key,
  });
}

type PlaybookRule = { rule: string; evidence: string; priority: string };

function parseAndFormatRules(rawLlmOutput: string, department: string): string | null {
  const jsonMatch = rawLlmOutput.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;

  let rules: PlaybookRule[];
  try {
    rules = JSON.parse(jsonMatch[0]) as PlaybookRule[];
  } catch {
    return null;
  }

  if (!Array.isArray(rules) || rules.length === 0) return null;

  const header = `# ${department.charAt(0).toUpperCase() + department.slice(1)} Department — Auto-Refined Playbook\nGenerated: ${new Date().toISOString().slice(0, 10)}\n`;
  const body = rules
    .filter((r) => typeof r.rule === "string" && r.rule.length > 5)
    .map((r, i) => `${i + 1}. [${(r.priority ?? "medium").toUpperCase()}] ${r.rule}\n   Evidence: ${r.evidence ?? "n/a"}`)
    .join("\n\n");

  return `${header}\n${body}`;
}
