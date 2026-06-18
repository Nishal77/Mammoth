import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, companies, departments, companyGoals } from "@mammoth/memory-database";
import { eq, isNull, and } from "drizzle-orm";
import { DEPARTMENT_NAMES } from "@mammoth/memory-database/schema";
import { redis } from "../../lib/redis.ts";
import { authenticate } from "../../middleware/authenticate.ts";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from "@mammoth/shared/errors";
import { generateCompanySlug } from "@mammoth/shared/utils";
import { successResponse } from "@mammoth/shared/types";

const SESSION_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const SESSION_PREFIX = "onboarding:session:";

const StartOnboardingSchema = z.object({
  companyName: z.string().min(2).max(100),
});

const StepSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("company_details"),
    tagline: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    industry: z.string().max(100).optional(),
    stage: z
      .enum(["idea", "pre-revenue", "early-revenue", "growing", "scaling"])
      .optional(),
    website: z.string().url().optional().or(z.literal("")),
  }),
  z.object({
    step: z.literal("brand_voice"),
    brandVoice: z.string().min(10).max(5000),
  }),
  z.object({
    step: z.literal("first_goal"),
    title: z.string().min(1).max(500),
    type: z.enum(["revenue", "users", "other"]),
    targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
    unit: z.string().max(50),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

type SessionData = {
  userId: string;
  companyName: string;
  companyDetails?: Partial<z.infer<typeof StepSchema>>;
  brandVoice?: string;
  firstGoal?: {
    title: string;
    type: string;
    targetValue: string;
    unit: string;
    deadline: string;
  };
  completedSteps: string[];
};

async function loadSession(
  sessionId: string,
  userId: string
): Promise<SessionData> {
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) throw new NotFoundError("Onboarding session", sessionId);

  const session = JSON.parse(raw) as SessionData;
  if (session.userId !== userId) throw new ForbiddenError();

  return session;
}

async function saveSession(sessionId: string, data: SessionData): Promise<void> {
  await redis.setex(
    `${SESSION_PREFIX}${sessionId}`,
    SESSION_TTL_SECONDS,
    JSON.stringify(data)
  );
}

type OnboardingParams = { Params: { sessionId?: string } };

export async function onboardingRoute(app: FastifyInstance): Promise<void> {
  // POST /onboarding/start
  app.post(
    "/start",
    { preHandler: [authenticate] },
    async (request: FastifyRequest<OnboardingParams>, reply) => {
      const result = StartOnboardingSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const sessionId = crypto.randomUUID();
      const session: SessionData = {
        userId: request.user.id,
        companyName: result.data.companyName,
        completedSteps: [],
      };

      await saveSession(sessionId, session);

      return reply.status(201).send(
        successResponse({
          sessionId,
          nextStep: "company_details",
        })
      );
    }
  );

  // PATCH /onboarding/:sessionId/step
  app.patch(
    "/:sessionId/step",
    { preHandler: [authenticate] },
    async (request: FastifyRequest<OnboardingParams>, reply) => {
      const { sessionId } = request.params;
      if (!sessionId) throw new ValidationError("sessionId is required");

      const result = StepSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const session = await loadSession(sessionId, request.user.id);

      const step = result.data.step;

      if (step === "company_details") {
        session.companyDetails = result.data;
      } else if (step === "brand_voice") {
        session.brandVoice = result.data.brandVoice;
      } else if (step === "first_goal") {
        session.firstGoal = {
          title: result.data.title,
          type: result.data.type,
          targetValue: result.data.targetValue,
          unit: result.data.unit,
          deadline: result.data.deadline,
        };
      }

      if (!session.completedSteps.includes(step)) {
        session.completedSteps.push(step);
      }

      await saveSession(sessionId, session);

      const allSteps = ["company_details", "brand_voice", "first_goal"];
      const remaining = allSteps.filter(
        (s) => !session.completedSteps.includes(s)
      );
      const nextStep = remaining[0] ?? "complete";

      return reply.send(
        successResponse({ completedSteps: session.completedSteps, nextStep })
      );
    }
  );

  // POST /onboarding/:sessionId/complete — creates company + departments + first goal
  app.post(
    "/:sessionId/complete",
    { preHandler: [authenticate] },
    async (request: FastifyRequest<OnboardingParams>, reply) => {
      const { sessionId } = request.params;
      if (!sessionId) throw new ValidationError("sessionId is required");

      const session = await loadSession(sessionId, request.user.id);

      const requiredSteps = ["company_details", "first_goal"];
      const missing = requiredSteps.filter(
        (s) => !session.completedSteps.includes(s)
      );
      if (missing.length) {
        throw new ValidationError(
          `Complete required steps first: ${missing.join(", ")}`
        );
      }

      const slug = generateCompanySlug(session.companyName);
      const details = (session.companyDetails ?? {}) as Record<string, unknown>;

      const result = await db.transaction(async (tx) => {
        const [company] = await tx
          .insert(companies)
          .values({
            ownerId: request.user.id,
            name: session.companyName,
            slug,
            tagline: details["tagline"] as string | undefined,
            description: details["description"] as string | undefined,
            industry: details["industry"] as string | undefined,
            stage: details["stage"] as
              | "idea"
              | "pre-revenue"
              | "early-revenue"
              | "growing"
              | "scaling"
              | undefined,
            website:
              (details["website"] as string | undefined) || null,
            brandVoice: session.brandVoice,
            version: 1,
          })
          .returning();

        if (!company) throw new Error("Company insert failed");

        await tx.insert(departments).values(
          DEPARTMENT_NAMES.map((name) => ({
            companyId: company.id,
            name,
            status: "idle" as const,
            ringDefaults: { defaultRing: 2 as const },
            playbookVersion: 1,
          }))
        );

        let goal = null;
        if (session.firstGoal) {
          const [g] = await tx
            .insert(companyGoals)
            .values({
              companyId: company.id,
              title: session.firstGoal.title,
              type: session.firstGoal.type as "revenue" | "users" | "other",
              targetValue: session.firstGoal.targetValue,
              currentValue: "0",
              unit: session.firstGoal.unit,
              deadline: session.firstGoal.deadline,
              status: "active",
            })
            .returning();
          goal = g;
        }

        return { company, goal };
      });

      // Clean up session
      await redis.del(`${SESSION_PREFIX}${sessionId}`);

      return reply.status(201).send(successResponse(result));
    }
  );
}
