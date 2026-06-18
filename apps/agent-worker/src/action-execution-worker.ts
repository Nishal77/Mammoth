import { Queue, Worker, type Job } from "bullmq";
import { db, approvals, integrations, leads } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { decryptToken } from "@mammoth/integrations/oauth";
import { sendEmail } from "@mammoth/integrations/email";
import { postToLinkedIn, getLinkedInMemberId } from "@mammoth/integrations/linkedin";
import { postTweet } from "@mammoth/integrations/twitter";
import { sendApprovalToSlack } from "@mammoth/integrations/slack";
import {
  logOutreachEmailInHubspot,
  updateHubspotLeadStatus,
} from "@mammoth/integrations/hubspot";
import { initiateVapiCall } from "@mammoth/integrations/vapi";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("action-executor");

const EXECUTION_QUEUE_NAME = "approval:execute";

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

export type ExecutionJobData = {
  approvalId: string;
  companyId: string;
  department: string;
  actionType: string;
  outputContent: string;
  /** leadId from the task parameters — used for outreach targeting */
  leadId?: string;
};

export const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
  connection: REDIS_CONNECTION,
});

/**
 * Enqueues an approved action for execution.
 * Called from the approvals route and the expiry worker after an approval is granted.
 *
 * @param approvalId - The approval that was just granted
 * @param companyId  - The company this approval belongs to
 */
export async function enqueueApprovedAction(
  approvalId: string,
  companyId: string
): Promise<void> {
  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.id, approvalId),
    columns: {
      id: true,
      department: true,
      actionType: true,
      outputContent: true,
      companyId: true,
    },
    with: {
      task: {
        columns: { taskType: true },
      },
    },
  });

  if (!approval) return;

  const jobData: ExecutionJobData = {
    approvalId,
    companyId,
    department: approval.department,
    actionType: approval.actionType,
    outputContent: approval.outputContent,
  };

  await executionQueue.add(`execute:${approvalId}`, jobData, {
    jobId: `execute:${approvalId}`,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  });
}

/**
 * Processes approved actions and dispatches them to the real world.
 * Routes each action type to its specific dispatcher.
 * All failures are logged and rethrown to trigger BullMQ retry logic.
 */
export const executionWorker = new Worker<ExecutionJobData>(
  EXECUTION_QUEUE_NAME,
  async (job: Job<ExecutionJobData>) => {
    const { approvalId, companyId, department, actionType, outputContent } = job.data;

    const execLog = log.withContext({ approvalId, companyId, department, actionType });
    execLog.info("Executing approved action");

    try {
      await dispatchAction(companyId, department, actionType, outputContent, job.data);

      execLog.info("Action dispatched successfully");
    } catch (error) {
      execLog.errorWithStack("Action dispatch failed", error as Error);
      throw error;
    }
  },
  {
    connection: REDIS_CONNECTION,
    concurrency: 5,
  }
);

async function dispatchAction(
  companyId: string,
  department: string,
  actionType: string,
  outputContent: string,
  jobData: ExecutionJobData
): Promise<void> {
  // Outreach emails — send via Resend + write back to HubSpot
  if (actionType === "send_outreach_sequence") {
    await dispatchOutreachEmails(companyId, outputContent, jobData.leadId);
    return;
  }

  // LinkedIn posts
  if (actionType === "post_linkedin") {
    await dispatchLinkedInPost(companyId, outputContent);
    return;
  }

  // Twitter/X posts
  if (actionType === "post_twitter") {
    await dispatchTweet(companyId, outputContent);
    return;
  }

  // Trend reports / content sent to Slack
  if (actionType === "share_trend_report" || actionType === "approve_content_calendar") {
    await dispatchToSlack(companyId, department, actionType, outputContent);
    return;
  }

  // Voice calls — Ring 3 only, must have explicit approval
  if (actionType === "initiate_voice_call") {
    await dispatchVoiceCall(companyId, outputContent);
    return;
  }

  // Offer letters — send via email
  if (actionType === "send_offer_letter") {
    await dispatchOfferLetterEmail(companyId, outputContent);
    return;
  }

  // Job postings, blog posts, social calendars — logged to DB only for now
  log.info("Action type has no live dispatcher — logged only", { companyId, actionType });
}

async function dispatchOutreachEmails(
  companyId: string,
  outputContent: string,
  leadId?: string
): Promise<void> {
  // Extract first email from the approved content block
  const email1Match = outputContent.match(/---EMAIL 1---\n([\s\S]*?)(?:\n---EMAIL 2---|$)/);
  const subjectMatch = outputContent.match(/Subject: (.+)/);
  const toMatch = outputContent.match(/To: .+ <(.+@.+)>/);

  if (!subjectMatch || !email1Match) {
    log.warn("Could not parse outreach email content", { companyId });
    return;
  }

  const subject = subjectMatch[1]!.trim();
  const emailBody = email1Match[1]!.trim();
  const toEmail = toMatch?.[1]?.trim();

  if (!toEmail || toEmail === "—") {
    log.warn("No recipient email in outreach sequence", { companyId });
    return;
  }

  const result = await sendEmail({
    to: toEmail,
    subject,
    html: `<p>${emailBody.replace(/\n/g, "<br>")}</p>`,
    text: emailBody,
  });

  if (!result.sent) {
    throw new Error(`Email send failed: ${result.reason}`);
  }

  // Write activity back to HubSpot if integration exists
  if (leadId) {
    await writeOutreachToHubspot(companyId, leadId, subject, emailBody);
  }
}

