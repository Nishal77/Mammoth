/**
 * SalesCycleWorkflow — durable multi-step sales automation.
 *
 * This is the "LangGraph-style" stateful orchestration layer.
 * Temporal guarantees the workflow survives crashes, restarts, and partial failures.
 * If the agent-worker goes down mid-cycle, Temporal replays from the last checkpoint.
 *
 * Flow:
 *   1. Lead research (Apollo or AI) → discover prospects
 *   2. Wait up to 2 min for research to complete (activity poll)
 *   3. For each lead:
 *      a. Queue outreach sequence
 *      b. Wait 3 days
 *      c. Check if lead responded — if not, send follow-up (break-up email)
 *      d. Wait 5 more days
 *      e. Mark lead as exhausted if still no reply
 *
 * Signals:
 *   leadResponded(leadId) — founder or CRM integration signals a reply came in;
 *   the workflow skips the follow-up for that lead.
 *
 * Queries:
 *   getState() — returns current cycle state for the dashboard.
 */

import {
  proxyActivities,
  sleep,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
} from "@temporalio/workflow";
import type * as activities from "../activities/sales-activities.ts";

// ---- Activity proxies ----
// Temporal sandboxes workflows — external calls must go through activities.

const {
  queueLeadResearch,
  waitForLeadResearch,
  queueOutreachSequence,
  checkLeadResponded,
  updateLeadStatus,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
  },
});

// ---- Signals & Queries ----

export const leadRespondedSignal = defineSignal<[string]>("leadResponded");

export type SalesCycleState = {
  phase: "research" | "outreach" | "follow_up" | "complete" | "failed";
  icp: string;
  leadsFound: number;
  leadsOutreached: number;
  leadsResponded: number;
  startedAt: string;
};

export const getStateQuery = defineQuery<SalesCycleState>("getState");

// ---- Workflow input ----

export type SalesCycleInput = {
  companyId: string;
  icp: string;
  leadCount?: number;
};

// ---- Main workflow ----

/**
 * Orchestrates the full B2B sales cycle end-to-end.
 * Durable — survives worker restarts at any checkpoint.
 *
 * @param input - The company, ICP criteria, and target lead count
 */
export async function SalesCycleWorkflow(input: SalesCycleInput): Promise<void> {
  const { companyId, icp, leadCount = 10 } = input;

  const respondedLeads = new Set<string>();

  const state: SalesCycleState = {
    phase: "research",
    icp,
    leadsFound: 0,
    leadsOutreached: 0,
    leadsResponded: 0,
    startedAt: new Date().toISOString(),
  };

  setHandler(getStateQuery, () => state);

  // Signal handler: mark a lead as responded (from founder or CRM webhook)
  setHandler(leadRespondedSignal, (leadId: string) => {
    respondedLeads.add(leadId);
    state.leadsResponded = respondedLeads.size;
  });

  // ---- Phase 1: Lead research ----

  const researchTaskId = await queueLeadResearch(companyId, icp, leadCount);

  // Poll until research completes — activity has 5-min timeout, retries up to 5x
  let leadIds: string[] = [];
  let attempts = 0;
  while (leadIds.length === 0 && attempts < 10) {
    await sleep("30 seconds");
    attempts++;
    try {
      leadIds = await waitForLeadResearch(researchTaskId);
    } catch {
      // Not completed yet — keep polling
    }
  }

  if (leadIds.length === 0) return; // research failed or timed out

  state.phase = "outreach";
  state.leadsFound = leadIds.length;

  // ---- Phase 2: Outreach for each lead ----

  for (const leadId of leadIds) {
    await queueOutreachSequence(companyId, leadId);
    state.leadsOutreached++;
  }

  // ---- Phase 3: Wait 3 days, then follow up on non-responders ----

  await sleep("3 days");

  state.phase = "follow_up";

  for (const leadId of leadIds) {
    // Check if the lead responded (via signal or CRM status)
    if (respondedLeads.has(leadId)) {
      await updateLeadStatus(leadId, "replied");
      continue;
    }

    const responded = await checkLeadResponded(leadId);
    if (responded) {
      respondedLeads.add(leadId);
      state.leadsResponded++;
      await updateLeadStatus(leadId, "replied");
      continue;
    }

    // No response — queue the follow-up (break-up email = email3 in sequence)
    await queueOutreachSequence(companyId, leadId);
  }

  // ---- Phase 4: Wait 5 more days, mark exhausted ----

  await sleep("5 days");

  for (const leadId of leadIds) {
    if (respondedLeads.has(leadId)) continue;

    // Last check before marking exhausted
    const responded = await checkLeadResponded(leadId);
    if (responded) {
      await updateLeadStatus(leadId, "replied");
    } else {
      await updateLeadStatus(leadId, "exhausted");
    }
  }

  state.phase = "complete";
}
