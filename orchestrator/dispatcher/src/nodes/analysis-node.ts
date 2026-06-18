import { callModel, MODELS } from "@mammoth/agent-base";
import type { CompanyCycleState, CeoAnalysis } from "../company-state.ts";

const ANALYSIS_SYSTEM_PROMPT = `You are the CEO Brain — a strategic AI that analyzes company performance.

Given a company snapshot, produce a concise situation analysis. Be direct and specific.
Do not repeat metrics back — synthesize them into insight.

Respond with JSON only:
{
  "situationSummary": "2-3 sentence company health summary focused on goal attainment",
  "isOnTrack": true/false,
  "topConstraint": "The single biggest thing blocking goal attainment right now",
  "shouldPivot": true/false,
  "pivotReason": "Why a strategy change is needed (empty string if shouldPivot is false)",
  "confidence": 0.0-1.0
}`;

/**
 * Analysis node — second node in the CEO Brain planning graph.
 * Calls Claude Sonnet to analyze the company snapshot and determine:
 * - Whether the company is on track to hit its goal
 * - The top constraint blocking progress
 * - Whether a pivot is needed
 *
 * Requires snapshot to be populated. Routes to END on no active goal.
 */
export async function analysisNode(
  state: CompanyCycleState
): Promise<Partial<CompanyCycleState>> {
  const { companyId, snapshot } = state;

  if (!snapshot?.hasActiveGoal) {
    return {
      analysis: {
        situationSummary: "No active goal set. Recommend founder sets a revenue goal to activate autonomous operations.",
        isOnTrack: false,
        topConstraint: "No active goal",
        shouldPivot: false,
        pivotReason: "",
        confidence: 1.0,
      },
    };
  }

  const deadline = new Date(snapshot.deadlineDate);
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  const daysLeftStr = daysLeft > 0 ? `${daysLeft} days remaining` : "deadline passed";

  const deptSummary = snapshot.deptStatuses
    .map((d) => `  ${d.name}: ${d.status} (last run: ${d.lastRunAt ?? "never"})`)
    .join("\n");

  const decisionsSummary = snapshot.recentDecisions.length > 0
    ? snapshot.recentDecisions.map((d) => `  - ${d.title}: ${d.decision}`).join("\n")
    : "  No prior decisions.";

  const userMessage = `COMPANY GOAL:
${snapshot.goalTitle}
Target: ${snapshot.targetValue} ${snapshot.goalUnit} | Current: ${snapshot.currentValue} ${snapshot.goalUnit}
Progress: ${snapshot.progressPct}% | ${daysLeftStr}

LATEST METRICS:
MRR: $${snapshot.latestMrr}
Active Customers: ${snapshot.activeCustomers}
AI Cost Today: $${snapshot.aiCostUsdToday}
Tasks Run Today: ${snapshot.tasksRunToday}

DEPARTMENT STATUS:
${deptSummary}

RECENT STRATEGIC DECISIONS:
${decisionsSummary}

Analyze this situation. Return only the JSON object.`;

  const result = await callModel({
    model: MODELS.SONNET,
    companyId,
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 1024,
  });

  const analysis = parseAnalysis(result.content);
  return { analysis };
}

function parseAnalysis(content: string): CeoAnalysis {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const raw = JSON.parse(match[0]) as unknown;
    if (typeof raw !== "object" || raw === null) throw new Error("not object");
    const obj = raw as Record<string, unknown>;
    return {
      situationSummary: String(obj["situationSummary"] ?? ""),
      isOnTrack: Boolean(obj["isOnTrack"]),
      topConstraint: String(obj["topConstraint"] ?? ""),
      shouldPivot: Boolean(obj["shouldPivot"]),
      pivotReason: String(obj["pivotReason"] ?? ""),
      confidence: Number(obj["confidence"] ?? 0.5),
    };
  } catch {
    return {
      situationSummary: content.slice(0, 500),
      isOnTrack: false,
      topConstraint: "Analysis parse failed — review manually",
      shouldPivot: false,
      pivotReason: "",
      confidence: 0.2,
    };
  }
}
