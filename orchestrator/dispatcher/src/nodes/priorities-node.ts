import { callModel, MODELS } from "@mammoth/agent-base";
import type { CompanyCycleState } from "../company-state.ts";
import type { DepartmentPriority } from "../department-dispatcher.ts";

type RawPriority = {
  department: string;
  focus: string;
  weeklyTarget: string;
};

const ALL_DEPARTMENTS = [
  "marketing", "sales", "engineering", "support",
  "finance", "research", "hr", "content",
] as const;

const PRIORITIES_SYSTEM_PROMPT = `You are the CEO Brain — a strategic AI setting department priorities.

Given a company situation analysis and goal status, assign weekly priorities to the right departments.
Only activate departments where there is high-leverage work this cycle.
Do not assign busywork. Every priority must connect directly to the goal.

Return JSON only:
{
  "priorities": [
    {
      "department": "marketing|sales|engineering|support|finance|research|hr|content",
      "focus": "specific focus area for this week (1-2 sentences)",
      "weeklyTarget": "one measurable outcome (e.g., 'generate 20 qualified leads', '3 blog posts published')"
    }
  ]
}

Rules:
- If shouldPivot is true: ALL departments get updated priorities aligned to the new direction
- If off-track: prioritize revenue-generating departments first (sales, marketing)
- If on-track: maintain momentum, look for optimisation opportunities
- Finance is always read-only — include it for reporting
- Max 6 departments per cycle to avoid spreading too thin`;

/**
 * Priorities node — third node in the CEO Brain planning graph.
 * Uses snapshot + analysis to generate per-department weekly priorities.
 * This output feeds directly into dispatchDepartmentTasks.
 *
 * Activates only departments where there is genuine high-leverage work.
 * Pivot detected → all departments realigned to new strategic direction.
 */
export async function prioritiesNode(
  state: CompanyCycleState
): Promise<Partial<CompanyCycleState>> {
  const { companyId, snapshot, analysis } = state;

  if (!snapshot || !analysis) {
    return { priorities: [] };
  }

  const activeDepts = snapshot.deptStatuses
    .filter((d) => d.status === "active")
    .map((d) => d.name)
    .join(", ");

  const userMessage = `SITUATION:
${analysis.situationSummary}

ON TRACK: ${analysis.isOnTrack ? "Yes" : "No"}
TOP CONSTRAINT: ${analysis.topConstraint}
PIVOT NEEDED: ${analysis.shouldPivot ? `Yes — ${analysis.pivotReason}` : "No"}
CONFIDENCE: ${Math.round(analysis.confidence * 100)}%

GOAL PROGRESS: ${snapshot.progressPct}% toward ${snapshot.targetValue} ${snapshot.goalUnit}
DAYS TO DEADLINE: ${Math.ceil((new Date(snapshot.deadlineDate).getTime() - Date.now()) / 86_400_000)}

ACTIVE DEPARTMENTS: ${activeDepts || ALL_DEPARTMENTS.join(", ")}

Assign weekly priorities. Return only the JSON object.`;

  const result = await callModel({
    model: MODELS.SONNET,
    companyId,
    systemPrompt: PRIORITIES_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 2048,
  });

  const priorities = parsePriorities(result.content);
  return { priorities };
}

function parsePriorities(content: string): DepartmentPriority[] {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const raw = JSON.parse(match[0]) as unknown;
    if (typeof raw !== "object" || raw === null) throw new Error("not object");
    const obj = raw as Record<string, unknown>;
    const arr = obj["priorities"];
    if (!Array.isArray(arr)) throw new Error("priorities not array");

    return arr
      .filter(
        (item): item is RawPriority =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>)["department"] === "string" &&
          typeof (item as Record<string, unknown>)["focus"] === "string" &&
          typeof (item as Record<string, unknown>)["weeklyTarget"] === "string"
      )
      .map((item) => ({
        department: item.department.toLowerCase(),
        focus: item.focus,
        weeklyTarget: item.weeklyTarget,
      }));
  } catch {
    return [];
  }
}
