import { db, companyMemory, companies } from "@mammoth/memory-database";
import { eq, and, isNull, or, desc, gt } from "drizzle-orm";
import { NotFoundError } from "@mammoth/shared/errors";
import { semanticSearch } from "./semantic-search.ts";

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
  marketIntel: string;
  customerInsights: string;
  playbooks: string;
  // New: operational memory types
  sops: string;
  pricing: string;
  decisionLog: string;
  // New: semantically retrieved memory (top-k relevant to the company goal)
  semanticContext: string;
};

/**
 * Loads structured company memory for injection into agent prompts.
 * Fetches up to 500 memory rows plus a semantic search pass on the active goal.
 * Agents always get both structural memory (DB) and relevant semantic memory (Qdrant).
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
        or(isNull(companyMemory.expiresAt), gt(companyMemory.expiresAt, new Date()))
      ),
      columns: {
        memoryType: true,
        key: true,
        value: true,
        confidence: true,
        updatedAt: true,
      },
      orderBy: [desc(companyMemory.updatedAt)],
      limit: 500,
    }),
    db.query.companyGoals.findFirst({
      where: (g, { eq: geq, and: gand }) =>
        gand(geq(g.companyId, companyId), geq(g.status, "active")),
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

  const byType = (type: string, limit = 10) =>
    memoryRows
      .filter((m) => m.memoryType === type)
      .slice(0, limit)
      .map((m) => `[${m.key}] ${String(m.value).slice(0, 800)}`)
      .join("\n");

  // Semantic search on the active goal for relevant memory not captured by exact type filters
  let semanticContext = "";
  if (goalRow) {
    const query = `${goalRow.title} ${goalRow.targetValue}`;
    const semanticResults = await semanticSearch(companyId, query, 5);
    semanticContext = semanticResults
      .map((r) => `[${r.memoryType}/${r.key}] ${r.value.slice(0, 400)}`)
      .join("\n");
  }

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
    identity: byType("identity", 5) || company.tagline || "",
    icp: byType("icp", 5),
    competitors: byType("competitor", 8),
    brandVoiceMemory: byType("brand_voice", 3),
    recentLessons: byType("product_lesson", 10),
    marketIntel: byType("market_intel", 8),
    customerInsights: byType("customer_insight", 8),
    playbooks: byType("playbook_refinement", 5),
    sops: byType("sop", 10),
    pricing: byType("pricing", 5),
    decisionLog: byType("decision_log", 10),
    semanticContext,
  };
}

/**
 * Formats the full company context for non-department-specific use (CEO Brain, briefings).
 */
export function formatContextForPrompt(ctx: CompanyContext): string {
  const lines: string[] = [
    `Company: ${ctx.companyName}`,
    ctx.goal
      ? `Active Goal: ${ctx.goal.title} — target ${ctx.goal.targetValue} ${ctx.goal.unit} by ${ctx.goal.deadline} (current: ${ctx.goal.currentValue})`
      : "No active goal set.",
  ];

  if (ctx.identity) lines.push(`Identity:\n${ctx.identity}`);
  if (ctx.brandVoice) lines.push(`Brand Voice: ${ctx.brandVoice}`);
  else if (ctx.brandVoiceMemory) lines.push(`Brand Voice:\n${ctx.brandVoiceMemory}`);
  if (ctx.icp) lines.push(`Ideal Customer Profile:\n${ctx.icp}`);
  if (ctx.competitors) lines.push(`Competitive Landscape:\n${ctx.competitors}`);
  if (ctx.marketIntel) lines.push(`Market Intelligence:\n${ctx.marketIntel}`);
  if (ctx.customerInsights) lines.push(`Customer Insights:\n${ctx.customerInsights}`);
  if (ctx.recentLessons) lines.push(`Product Lessons:\n${ctx.recentLessons}`);
  if (ctx.pricing) lines.push(`Pricing:\n${ctx.pricing}`);
  if (ctx.sops) lines.push(`SOPs:\n${ctx.sops}`);
  if (ctx.decisionLog) lines.push(`Decision Log:\n${ctx.decisionLog}`);
  if (ctx.playbooks) lines.push(`Department Playbooks:\n${ctx.playbooks}`);
  if (ctx.semanticContext) lines.push(`Related Context (semantic):\n${ctx.semanticContext}`);

  return lines.join("\n\n");
}

