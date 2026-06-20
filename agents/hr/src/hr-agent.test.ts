import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTaskInput } from "@mammoth/agent-base";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const mockCallLlm = vi.hoisted(() => vi.fn());

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@mammoth/agent-base", () => {
  class BaseAgent {
    protected runCtx = {
      companyId: "comp-test",
      departmentId: "dept-hr",
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

// HR agent queries DB for job postings and candidate records
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      candidates: {
        findFirst: vi.fn().mockResolvedValue({
          id: "candidate-1",
          firstName: "Alice",
          lastName: "Johnson",
          email: "alice@example.com",
          resumeSummary: "5 years TypeScript experience. Led team of 8. Built distributed systems at Stripe.",
          experienceYears: 5,
          skills: ["TypeScript", "Node.js", "PostgreSQL"],
          appliedRole: "Senior Backend Engineer",
          companyId: "comp-test",
        }),
      },
      jobPostings: {
        findFirst: vi.fn().mockResolvedValue({
          id: "job-posting-1",
          title: "Senior Backend Engineer",
          requirements: ["5+ years TypeScript/Node.js", "PostgreSQL experience", "Production systems at scale"],
          companyId: "comp-test",
        }),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "job-posting-1" }]),
      returning: vi.fn().mockResolvedValue([{ id: "job-posting-1" }]),
    }),
  },
  jobPostings: {},
  candidates: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid job description matching JobDescriptionSchema
const VALID_JD_JSON = JSON.stringify({
  title: "Senior Backend Engineer",
  department: "Engineering",
  seniority: "senior",
  summary: "Build and scale the core API infrastructure for our AI company operating system.",
  responsibilities: [
    "Design and implement high-throughput microservices",
    "Review PRs and mentor junior engineers",
    "Own the reliability of our payment and billing systems",
  ],
  mustHaveRequirements: [
    "5+ years of TypeScript/Node.js experience",
    "Experience with PostgreSQL and query optimization",
    "Track record of building production systems at scale",
  ],
  niceToHaveRequirements: [
    "Experience with Temporal.io or BullMQ",
    "Prior startup experience",
  ],
  compensationRange: "$180k–$220k + equity",
  workStyle: "remote",
});

// Valid candidate screening matching CandidateScreeningSchema
const VALID_SCREENING_JSON = JSON.stringify({
  fitScore: 88,
  mustHavesMet: [
    "5+ years TypeScript/Node.js",
    "PostgreSQL experience confirmed",
    "Production system at Stripe",
  ],
  mustHavesMissing: [],
  strengths: ["Led a team of 8", "Distributed systems background", "Strong communication in resume"],
  concerns: ["No explicit AI/LLM experience mentioned"],
  recommendation: "advance",
  reasoningSummary: "Strong technical background. Stripe experience is directly relevant. Advance to technical screen.",
  suggestedInterviewQuestions: [
    "Walk me through a system you designed from scratch at Stripe.",
    "How would you approach scaling our BullMQ job queue to 1M jobs/day?",
  ],
});

// Valid offer letter draft
const VALID_OFFER_JSON = JSON.stringify({
  subject: "Offer Letter — Senior Backend Engineer at Acme Corp",
  body: "Dear Alice,\n\nWe are thrilled to offer you the position of Senior Backend Engineer...",
  keyTerms: {
    salary: "$200,000 USD",
    equity: "0.15% over 4 years, 1-year cliff",
    startDate: "2026-07-14",
    probationPeriod: "90 days",
  },
});

const RUN_CTX = {
  companyId: "comp-test",
  departmentId: "dept-hr",
  taskId: "task-test",
  agentRunId: "run-test",
};

// ─── Import after mocks ───────────────────────────────────────────────────────
const { HrAgent } = await import("./hr-agent.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HrAgent — create_job_description task", () => {
  let agent: InstanceType<typeof HrAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_JD_JSON,
      promptTokens: 300,
      completionTokens: 400,
      costUsd: 0.003,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new HrAgent();
  });

  it("creates a job description for the given role", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "create_job_description",
      parameters: {
        role: "Senior Backend Engineer",
        department: "Engineering",
        seniority: "senior",
        context: "We need someone to own the billing and payment infrastructure.",
      },
    });

    expect(output).toBeDefined();
    expect(output.content).toBeTruthy();
  });

  it("job postings are Ring 2 — founder reviews before publishing to job boards", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "create_job_description",
      parameters: {
        role: "Product Designer",
        department: "Design",
        seniority: "mid",
      },
    });

    // Publishing a job posting is a public-facing action — Ring 2 (4h veto)
    expect(output.ringLevel).toBe(2);
    expect(output.approvalRequired).toBe(true);
  });

  it("passes the role name into the LLM prompt", async () => {
    await agent.run(RUN_CTX, {
      taskType: "create_job_description",
      parameters: { role: "Head of Growth", department: "Marketing", seniority: "director" },
    });

    const callArgs = mockCallLlm.mock.calls[0][0] as { userMessage: string };
    expect(callArgs.userMessage).toContain("Head of Growth");
  });
});

describe("HrAgent — screen_candidate task", () => {
  let agent: InstanceType<typeof HrAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_SCREENING_JSON,
      promptTokens: 500,
      completionTokens: 400,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new HrAgent();
  });

  it("candidate screening is Ring 1 — internal analysis, no external contact", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "screen_candidate",
      parameters: {
        candidateId: "candidate-1",
        jobPostingId: "job-posting-1",
      },
    });

    // Screening is read-only evaluation — no external action triggers
    expect(output.ringLevel).toBe(1);
    expect(output.approvalRequired).toBe(false);
  });

  it("actionType is 'screen_candidate'", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "screen_candidate",
      parameters: { candidateId: "candidate-1", jobDescriptionId: "job-posting-1" },
    });

    expect(output.actionType).toBe("screen_candidate");
  });
});

describe("HrAgent — draft_offer_letter task", () => {
  let agent: InstanceType<typeof HrAgent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlm.mockResolvedValue({
      content: VALID_OFFER_JSON,
      promptTokens: 400,
      completionTokens: 500,
      costUsd: 0.004,
      model: "claude-haiku-4-5-20251001",
    });
    agent = new HrAgent();
  });

  it("offer letters are Ring 3 — binding legal document, requires explicit founder approval", async () => {
    const output = await agent.run(RUN_CTX, {
      taskType: "draft_offer_letter",
      parameters: {
        candidateId: "candidate-1",
        salary: 200000,
        equity: "0.15%",
        startDate: "2026-07-14",
        role: "Senior Backend Engineer",
      },
    });

    // Offer letters create legal obligations — must never auto-send
    expect(output.ringLevel).toBe(3);
    expect(output.approvalRequired).toBe(true);
  });
});

describe("HrAgent — unknown task type", () => {
  it("throws for task types it does not handle", async () => {
    const agent = new HrAgent();
    vi.clearAllMocks();

    await expect(
      agent.run(RUN_CTX, { taskType: "run_payroll", parameters: {} } as AgentTaskInput)
    ).rejects.toThrow("HR agent does not handle task type: run_payroll");
  });
});
