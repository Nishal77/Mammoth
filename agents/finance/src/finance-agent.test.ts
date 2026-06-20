import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-finance",
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
      model: "claude-haiku-4-5-20251001",
      maxOutputTokens: 4096,
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

    // Finance agent is READ-ONLY — createApproval should never be called
    protected async createApproval() {
      throw new Error("Finance agent must never create approvals — it is read-only by architecture.");
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

// Finance agent reads metrics from the database — mock the DB layer
vi.mock("@mammoth/memory-database", () => {
  const metricsRow = {
    mrr: 20833,
    arr: 249996,
    newMrr: 2500,
    churnedMrr: 300,
    activeCustomers: 42,
    aiCostUsd: 3.50,
    newCustomers: 5,
    churnedCustomers: 1,
    date: "2026-06-19",
  };
  const goalsRows = [
    { title: "Reach $1M ARR", targetValue: "1000000", currentValue: "249996", unit: "USD" },
  ];

  // where() must be thenable (so `await db.select().from(goals).where()` works)
  // AND have .orderBy().limit() (for `db.select().from(metrics).where().orderBy().limit()`)
  const whereResult = {
    then(
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown
    ) {
      // when awaited directly → goals array
      try { resolve(goalsRows); } catch (e) { reject?.(e); }
    },
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([metricsRow]),
    }),
    limit: vi.fn().mockResolvedValue([metricsRow]),
  };

  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereResult),
        }),
      }),
    },
    metricsDaily: {},
    companyGoals: {},
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid financial report matching FinancialReportSchema
const VALID_FINANCIAL_REPORT_JSON = JSON.stringify({
  period: "30d",
  mrrGrowthRate: 12.5,
  burnRate: 45000,
  runway: "18 months",
  topRevenueDrivers: ["Pro plan subscriptions", "Enterprise upsells"],
  costOptimizationOpportunities: ["Reduce idle K8s nodes", "Switch to reserved instances"],
  keyInsights: [
    "MRR grew 12.5% vs last month",
    "Churn rate dropped from 2.1% to 1.4%",
    "AI cost per customer is $0.08/day — well within budget",
  ],
  alerts: [
    { severity: "info", message: "CAC increased 15% this month — monitor next cycle" },
  ],
});

// Valid burn analysis
const VALID_BURN_JSON = JSON.stringify({
  period: "30d",
  topRevenueDrivers: ["SaaS subscriptions"],
  costOptimizationOpportunities: ["Consolidate Redis instances"],
  keyInsights: ["Monthly burn is $45k against $65k budget"],
  alerts: [{ severity: "warning", message: "Infrastructure costs up 20% month-over-month" }],
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-finance",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { FinanceAgent } = await import("./finance-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FinanceAgent — financial_report task", () => {
  let agent: InstanceType<typeof FinanceAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_FINANCIAL_REPORT_JSON,
      promptTokens: 500,
      completionTokens: 400,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new FinanceAgent();
  });

  it("generates a financial report successfully", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "financial_report",
      parameters: { period: "30d" },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("financial reports are Ring 1 — read-only analysis, no external action", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "financial_report",
      parameters: { period: "30d" },
    });

    // Finance is read-only by architecture — Ring 1 always
    expect(output.ringLevel).toBe(1);
    expect(output.approvalRequired).toBe(false);
  });

  it("actionType is 'financial_report'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "financial_report",
      parameters: {},
    });

    expect(output.actionType).toBe("financial_report");
  });
});

describe("FinanceAgent — burn_analysis task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_BURN_JSON,
      promptTokens: 300,
      completionTokens: 200,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("burn analysis is Ring 1 — internal report only", async () => {
    const agent = new FinanceAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "burn_analysis",
      parameters: { period: "30d" },
    });

    expect(output.ringLevel).toBe(1);
  });
});

describe("FinanceAgent — revenue_analysis task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_FINANCIAL_REPORT_JSON,
      promptTokens: 400,
      completionTokens: 300,
      costUsd: 0.003,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("revenue analysis succeeds", async () => {
    const agent = new FinanceAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "revenue_analysis",
      parameters: { breakdown: "by_plan" },
    });

    expect(output).toBeDefined();
    expect(output.ringLevel).toBe(1);
  });
});

describe("FinanceAgent — architecture constraint: read-only", () => {
  it("never creates approvals — finance has no write tools", async () => {
    // createApproval() on our mock throws — if the agent calls it, this test fails.
    // That's intentional: Finance must be read-only by architecture, not configuration.
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_FINANCIAL_REPORT_JSON,
      promptTokens: 300,
      completionTokens: 200,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });

    const agent = new FinanceAgent();
    await expect(
      agent.run(RUN_CTX, { taskType: "financial_report", parameters: {} })
    ).resolves.toBeDefined();
  });
});

describe("FinanceAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new FinanceAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "wire_transfer", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Finance agent does not handle task type: wire_transfer");
  });
});
