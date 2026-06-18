import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput, AgentTaskOutput } from "./base-agent.ts";
import { BaseAgent } from "./base-agent.ts";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// We mock every module that touches the database or external services.
// This gives us a fast, deterministic smoke test of the agent lifecycle
// without needing a real database, Redis, or Anthropic API key.

vi.mock("@mammoth/db", () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    query: {
      metricsDaily: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
  departmentTasks: {},
  taskRuns: {},
  agentRuns: {},
}));

vi.mock("../memory/memory-loader.ts", () => ({
  loadCompanyContext: vi.fn().mockResolvedValue({
    companyId: "comp-test",
    companyName: "Test Co",
    mission: "Build great software",
    identityMemory: [],
    brandMemory: [],
    customerMemory: [],
    competitorMemory: [],
    recentDecisions: [],
  }),
  formatContextForPrompt: vi.fn().mockReturnValue("MOCKED CONTEXT"),
}));

vi.mock("../router/model-router.ts", () => ({
  callModel: vi.fn().mockResolvedValue({
    content: "Mocked LLM response",
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 0.001,
    model: "claude-haiku-4-5-20251001",
  }),
  MODELS: {
    SONNET: "claude-sonnet-4-6",
    HAIKU: "claude-haiku-4-5-20251001",
    GPT4O_MINI: "gpt-4o-mini",
    EMBEDDING: "text-embedding-3-small",
  },
}));

vi.mock("../goal/outcome-capturer.ts", () => ({
  captureOutcome: vi.fn().mockResolvedValue(undefined),
}));

// ─── Concrete test agent ──────────────────────────────────────────────────────

// Minimal concrete subclass that exercises the BaseAgent lifecycle.
class TestAgent extends BaseAgent {
  public executeCallCount = 0;
  public shouldThrow = false;

  constructor() {
    super("test-department");
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    this.executeCallCount++;

    if (this.shouldThrow) {
      throw new Error("agent execute failed");
    }

    return {
      content: `Completed task: ${input.taskType}`,
      summary: { taskType: input.taskType },
      approvalRequired: false,
      ringLevel: 1,
      actionType: input.taskType,
      confidence: 0.9,
    };
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-test",
  taskId: "task-test",
  agentRunId: "run-test",
};

describe("BaseAgent.run() — success path", () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent();
    vi.clearAllMocks();
  });

  it("calls execute() exactly once", async () => {
    await agent.run(RUN_CTX, { taskType: "write_blog_post", parameters: {} });
    expect(agent.executeCallCount).toBe(1);
  });

  it("returns the output from execute()", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "write_blog_post",
      parameters: {},
    });
    expect(output.content).toBe("Completed task: write_blog_post");
    expect(output.ringLevel).toBe(1);
    expect(output.confidence).toBe(0.9);
  });

  it("returns approvalRequired: false for Ring 1 output", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "draft_email",
      parameters: {},
    });
    expect(output.approvalRequired).toBe(false);
  });
});

describe("BaseAgent.run() — failure path", () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent();
    agent.shouldThrow = true;
    vi.clearAllMocks();
  });

  it("re-throws the error from execute()", async () => {
    await expect(
      agent.run(RUN_CTX, { taskType: "failing_task", parameters: {} })
    ).rejects.toThrow("agent execute failed");
  });

  it("still calls execute() once before throwing", async () => {
    await expect(
      agent.run(RUN_CTX, { taskType: "failing_task", parameters: {} })
    ).rejects.toThrow();
    expect(agent.executeCallCount).toBe(1);
  });
});

describe("BaseAgent.buildSystemPrompt()", () => {
  it("includes the department name and role description", async () => {
    // Access protected method via type assertion — valid for unit testing internals.
    const agent = new TestAgent() as unknown as {
      buildSystemPrompt: (role: string) => string;
      companyCtx: { companyName: string };
    };

    // Pre-load the company context (normally done inside run()).
    agent.companyCtx = {
      companyName: "Test Co",
    } as never;

    const prompt = agent.buildSystemPrompt("You generate blog posts.");
    expect(prompt).toContain("test-department");
    expect(prompt).toContain("You generate blog posts.");
  });
});
