import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-content",
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
      maxOutputTokens: 6000,
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

// Content agent reads brand_voice from company memory to stay on-brand
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      companyMemory: {
        findFirst: vi.fn().mockResolvedValue({
          id: "memory-1",
          memoryType: "brand_voice",
          value: "Authoritative but approachable. No jargon. Short paragraphs.",
          companyId: "comp-test",
        }),
      },
    },
  },
  companyMemory: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid blog post matching BlogPostSchema (Content agent schema)
const VALID_BLOG_JSON = JSON.stringify({
  title: "5 Ways AI Agents Are Replacing Your Entire Operations Team",
  slug: "ai-agents-replacing-operations-team",
  metaDescription: "AI agents now handle sales, marketing, HR, and support. Here's what that means for founders.",
  targetKeyword: "AI agents for business",
  secondaryKeywords: ["autonomous AI", "AI operations", "founder tools"],
  outline: [
    "The operations bottleneck every founder faces",
    "What autonomous AI departments actually do",
    "Real MRR impact: case studies",
    "How to set your first AI goal",
    "What founders still need to do",
  ],
  content: "The average founder spends 60% of their time on operations. AI agents are about to change that...",
  estimatedReadTime: 7,
});

// Valid social post matching SocialPostSchema
const VALID_SOCIAL_JSON = JSON.stringify({
  platform: "linkedin",
  content: "Most founders I talk to are drowning in operational work.\n\nWe built MERIDIAN to fix that.\n\nOne goal. 9 AI departments. No manual coordination.\n\nHere's what it looks like in practice 👇",
  hashtags: ["#AI", "#startups", "#founder", "#automation"],
  callToAction: "Comment 'OS' and I'll send you early access.",
});

// Valid content calendar
const VALID_CALENDAR_JSON = JSON.stringify({
  weeklyPlan: [
    { day: "Monday", contentType: "blog_post", topic: "AI agents vs traditional automation" },
    { day: "Wednesday", contentType: "social_post", topic: "Founder story: saved 20h/week" },
    { day: "Friday", contentType: "social_post", topic: "Feature highlight: trust engine" },
  ],
  monthlyTheme: "Autonomous operations for startups",
  targetAudience: "Early-stage SaaS founders",
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-content",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { ContentAgent } = await import("./content-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ContentAgent — blog_post task", () => {
  let agent: InstanceType<typeof ContentAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_BLOG_JSON,
      promptTokens: 600,
      completionTokens: 1200,
      costUsd: 0.008,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new ContentAgent();
  });

  it("writes a blog post for the given topic", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: {
        topic: "AI agents for business operations",
        keyword: "AI agents for business",
        audience: "SaaS founders",
        tone: "authoritative",
      },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("blog posts are Ring 2 — reviewed before publishing to the company blog", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "Product-led growth for AI startups", keyword: "PLG AI" },
    });

    // Published content always requires 4h review window
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("includes the target keyword in the LLM prompt for SEO", async () => {
    await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "AI automation", keyword: "autonomous business AI" },
    });

    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("autonomous business AI");
  });

  it("actionType is 'publish_blog_post'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "blog_post",
      parameters: { topic: "MERIDIAN overview" },
    });

    expect(output.actionType).toBe("publish_blog_post");
  });
});

describe("ContentAgent — social_post task", () => {
  let agent: InstanceType<typeof ContentAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_SOCIAL_JSON,
      promptTokens: 200,
      completionTokens: 300,
      costUsd: 0.002,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new ContentAgent();
  });

  it("social posts are Ring 2 — reviewed before posting publicly", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "social_post",
      parameters: {
        platform: "linkedin",
        topic: "How we automated our entire sales process",
        angle: "data-driven results",
      },
    });

    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("includes platform in the LLM prompt so content fits the channel", async () => {
    await agent.run(RUN_CTX, {
      taskType: "social_post",
      parameters: { platform: "twitter", topic: "product launch" },
    });

    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("twitter");
  });
});

describe("ContentAgent — content_calendar task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_CALENDAR_JSON,
      promptTokens: 400,
      completionTokens: 500,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("content calendar is Ring 2 — approve before calendar goes live", async () => {
    const agent = new ContentAgent();
    const output = await agent.run(RUN_CTX, {
      taskType: "content_calendar",
      parameters: { period: "weekly", theme: "autonomous AI for startups" },
    });

    // Calendar commits the content team's schedule — Ring 2 approval before activation
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });
});

describe("ContentAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new ContentAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "run_ad_campaign", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("Content agent does not handle task type: run_ad_campaign");
  });
});
