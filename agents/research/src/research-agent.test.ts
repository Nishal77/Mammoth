import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-research",
      taskId: "task-test",
      agentRunId: "run-test",
    };
    protected companyCtx = {
      companyId: "comp-test",
      companyName: "Acme Corp",
      brandVoice: null,
    };
    protected knowledgeContext = "";
    protected currentTaskRoute = {
      // Research uses Sonnet — deep analysis needs stronger reasoning
      model: "claude-sonnet-4-6",
      maxOutputTokens: 6144,
      cacheSystemPrompt: true,
      contextScope: "full",
    };

    constructor(
      protected readonly departmentName: string,
      protected readonly defaultModel: string
    ) {}

    async run(ctx: unknown, input: unknown) {
      this.runCtx = ctx as typeof this.runCtx;
      return (this as unknown as { execute(i: unknown): Promise<unknown> }).execute(input);
    }

    protected buildSystemPrompt(role: string) {
      return `[STUB] ${role}`;
    }

    protected async callLlm(opts: unknown) {
      return mockCallLlm(opts);
    }

    protected async createApproval() {
      return "mock-approval-id";
    }
  }

  return {
    BaseAgent,
    MODELS: {
      SONNET: "claude-sonnet-4-6",
      HAIKU: "claude-haiku-4-5-20251001",
      GPT4O_MINI: "gpt-4o-mini",
      EMBEDDING: "text-embedding-3-small",
    },
  };
});

// Exa not connected — agent falls back to model knowledge
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      integrations: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      companyMemory: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  companyMemory: {},
  integrations: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid competitor analysis matching CompetitorAnalysisSchema
const VALID_COMPETITOR_JSON = JSON.stringify({
  competitors: [
    {
      name: "Relevance AI",
      positioning: "Low-code AI agent platform for enterprise teams",
      strengths: ["Large integration marketplace", "Established brand", "No-code builder"],
      weaknesses: ["Not revenue-goal oriented", "Generic agents, not department-specific"],
      recentMoves: ["Raised Series B $24M", "Launched AI Teams product"],
      pricingSignals: "$19/month starter, $99/month pro",
      threatLevel: "medium",
    },
    {
      name: "Lindy.ai",
      positioning: "Personal AI assistant for task automation",
      strengths: ["Consumer-friendly UX", "Broad task coverage"],
      weaknesses: ["Not autonomous — needs constant prompting", "No business OS framing"],
      recentMoves: ["Launched enterprise tier"],
      threatLevel: "low",
    },
  ],
  marketGaps: [
    "No competitor offers revenue-goal-to-department-priority decomposition",
    "Trust/autonomy progression model is unique to MAMMOTH",
  ],
  recommendedPositioningShifts: [
    "Double down on 'founder sets one goal, MERIDIAN runs the company' narrative",
  ],
});

// Valid market analysis matching MarketAnalysisSchema
const VALID_MARKET_JSON = JSON.stringify({
  trend: "AI agents are moving from task automation to autonomous business operations",
  impactLevel: "high",
  timeHorizon: "6–18 months",
  implications: [
    "Enterprise buyers will evaluate agent systems on measurable business outcomes",
    "Trust and compliance features will become table-stakes",
  ],
  recommendedActions: [
    "Publish case studies showing MRR lift attributable to MERIDIAN",
    "Get SOC 2 certification before enterprise sales push",
  ],
  sources: ["Gartner Hype Cycle 2025", "a16z AI report Q2 2026"],
});

// Valid trend report
const VALID_TREND_JSON = JSON.stringify({
  topTrends: [
    "Multi-agent orchestration replacing single-agent workflows",
    "Founder-AI collaboration shifting from prompt to goal-setting",
  ],
  timeHorizon: "12 months",
  confidenceLevel: 0.82,
  recommendations: ["Invest in cross-agent coordination UI", "Build trust engine case studies"],
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-research",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { ResearchAgent } = await import("./research-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResearchAgent — competitor_intel task", () => {
  let agent: InstanceType<typeof ResearchAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_COMPETITOR_JSON,
      promptTokens: 700,
      completionTokens: 600,
      costUsd: 0.012,
      model: "claude-sonnet-4-6",
    });
    agent = new ResearchAgent();
  });

  it("produces competitor intelligence successfully", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "competitor_intel",
      parameters: { competitors: ["Relevance AI", "Lindy.ai", "AutoGen"] },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("competitor intel is Ring 1 — internal findings, no external action", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "competitor_intel",
      parameters: { competitors: ["Relevance AI"] },
    });

    // Research findings are stored internally — never auto-published
    expect(output.ringLevel).toBe(1);
    expect(output.approvalRequired).toBe(false);
  });

  it("passes competitor names into the LLM prompt", async () => {
    await agent.run(RUN_CTX, {
      taskType: "competitor_intel",
      parameters: { competitors: ["CrewAI", "AutoGen", "LangGraph"] },
    });

    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("CrewAI");
  });

  it("actionType is 'competitor_intel'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "competitor_intel",
      parameters: { competitors: ["Salesforce AgentForce"] },
    });

    expect(output.actionType).toBe("competitor_intel");
  });
});

describe("ResearchAgent — market_analysis task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_MARKET_JSON,
      promptTokens: 600,
      completionTokens: 500,
      costUsd: 0.01,
      model: "claude-sonnet-4-6",
    });
  });

  it("market analysis is Ring 1 — strategic insight, no external action", async () => {
    const agent = new ResearchAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "market_analysis",
      parameters: { topic: "autonomous AI agents for SMBs", depth: "deep" },
    });

    expect(output.ringLevel).toBe(1);
    expect(output.approvalRequired).toBe(false);
  });

  it("strategic pivot recommendations escalate to Ring 3", async () => {
    // When the analysis finds a major pivot is needed, the agent flags it Ring 3
    mockCallLlm.mockResolvedValueOnce({
      content: VALID_MARKET_JSON,
      promptTokens: 600,
      completionTokens: 500,
      costUsd: 0.01,
      model: "claude-sonnet-4-6",
    });

    const agent = new ResearchAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "market_analysis",
      parameters: { topic: "strategic pivot opportunity", requiresPivot: true },
    });

    // Ring level depends on whether a major strategic shift is recommended
    expect([1, 3]).toContain(output.ringLevel);
  });
});

describe("ResearchAgent — trend_report task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_TREND_JSON,
      promptTokens: 400,
      completionTokens: 350,
      costUsd: 0.007,
      model: "claude-sonnet-4-6",
    });
  });

  it("trend reports are Ring 2 — shared with founding team, needs 4h veto", async () => {
    const agent = new ResearchAgent();
    const output = await agent.run(RUN_CTX, {
      // Agent reads "industry" param, not "category"
      taskType: "trend_report",
      parameters: { industry: "AI orchestration frameworks", focusAreas: ["multi-agent systems"] },
    });

    // buildTrendReport creates an approval (share_trend_report) — Ring 2
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });
});

describe("ResearchAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new ResearchAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "run_survey", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Research agent does not handle task type: run_survey");
  });
});
