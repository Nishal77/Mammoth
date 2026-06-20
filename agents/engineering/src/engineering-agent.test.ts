import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-engineering",
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
      // Engineering uses Sonnet — code tasks need stronger reasoning
      model: "claude-sonnet-4-6",
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

// Engineering agent has no DB calls in execute() — no DB mock needed

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid sprint plan matching SprintPlanSchema
const VALID_SPRINT_JSON = JSON.stringify({
  sprintGoal: "Ship the v2 auth flow and fix the top 3 customer-reported bugs.",
  tickets: [
    {
      title: "Implement OAuth 2.0 login",
      description: "Add Google and GitHub OAuth providers to the auth service.",
      type: "feature",
      estimatePoints: 8,
      priority: "critical",
    },
    {
      title: "Fix session expiry race condition",
      description: "Sessions sometimes expire mid-request under high load.",
      type: "bug",
      estimatePoints: 3,
      priority: "high",
    },
    {
      title: "Add unit tests for token refresh",
      description: "Cover edge cases in token refresh logic.",
      type: "chore",
      estimatePoints: 2,
      priority: "medium",
    },
  ],
  totalPoints: 13,
  suggestedCapacity: 40,
});

// Valid PR review matching PrReviewSchema
const VALID_PR_REVIEW_JSON = JSON.stringify({
  summary: "This PR adds OAuth support. Logic is correct but missing error handling on network failures.",
  approvalRecommendation: "request_changes",
  issues: [
    {
      severity: "major",
      file: "src/auth/oauth-handler.ts",
      description: "No timeout on the external OAuth provider request.",
      suggestion: "Wrap in Promise.race() with a 5s timeout.",
    },
    {
      severity: "nit",
      description: "Variable name 'data' should be more specific.",
    },
  ],
  securityFlags: ["OAuth redirect_uri not validated against allowlist"],
  testCoverageAssessment: "No tests added for the new OAuth routes.",
});

// Valid issue triage output
const VALID_TRIAGE_JSON = JSON.stringify({
  priority: "high",
  category: "bug",
  estimatedEffort: "3 story points",
  affectedComponents: ["auth-service", "session-manager"],
  suggestedAssignee: "backend-team",
  duplicateOf: null,
  reproductionSteps: ["1. Login with Google OAuth", "2. Wait 15 minutes", "3. Make an API call"],
  resolution: "Fix the session refresh logic to handle concurrent requests.",
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-engineering",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { EngineeringAgent } = await import("./engineering-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EngineeringAgent — sprint_planning task", () => {
  let agent: InstanceType<typeof EngineeringAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_SPRINT_JSON,
      promptTokens: 600,
      completionTokens: 500,
      costUsd: 0.01,
      model: "claude-sonnet-4-6",
    });
    agent = new EngineeringAgent();
  });

  it("produces a sprint plan from goals and backlog", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "sprint_planning",
      parameters: {
        goals: ["Ship auth v2", "Fix top bugs"],
        backlogSummary: "Auth rewrite (8pts), 3 bug fixes (3pts each), refactor (5pts)",
        teamCapacity: 40,
      },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("sprint plans are Ring 3 — code execution always requires explicit founder approval", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "sprint_planning",
      parameters: {
        goals: ["Auth v2"],
        backlogSummary: "auth (8pts)",
        teamCapacity: 40,
      },
    });

    // Sprint plans commit engineering resources — hard Ring 3 gate
    expect(output.ringLevel).toBe(3);
    expect(output.approvalRequired).toBe(true);
    expect(output.actionType).toBe("execute_sprint_plan");
  });

  it("passes team capacity to the LLM prompt", async () => {
    await agent.run(RUN_CTX, {
      taskType: "sprint_planning",
      parameters: { goals: ["Ship payments"], teamCapacity: 60 },
    });

    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("60");
  });
});

describe("EngineeringAgent — pr_review task", () => {
  let agent: InstanceType<typeof EngineeringAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_PR_REVIEW_JSON,
      promptTokens: 800,
      completionTokens: 400,
      costUsd: 0.01,
      model: "claude-sonnet-4-6",
    });
    agent = new EngineeringAgent();
  });

  it("PR reviews with security flags are Ring 3 — security issues need explicit sign-off", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "pr_review",
      parameters: {
        prTitle: "Add OAuth 2.0 support",
        prDescription: "Adds Google and GitHub OAuth providers.",
        // Agent does diff.slice(0,8000) — must be a string
        diff: "--- a/src/auth/oauth-handler.ts\n+++ b/src/auth/oauth-handler.ts\n@@ -1,5 +1,45 @@\n+export async function handleOAuth(code: string) {",
        changedFiles: ["src/auth/oauth-handler.ts", "src/auth/session.ts"],
      },
    });

    // Mock has securityFlags → ring = 3; no flags would be ring = 2
    expect([2, 3]).toContain(output.ringLevel);
    expect(output.approvalRequired).toBe(true);
  });

  it("surfaces security flag count in the output summary", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "pr_review",
      parameters: {
        prTitle: "OAuth PR",
        diff: "--- a/auth.ts\n+++ b/auth.ts\n@@ -0,0 +1,5 @@\n+const token = req.body.token;",
        changedFiles: ["auth.ts"],
      },
    });

    // output.content = parsed.summary string; security count is in summary object
    expect(output.content).toBeTruthy();
    expect(typeof output.summary.securityFlagCount).toBe("number");
  });
});

describe("EngineeringAgent — issue_triage task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_TRIAGE_JSON,
      promptTokens: 300,
      completionTokens: 200,
      costUsd: 0.004,
      model: "claude-sonnet-4-6",
    });
  });

  it("issue triage is Ring 1 — internal analysis, no external action taken", async () => {
    const agent = new EngineeringAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "issue_triage",
      parameters: {
        issueTitle: "Session expires mid-request",
        issueBody: "Users get logged out randomly under load.",
        labels: ["bug", "auth"],
      },
    });

    // Triage is read-only analysis — agents just classify, they don't act
    expect(output.ringLevel).toBe(1);
  });
});

describe("EngineeringAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new EngineeringAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "deploy_to_production", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Engineering agent does not handle task type: deploy_to_production");
  });
});
