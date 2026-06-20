import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-support",
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

// Support agent loads tickets from DB and optionally uses Vapi for voice calls
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      supportTickets: {
        findFirst: vi.fn().mockResolvedValue({
          id: "ticket-1",
          subject: "I can't log into my account",
          body: "I've been trying to log in for the past hour. I reset my password twice but still get 'invalid credentials'.",
          customerEmail: "customer@example.com",
          customerName: "Sarah Chen",
          status: "open",
          priority: "high",
          companyId: "comp-test",
          createdAt: new Date("2026-06-20T09:00:00Z"),
        }),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "kb-article-1" }]),
      returning: vi.fn().mockResolvedValue([{ id: "kb-article-1" }]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  },
  supportTickets: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid ticket resolution matching TicketResolutionSchema
const VALID_RESOLUTION_JSON = JSON.stringify({
  suggestedReply: `Hi Sarah,

Thanks for reaching out! I can see what's happening here.

This is caused by a known issue where password reset tokens expire after 30 minutes. If you reset your password and then waited before using the link, it may have expired.

Here's what to do:
1. Go to the login page and click "Forgot Password" again
2. Check your email immediately and use the link within 10 minutes
3. Clear your browser cache before setting the new password

If this doesn't work, reply to this email and I'll manually reset your account.

Best,
Acme Support`,
  resolutionCategory: "technical",
  confidence: 0.92,
  shouldCreateKbArticle: true,
  kbArticleTitle: "Password reset link expired — how to fix",
  kbArticleContent: "If your password reset link isn't working, it may have expired. Reset tokens are valid for 30 minutes...",
});

// Valid KB article matching KbArticleSchema
const VALID_KB_ARTICLE_JSON = JSON.stringify({
  title: "Password reset link expired — how to fix",
  content: "## Problem\nYour password reset link isn't working.\n\n## Why this happens\nReset tokens expire after 30 minutes for security.\n\n## Solution\n1. Request a new reset link\n2. Use it within 10 minutes\n3. Clear browser cache first",
  category: "Authentication",
  tags: ["password", "login", "authentication", "reset"],
});

// Valid voice call prep matching VapiCallSchema
const VALID_VOICE_CALL_JSON = JSON.stringify({
  customerName: "Sarah Chen",
  customerPhone: "+1-555-0123",
  callScript: "Hi, this is the Acme support team calling about your recent login issue...",
  keyPoints: [
    "Acknowledge the frustration",
    "Explain the token expiry",
    "Offer to manually reset if needed",
  ],
  maxCallDuration: 300,
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-support",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { SupportAgent } = await import("./support-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupportAgent — resolve_ticket task", () => {
  let agent: InstanceType<typeof SupportAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_RESOLUTION_JSON,
      promptTokens: 400,
      completionTokens: 500,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new SupportAgent();
  });

  it("resolves a support ticket by generating a suggested reply", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "resolve_ticket",
      parameters: { ticketId: "ticket-1" },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("ticket replies are Ring 2 — human reviews reply before it's sent to the customer", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "resolve_ticket",
      parameters: { ticketId: "ticket-1" },
    });

    // Sending a reply to a customer is a public action — Ring 2 veto window
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("throws when the ticket ID does not exist", async () => {
    const { db } = await import("@mammoth/memory-database");
    vi.mocked(db.query.supportTickets.findFirst).mockResolvedValueOnce(null);

    await expect(
      agent.run(RUN_CTX, {
        taskType: "resolve_ticket",
        parameters: { ticketId: "ticket-does-not-exist" },
      })
    ).rejects.toThrow("Ticket ticket-does-not-exist not found");
  });

  it("actionType is 'send_support_reply'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "resolve_ticket",
      parameters: { ticketId: "ticket-1" },
    });

    expect(output.actionType).toBe("send_support_reply");
  });
});

describe("SupportAgent — create_kb_article task", () => {
  let agent: InstanceType<typeof SupportAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_KB_ARTICLE_JSON,
      promptTokens: 300,
      completionTokens: 400,
      costUsd: 0.003,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new SupportAgent();
  });

  it("creates a knowledge base article successfully", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "create_kb_article",
      parameters: {
        topic: "Password reset link expired",
        category: "Authentication",
        triggerTicketId: "ticket-1",
      },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("KB articles are Ring 2 — reviewed before publishing to help center", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "create_kb_article",
      parameters: {
        topic: "How to connect Slack integration",
        category: "Integrations",
      },
    });

    // KB articles are publicly visible — need review before going live
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });
});

describe("SupportAgent — initiate_voice_call task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_VOICE_CALL_JSON,
      promptTokens: 200,
      completionTokens: 250,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("voice calls are Ring 3 — calling a customer requires explicit founder approval", async () => {
    const agent = new SupportAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "initiate_voice_call",
      parameters: {
        ticketId: "ticket-1",
        reason: "Complex billing issue — customer requested a callback",
        urgency: "high",
      },
    });

    // Calling a real person is irreversible — must never happen without explicit approval
    expect(output.ringLevel).toBe(3);
    expect(output.approvalRequired).toBe(true);
  });

  it("actionType is 'initiate_voice_call'", async () => {
    const agent = new SupportAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "initiate_voice_call",
      parameters: { ticketId: "ticket-1", reason: "VIP escalation" },
    });

    expect(output.actionType).toBe("initiate_voice_call");
  });
});

describe("SupportAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new SupportAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "issue_refund", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Support agent does not handle task type: issue_refund");
  });
});
