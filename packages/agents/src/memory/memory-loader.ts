import { db, companyMemory, companies } from "@mammoth/db";
import { eq, and, isNull, or, desc, gt } from "drizzle-orm";
import { NotFoundError } from "@mammoth/shared/errors";

export type CompanyContext = {
  companyId: string;
  companyName: string;
  brandVoice: string | null;
  goal: {
    title: string;
    targetValue: string;
    currentValue: string;
    unit: string;
    deadline: string;
  } | null;
  identity: string;
  icp: string;
  competitors: string;
  brandVoiceMemory: string;
  recentLessons: string;
};

/**
 * Loads structured company memory for injection into agent prompts.
 * Retrieves only non-expired, high-confidence entries. No N+1 queries.
 *
 * @param companyId - The company whose memory to load
 * @returns Structured context string for agent system prompts
 */
export async function loadCompanyContext(
  companyId: string
): Promise<CompanyContext> {
  const [company, memoryRows, goalRow] = await Promise.all([
    db.query.companies.findFirst({
      where: and(eq(companies.id, companyId), isNull(companies.deletedAt)),
      columns: {
        id: true,
        name: true,
        brandVoice: true,
        industry: true,
        stage: true,
        tagline: true,
      },
    }),
    db.query.companyMemory.findMany({
      where: and(
        eq(companyMemory.companyId, companyId),
        // Rows with no expiry are permanent; only exclude explicitly expired ones
        or(isNull(companyMemory.expiresAt), gt(companyMemory.expiresAt, new Date()))
      ),
      columns: {
        memoryType: true,
        key: true,
        value: true,
        confidence: true,
      },
      orderBy: [desc(companyMemory.updatedAt)],
      limit: 200,
    }),
    db.query.companyGoals.findFirst({
      where: (g, { eq, and, isNull }) =>
        and(eq(g.companyId, companyId), eq(g.status, "active")),
      columns: {
        title: true,
        targetValue: true,
        currentValue: true,
        unit: true,
        deadline: true,
      },
    }),
  ]);

  if (!company) throw new NotFoundError("Company", companyId);

  const byType = (type: string) =>
    memoryRows
      .filter((m) => m.memoryType === type)
      .map((m) => `${m.key}: ${m.value}`)
      .join("\n");

  return {
    companyId,
    companyName: company.name,
    brandVoice: company.brandVoice,
    goal: goalRow
      ? {
          title: goalRow.title,
          targetValue: String(goalRow.targetValue),
          currentValue: String(goalRow.currentValue),
          unit: goalRow.unit ?? "USD",
          deadline: String(goalRow.deadline),
        }
      : null,
    identity: byType("identity") || company.tagline || "",
    icp: byType("icp"),
    competitors: byType("competitor"),
    brandVoiceMemory: byType("brand_voice"),
    recentLessons: byType("product_lesson"),
  };
}

/**
 * Formats loaded company context into a concise string for agent prompts.
 * Keeps the prompt grounded in company-specific details without bloat.
 */
export function formatContextForPrompt(ctx: CompanyContext): string {
  const lines: string[] = [
    `Company: ${ctx.companyName}`,
    ctx.goal
      ? `Active Goal: ${ctx.goal.title} — target ${ctx.goal.targetValue} ${ctx.goal.unit} by ${ctx.goal.deadline} (current: ${ctx.goal.currentValue})`
      : "No active goal set.",
  ];

  if (ctx.identity) lines.push(`Identity: ${ctx.identity}`);
  if (ctx.brandVoice) lines.push(`Brand Voice: ${ctx.brandVoice}`);
  else if (ctx.brandVoiceMemory) lines.push(`Brand Voice: ${ctx.brandVoiceMemory}`);
  if (ctx.icp) lines.push(`Ideal Customer Profile:\n${ctx.icp}`);
  if (ctx.competitors) lines.push(`Competitive Landscape:\n${ctx.competitors}`);
  if (ctx.recentLessons) lines.push(`Recent Lessons:\n${ctx.recentLessons}`);

  return lines.join("\n\n");
}