/**
 * Returns only the memory sections relevant to a specific department.
 * Each department gets exactly the context it needs — no cross-contamination.
 * Knowledge docs are pulled by the base-agent separately via retrieveKnowledge().
 *
 * @param ctx        - Full company context from loadCompanyContext
 * @param department - The department requesting context
 */
export function formatContextForDepartment(
  ctx: CompanyContext,
  department: string
): string {
  const base = [
    `Company: ${ctx.companyName}`,
    ctx.goal
      ? `Goal: ${ctx.goal.title} — ${ctx.goal.currentValue}/${ctx.goal.targetValue} ${ctx.goal.unit} by ${ctx.goal.deadline}`
      : "No active goal.",
    ctx.identity ? `Identity: ${ctx.identity}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const dept = department.toLowerCase();

  const deptSections: Record<string, string[]> = {
    sales: [
      ctx.icp ? `ICP:\n${ctx.icp}` : "",
      ctx.customerInsights ? `Customer Insights:\n${ctx.customerInsights}` : "",
      ctx.competitors ? `Competitors:\n${ctx.competitors}` : "",
      ctx.pricing ? `Pricing:\n${ctx.pricing}` : "",
      ctx.playbooks ? `Sales Playbooks:\n${ctx.playbooks}` : "",
      ctx.decisionLog ? `Past Decisions:\n${ctx.decisionLog}` : "",
    ],
    marketing: [
      ctx.brandVoice ? `Brand Voice: ${ctx.brandVoice}` : ctx.brandVoiceMemory,
      ctx.icp ? `ICP:\n${ctx.icp}` : "",
      ctx.competitors ? `Competitors:\n${ctx.competitors}` : "",
      ctx.marketIntel ? `Market Intel:\n${ctx.marketIntel}` : "",
      ctx.playbooks ? `Marketing Playbooks:\n${ctx.playbooks}` : "",
    ],
    research: [
      ctx.competitors ? `Known Competitors:\n${ctx.competitors}` : "",
      ctx.marketIntel ? `Existing Market Intel:\n${ctx.marketIntel}` : "",
      ctx.decisionLog ? `Past Research Decisions:\n${ctx.decisionLog}` : "",
    ],
    content: [
      ctx.brandVoice ? `Brand Voice: ${ctx.brandVoice}` : ctx.brandVoiceMemory,
      ctx.icp ? `Audience:\n${ctx.icp}` : "",
      ctx.marketIntel ? `Market Context:\n${ctx.marketIntel}` : "",
      ctx.playbooks ? `Content Playbooks:\n${ctx.playbooks}` : "",
    ],
    support: [
      ctx.customerInsights ? `Customer Context:\n${ctx.customerInsights}` : "",
      ctx.recentLessons ? `Known Issues:\n${ctx.recentLessons}` : "",
      ctx.sops ? `Support SOPs:\n${ctx.sops}` : "",
    ],
    engineering: [
      ctx.recentLessons ? `Engineering Lessons:\n${ctx.recentLessons}` : "",
      ctx.sops ? `Engineering SOPs:\n${ctx.sops}` : "",
      ctx.playbooks ? `Engineering Playbooks:\n${ctx.playbooks}` : "",
    ],
    hr: [
      ctx.identity ? `Company Culture:\n${ctx.identity}` : "",
      ctx.sops ? `HR SOPs:\n${ctx.sops}` : "",
      ctx.playbooks ? `Hiring Playbooks:\n${ctx.playbooks}` : "",
    ],
    finance: [
      ctx.recentLessons ? `Business Context:\n${ctx.recentLessons}` : "",
      ctx.pricing ? `Pricing Model:\n${ctx.pricing}` : "",
      ctx.decisionLog ? `Financial Decisions:\n${ctx.decisionLog}` : "",
    ],
    ceo: [
      ctx.icp ? `ICP:\n${ctx.icp}` : "",
      ctx.competitors ? `Competitors:\n${ctx.competitors}` : "",
      ctx.marketIntel ? `Market Intel:\n${ctx.marketIntel}` : "",
      ctx.recentLessons ? `Recent Lessons:\n${ctx.recentLessons}` : "",
      ctx.decisionLog ? `Decision Log:\n${ctx.decisionLog}` : "",
      ctx.pricing ? `Pricing:\n${ctx.pricing}` : "",
    ],
  };

  const sections = (deptSections[dept] ?? []).filter(Boolean).join("\n\n");
  const withSemantic = ctx.semanticContext
    ? `${sections}\n\nRelated Context:\n${ctx.semanticContext}`
    : sections;

  return withSemantic ? `${base}\n\n${withSemantic}` : base;
}
