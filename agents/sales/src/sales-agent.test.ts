import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// No Apollo integration connected — agent falls back to AI-synthesised leads
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      integrations: {
        // Returning null = no Apollo connected → triggers AI fallback path
        findFirst: vi.fn().mockResolvedValue(null),
      },
      leads: {
        findFirst: vi.fn().mockResolvedValue({
          id: "lead-1",
          firstName: "Jane",
          lastName: "Smith",
          email: "jane@techcorp.com",
          title: "CTO",
          companyName: "TechCorp",
          enrichmentData: { painPoints: ["scaling engineering team", "CI/CD bottlenecks"] },
          companyId: "comp-test",
        }),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  leads: {},
  integrations: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid lead research output matching LeadResearchOutputSchema
const VALID_LEADS_JSON = JSON.stringify({
  leads: [
    {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@techcorp.com",
      title: "CTO",
      company: "TechCorp",
      companySize: "51-200",
      linkedinUrl: "https://linkedin.com/in/janesmith",
      icpScore: 87,
      painPoints: ["scaling engineering team", "CI/CD bottlenecks"],
    },
    {
      firstName: "Bob",
      lastName: "Lee",
      title: "VP Engineering",
      company: "StartupXYZ",
      icpScore: 72,
      painPoints: ["hiring challenges"],
    },
  ],
});

// Valid outreach sequence output matching OutreachOutputSchema
const VALID_OUTREACH_JSON = JSON.stringify({
  subject: "Quick question about scaling your team",
  email1: "Hi Jane, I noticed TechCorp is hiring 3 engineers...",
  email2: "Following up — have you had a chance to look at my previous email?",
  email3: "Last nudge — would love to show you how Acme can help...",
  linkedinMessage: "Hi Jane, saw your recent post about scaling challenges. We help CTOs like you...",
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-sales",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { SalesAgent } = await import("./sales-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SalesAgent — lead_research task", () => {
  let agent: InstanceType<typeof SalesAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Apollo not connected, so agent generates leads via LLM
    mockCallLlm.mockResolvedValue({
      content: VALID_LEADS_JSON,
      promptTokens: 200,
      completionTokens: 300,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new SalesAgent();
  });

  it("returns a valid output when Apollo is not connected (AI fallback)", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "lead_research",
      parameters: { icp: "B2B SaaS CTOs at 50-200 person companies", count: 10 },
    });

    expect(output).toBeDefined();
    expect(output.actionType).toBe("lead_research");
  });

  it("output is Ring 1 — lead research is internal, no external action", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "lead_research",
      parameters: { icp: "Startup CTOs", count: 5 },
    });

    expect(output.ringLevel).toBe(1);
    expect(output.approvalRequired).toBe(false);
  });

  it("passes icp and count to the LLM prompt", async () => {
    await agent.run(RUN_CTX, {
      taskType: "lead_research",
      parameters: { icp: "Fintech founders", count: 15, titles: ["CEO", "CTO"] },
    });

    // The LLM must have been called with a prompt mentioning the ICP
    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("Fintech founders");
  });
});

describe("SalesAgent — outreach_sequence task", () => {
  let agent: InstanceType<typeof SalesAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_OUTREACH_JSON,
      promptTokens: 300,
      completionTokens: 400,
      costUsd: 0.003,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new SalesAgent();
  });

  it("outreach sequences are Ring 2 — emails need 4h veto before sending", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "outreach_sequence",
      // Agent looks up lead by ID from DB — not accepting inline lead data
      parameters: { leadId: "lead-1", context: "High-value ICP lead" },
    });

    // Outbound emails are Ring 2 — founder has 4h to veto before they go out
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("actionType is 'send_outreach_sequence'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "outreach_sequence",
      parameters: { leadId: "lead-1" },
    });

    expect(output.actionType).toBe("send_outreach_sequence");
  });
});

describe("SalesAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new SalesAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "send_invoice", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Sales agent does not handle task type: send_invoice");
  });
});
