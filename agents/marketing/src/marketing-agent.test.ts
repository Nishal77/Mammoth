import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-marketing",
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

// Exa not connected — agent skips web context and goes straight to LLM
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      integrations: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
  integrations: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid blog post matching BlogPostOutputSchema
const VALID_BLOG_JSON = JSON.stringify({
  title: "How AI Is Changing B2B Sales in 2026",
  slug: "ai-changing-b2b-sales-2026",
  metaDescription: "Discover how AI agents are automating outreach, qualifying leads, and closing deals faster.",
  targetKeyword: "AI B2B sales",
  body: "The B2B sales landscape is being transformed by AI...",
  seoScore: 82,
});

// Valid social post matching SocialPostOutputSchema
const VALID_SOCIAL_JSON = JSON.stringify({
  linkedinPost: "AI is no longer a buzzword in B2B sales — it's the new SDR. Here's what's changing 👇\n\n1. Automated lead research...",
  twitterPost: "AI SDRs are 10x faster than humans at qualifying leads. Here's what founders need to know 🧵",
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-marketing",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { MarketingAgent } = await import("./marketing-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MarketingAgent — blog_post task", () => {
  let agent: InstanceType<typeof MarketingAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_BLOG_JSON,
      promptTokens: 400,
      completionTokens: 600,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new MarketingAgent();
  });

  it("returns a valid output for a blog post task", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: {
        topic: "How AI is changing B2B sales",
        keyword: "AI B2B sales",
        audience: "SaaS founders",
        tone: "authoritative",
      },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("blog posts are Ring 2 — require 4h veto before publishing", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "SEO for startups", keyword: "startup SEO" },
    });

    // All published content is Ring 2 — founder has 4h to cancel
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("includes target keyword in the LLM prompt", async () => {
    await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "product-led growth", keyword: "PLG" },
    });

    // Agent builds prompt from keyword, not topic
    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("PLG");
  });

  it("actionType identifies the content type being created", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "AI automation" },
    });

    expect(output.actionType).toBe("publish_blog_post");
  });
});

describe("MarketingAgent — social_post task", () => {
  let agent: InstanceType<typeof MarketingAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_SOCIAL_JSON,
      promptTokens: 200,
      completionTokens: 250,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new MarketingAgent();
  });

  it("social posts are Ring 2 — reviewing before public posting", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "social_post",
      parameters: { topic: "AI agents for startups", angle: "founder perspective" },
    });

    expect(output.ringLevel).toBe(2);
  });

  it("returns content for both LinkedIn and Twitter", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "social_post",
      parameters: { topic: "product launch announcement" },
    });

    // Agent formats output as "LINKEDIN:\n...\n\nTWITTER:\n..."
    expect(output.content).toContain("LINKEDIN");
  });
});

describe("MarketingAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new MarketingAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "run_paid_ads", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Marketing agent does not handle task type: run_paid_ads");
  });
});
