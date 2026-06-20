import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks so vi.mock factories can reference them ─────────────────────
// vi.hoisted() runs before any imports, so these fns are safe to use inside
// vi.mock() factories below.

const mockCallLlm = vi.hoisted(() => vi.fn());
const mockUpdateGoalProgress = vi.hoisted(() => vi.fn());
const mockGenerateBriefing = vi.hoisted(() => vi.fn());
const mockUpsertMemory = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────
// We replace every module that touches the DB, LLM, or external services.
// Tests stay fast and deterministic — no API keys or database needed.

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-test",
      taskId: "task-test",
      agentRunId: "run-test",
    };
    protected companyCtx = {
      companyId: "comp-test",
      companyName: "Acme Corp",
      brandVoice: null,
      brandVoiceMemory: null,
    };
    protected knowledgeContext = "";
    protected currentTaskRoute = {
      model: "claude-sonnet-4-6",
      maxOutputTokens: 8192,
      cacheSystemPrompt: true,
      contextScope: "full",
    };

    constructor(
      protected readonly departmentName: string,
      protected readonly defaultModel: string
    ) {}

    // run() sets context then delegates to execute() — same as production
    async run(ctx: unknown, input: unknown) {
      this.runCtx = ctx as typeof this.runCtx;
      return (this as unknown as { execute(i: unknown): Promise<unknown> }).execute(input);
    }

    protected buildSystemPrompt(role: string): string {
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

vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      companyGoals: {
        findFirst: vi.fn().mockResolvedValue({
          id: "goal-1",
          title: "Reach $1M ARR",
          targetValue: "1000000",
          currentValue: "250000",
          unit: "USD",
          deadline: "2026-12-31",
          status: "active",
          companyId: "comp-test",
        }),
      },
      metricsDaily: {
        findMany: vi.fn().mockResolvedValue([
          {
            date: "2026-06-19",
            mrr: 20833,
            activeCustomers: 42,
            newCustomers: 5,
            churnedCustomers: 1,
            aiCostUsd: 3.5,
            tasksRun: 28,
          },
        ]),
      },
      departments: {
        findMany: vi.fn().mockResolvedValue([
          { name: "sales", status: "idle", lastRunAt: new Date() },
          { name: "marketing", status: "idle", lastRunAt: null },
        ]),
      },
      strategyDecisions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
  companyGoals: {},
  metricsDaily: {},
  departments: {},
  strategyDecisions: {},
}));

vi.mock("@mammoth/memory-retrieval", () => ({
  upsertMemory: mockUpsertMemory.mockResolvedValue(undefined),
}));

vi.mock("./goal-progress-tracker.ts", () => ({
  updateGoalProgress: mockUpdateGoalProgress.mockResolvedValue(undefined),
}));

vi.mock("./briefing-generator.ts", () => ({
  generateBriefing: mockGenerateBriefing.mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid CEO Brain output that passes CeoOutputSchema validation
const VALID_CEO_JSON = JSON.stringify({
  situationSummary: "Company is 25% toward the $1M ARR goal. MRR is growing steadily.",
  isOnTrack: true,
  topConstraint: "Sales pipeline needs more qualified leads.",
  priorities: [
    { department: "sales", focus: "lead generation", weeklyTarget: "50 qualified leads" },
    { department: "marketing", focus: "content to drive inbound", weeklyTarget: "2 blog posts" },
  ],
  decisionsNeeded: [],
  marketAlerts: ["Competitor X raised $10M last week."],
  confidence: 0.85,
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-test",
  taskId: "task-test",
  agentRunId: "run-test",
};

const TASK_INPUT: AgentTaskInput = {
  taskType: "ceo_strategy_cycle",
  parameters: {},
};

// ─── Import after mocks are set up ───────────────────────────────────────────
const { CeoBrainAgent } = await import("./ceo-brain-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CeoBrainAgent — success path", () => {
  let agent: InstanceType<typeof CeoBrainAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_CEO_JSON,
      promptTokens: 500,
      completionTokens: 300,
      costUsd: 0.005,
      model: "claude-sonnet-4-6",
    });
    agent = new CeoBrainAgent();
  });

  it("completes the strategy cycle and returns a valid AgentTaskOutput", async () => {
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    expect(output).toBeDefined();
    expect(output).toHaveProperty("content");
    expect(output).toHaveProperty("ringLevel");
    expect(output).toHaveProperty("confidence");
  });

  it("returns Ring 1 when company is on track", async () => {
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    // isOnTrack: true → CEO Brain assigns Ring 1 (no founder oversight needed)
    expect(output.ringLevel).toBe(1);
  });

  it("returns Ring 2 when company is off track", async () => {
    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({ ...JSON.parse(VALID_CEO_JSON), isOnTrack: false }),
      promptTokens: 500,
      completionTokens: 300,
      costUsd: 0.005,
      model: "claude-sonnet-4-6",
    });

    const output = await agent.run(RUN_CTX, TASK_INPUT);
    // isOnTrack: false → escalates to Ring 2 so founder can review priorities
    expect(output.ringLevel).toBe(2);
  });

  it("calls updateGoalProgress to keep goal currentValue fresh", async () => {
    await agent.run(RUN_CTX, TASK_INPUT);
    expect(mockUpdateGoalProgress).toHaveBeenCalledWith("comp-test");
  });

  it("writes department priorities into company memory", async () => {
    await agent.run(RUN_CTX, TASK_INPUT);
    // One upsertMemory call per priority
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "comp-test",
        memoryType: "playbook_refinement",
      })
    );
  });

  it("uses a confidence value between 0 and 1", async () => {
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(output.confidence).toBeLessThanOrEqual(1);
  });

  it("falls back gracefully when LLM returns unparseable text", async () => {
    mockCallLlm.mockResolvedValueOnce({
      content: "I cannot process this request right now.",
      promptTokens: 50,
      completionTokens: 10,
      costUsd: 0.0001,
      model: "claude-sonnet-4-6",
    });

    // Should not throw — parseOutput() has a safe fallback
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    expect(output).toBeDefined();
    // Fallback confidence is 0.3
    expect(output.confidence).toBe(0.3);
  });
});

describe("CeoBrainAgent — output structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_CEO_JSON,
      promptTokens: 500,
      completionTokens: 300,
      costUsd: 0.005,
      model: "claude-sonnet-4-6",
    });
  });

  it("actionType is always 'ceo_strategy_cycle'", async () => {
    const agent = new CeoBrainAgent();
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    expect(output.actionType).toBe("ceo_strategy_cycle");
  });

  it("summary includes isOnTrack, topConstraint, priorityCount, decisionsNeeded", async () => {
    const agent = new CeoBrainAgent();
    const output = await agent.run(RUN_CTX, TASK_INPUT);

    expect(output.summary).toMatchObject({
      isOnTrack: true,
      topConstraint: expect.any(String),
      priorityCount: expect.any(Number),
      decisionsNeeded: expect.any(Number),
    });
  });

  it("approvalRequired is true when any decision requires approval", async () => {
    const withDecision = {
      ...JSON.parse(VALID_CEO_JSON),
      decisionsNeeded: [
        { description: "Hire VP Sales", recommendation: "Hire now", requiresApproval: true },
      ],
    };
    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify(withDecision),
      promptTokens: 500,
      completionTokens: 300,
      costUsd: 0.005,
      model: "claude-sonnet-4-6",
    });

    const agent = new CeoBrainAgent();
    const output = await agent.run(RUN_CTX, TASK_INPUT);
    expect(output.approvalRequired).toBe(true);
  });
});
