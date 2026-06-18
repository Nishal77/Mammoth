import type { FastifyInstance, FastifyRequest } from "fastify";
import { Queue } from "bullmq";
import { db, integrations, companies, departmentTasks } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { verifyGithubWebhookSignature } from "@mammoth/tool-github";
import type { AgentJobData } from "@mammoth/agent-base";
import { QUEUE_NAMES } from "@mammoth/agent-base";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("github-webhook");

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

const agentQueue = new Queue<AgentJobData>(QUEUE_NAMES.AGENT_TASKS, {
  connection: REDIS_CONNECTION,
});

type GithubPrEvent = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    head: { sha: string; ref: string };
    base: { ref: string };
    html_url: string;
    user: { login: string };
    additions: number;
    deletions: number;
    changed_files: number;
  };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  installation?: { id: number };
};

/**
 * Handles GitHub webhook events for PR review automation.
 * Triggered by GitHub when a PR is opened or marked ready for review.
 * Automatically queues an Engineering agent task to review the PR.
 *
 * Webhook secret is verified per-company using HMAC-SHA256.
 * Companies are identified by the installation ID stored in their integrations row.
 */
export async function githubWebhookRoute(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

  app.post(
    "/",
    async (request: FastifyRequest<{ Body: Buffer }>, reply) => {
      const githubEvent = request.headers["x-github-event"];
      const signature = request.headers["x-hub-signature-256"];

      if (githubEvent !== "pull_request") {
        return reply.send({ ok: true, ignored: true });
      }

      if (typeof signature !== "string") {
        return reply.status(401).send({ error: "Missing signature", code: "MISSING_SIGNATURE" });
      }

      const rawBody = request.body;

      let eventData: GithubPrEvent;
      try {
        eventData = JSON.parse(rawBody.toString()) as GithubPrEvent;
      } catch {
        return reply.status(400).send({ error: "Invalid JSON", code: "INVALID_BODY" });
      }

      // Only act on PRs being opened or marked ready_for_review (not draft)
      const isReviewable =
        eventData.action === "opened" ||
        eventData.action === "ready_for_review" ||
        eventData.action === "synchronize";

      if (!isReviewable || eventData.pull_request.draft) {
        return reply.send({ ok: true, ignored: true });
      }

      // Find the company by GitHub installation ID
      const installationId = eventData.installation?.id;
      const repoFullName = eventData.repository.full_name;

      const integration = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.provider, "github"),
          eq(integrations.status, "connected")
        ),
        columns: {
          companyId: true,
          accessTokenEnc: true,
          metadata: true,
        },
      });

      if (!integration) {
        log.warn("No GitHub integration found for webhook", { installationId, repoFullName });
        return reply.status(404).send({ error: "No integration", code: "NOT_FOUND" });
      }

      // Verify webhook signature using the stored secret
      const config = integration.metadata as unknown as { webhookSecret?: string; repo?: string } | null;
      const webhookSecret = config?.webhookSecret ?? process.env["GITHUB_WEBHOOK_SECRET"] ?? "";

      if (webhookSecret && !verifyGithubWebhookSignature(rawBody, signature, webhookSecret)) {
        log.warn("GitHub webhook signature verification failed", {
          companyId: integration.companyId,
        });
        return reply.status(401).send({ error: "Invalid signature", code: "INVALID_SIGNATURE" });
      }

      const company = await db.query.companies.findFirst({
        where: eq(companies.id, integration.companyId),
        columns: { id: true },
        with: {
          departments: {
            where: (dept, { eq: deq }) => deq(dept.name, "engineering"),
            columns: { id: true },
            limit: 1,
          },
        },
      });

      const engDept = company?.departments[0];
      if (!engDept) {
        log.warn("No engineering department found", { companyId: integration.companyId });
        return reply.send({ ok: true, ignored: true });
      }

      const pr = eventData.pull_request;

      const prParams = {
        prNumber: pr.number,
        prTitle: pr.title,
        prBody: pr.body ?? "",
        prUrl: pr.html_url,
        author: pr.user.login,
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        repoOwner: eventData.repository.owner.login,
        repoName: eventData.repository.name,
      };

      // Create the task row first — the agent-worker resolves department name from this row.
      const [createdTask] = await db
        .insert(departmentTasks)
        .values({
          companyId: integration.companyId,
          departmentId: engDept.id,
          title: `PR #${pr.number}: ${pr.title}`,
          taskType: "pr_review",
          status: "queued",
          inputData: prParams,
        })
        .onConflictDoNothing()
        .returning({ id: departmentTasks.id });

      if (!createdTask) {
        // Conflict — duplicate webhook delivery, already queued
        return reply.send({ ok: true, ignored: true, reason: "duplicate" });
      }

      const agentRunId = `github-${pr.number}-${pr.head.sha.slice(0, 7)}`;

      const jobData: AgentJobData = {
        companyId: integration.companyId,
        departmentId: engDept.id,
        taskId: createdTask.id,
        agentRunId,
        taskType: "pr_review",
        parameters: prParams,
      };

      await agentQueue.add(`pr-review:${integration.companyId}:${pr.number}`, jobData, {
        jobId: `pr-review:${integration.companyId}:${pr.number}:${pr.head.sha.slice(0, 7)}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      });

      log.info("PR review job queued", {
        companyId: integration.companyId,
        prNumber: pr.number,
        actionType: "pr_review",
      });

      return reply.send({ ok: true, queued: true });
    }
  );
}