async function writeOutreachToHubspot(
  companyId: string,
  leadId: string,
  subject: string,
  emailBody: string
): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "hubspot"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true },
  });

  if (!integration?.accessTokenEnc) return;

  let accessToken: string;
  try {
    accessToken = decryptToken(integration.accessTokenEnc);
  } catch {
    log.warn("HubSpot token decryption failed — skipping write-back", { companyId });
    return;
  }

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
    columns: { enrichmentData: true },
  });

  const hubspotId = (lead?.enrichmentData as { hubspotId?: string } | null)?.hubspotId;
  if (!hubspotId) return;

  await Promise.all([
    logOutreachEmailInHubspot(accessToken, hubspotId, subject, emailBody, new Date()),
    updateHubspotLeadStatus(accessToken, hubspotId, "IN_PROGRESS"),
  ]);
}

async function dispatchLinkedInPost(
  companyId: string,
  postText: string
): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "linkedin"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true },
  });

  if (!integration?.accessTokenEnc) {
    log.warn("No LinkedIn integration — skipping post", { companyId });
    return;
  }

  const accessToken = decryptToken(integration.accessTokenEnc);
  const authorUrn = await getLinkedInMemberId(accessToken);

  if (!authorUrn) {
    log.warn("Could not get LinkedIn member ID", { companyId });
    return;
  }

  const result = await postToLinkedIn(accessToken, {
    authorUrn,
    text: postText,
  });

  if (!result.posted) {
    throw new Error(`LinkedIn post failed: ${result.reason}`);
  }

  log.info("LinkedIn post published", { companyId, postUrl: result.postUrl });
}

async function dispatchTweet(companyId: string, tweetText: string): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "twitter"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true },
  });

  if (!integration?.accessTokenEnc) {
    log.warn("No Twitter integration — skipping tweet", { companyId });
    return;
  }

  const bearerToken = decryptToken(integration.accessTokenEnc);

  // Strip hashtag-heavy endings before tweeting if over the limit
  const text = tweetText.slice(0, 280);
  const result = await postTweet(bearerToken, { text });

  if (!result.posted) {
    throw new Error(`Tweet failed: ${result.reason}`);
  }

  log.info("Tweet published", { companyId, tweetUrl: result.tweetUrl });
}

async function dispatchToSlack(
  companyId: string,
  department: string,
  actionType: string,
  outputContent: string
): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "slack"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true, metadata: true },
  });

  if (!integration?.accessTokenEnc) return;

  const botToken = decryptToken(integration.accessTokenEnc);
  const config = integration.metadata as unknown as { channel?: string } | null;
  const channel = config?.channel ?? "#mammoth-updates";

  await sendApprovalToSlack(botToken, channel, {
    approvalId: "",
    department,
    actionType,
    ringLevel: 1,
    outputContent,
    confidence: 1,
    expiresAt: null,
  });
}

async function dispatchVoiceCall(companyId: string, callSpec: string): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "vapi"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true, metadata: true },
  });

  if (!integration?.accessTokenEnc) {
    log.warn("No Vapi integration — skipping voice call", { companyId });
    return;
  }

  const apiKey = decryptToken(integration.accessTokenEnc);
  const config = integration.metadata as unknown as { phoneNumberId?: string; toPhone?: string } | null;

  if (!config?.phoneNumberId || !config.toPhone) {
    log.warn("Vapi config missing phoneNumberId or toPhone", { companyId });
    return;
  }

  const result = await initiateVapiCall(apiKey, {
    toPhone: config.toPhone,
    fromPhoneId: config.phoneNumberId,
    assistantConfig: {
      name: "MAMMOTH Support Agent",
      firstMessage: "Hi, this is an automated call from MAMMOTH AI on behalf of the team.",
      systemPrompt: callSpec.slice(0, 2000),
      maxDurationSeconds: 180,
    },
  });

  if (!result.initiated) {
    throw new Error(`Voice call failed: ${result.reason}`);
  }

  log.info("Voice call initiated", { companyId, callId: result.callId });
}

async function dispatchOfferLetterEmail(
  companyId: string,
  letterContent: string
): Promise<void> {
  // Extract recipient email from offer letter content
  const emailMatch = letterContent.match(/\b[\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,}\b/);
  if (!emailMatch) {
    log.warn("No email address found in offer letter", { companyId });
    return;
  }

  const result = await sendEmail({
    to: emailMatch[0],
    subject: "Your Offer Letter",
    html: `<pre style="font-family: serif; white-space: pre-wrap;">${letterContent}</pre>`,
    text: letterContent,
  });

  if (!result.sent) {
    throw new Error(`Offer letter email failed: ${result.reason}`);
  }
}

executionWorker.on("failed", (job, error) => {
  log.errorWithStack(`Execution job ${job?.id ?? "unknown"} failed`, error);
});

executionWorker.on("error", (error) => {
  log.errorWithStack("Execution worker error", error);
});
