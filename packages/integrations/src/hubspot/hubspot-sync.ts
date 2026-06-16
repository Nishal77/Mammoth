import { db, leads, customers, integrations } from "@mammoth/db";
import { and, eq } from "drizzle-orm";
import { decryptToken } from "../oauth/token-encryptor.ts";
import { fetchHubspotContacts, fetchHubspotDeals } from "./hubspot-client.ts";
import type { HubspotContact, HubspotDeal } from "./hubspot-client.ts";
import { mapHubspotStatusToLeadStatus } from "./hubspot-status-mapper.ts";

export type HubspotSyncResult = {
  contactsSynced: number;
  contactsSkipped: number;
  dealsSynced: number;
  errors: string[];
};

/**
 * Syncs HubSpot contacts and deals into MAMMOTH's leads and customers tables.
 *
 * Contacts → leads:   Every HubSpot contact becomes a lead record.
 * Deals (closed won) → customers: Deals in closedwon stage become customer records.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING — safe to run repeatedly without duplicates.
 *
 * @param companyId - The MAMMOTH company to sync for
 */
export async function syncHubspot(companyId: string): Promise<HubspotSyncResult> {
  const result: HubspotSyncResult = {
    contactsSynced: 0,
    contactsSkipped: 0,
    dealsSynced: 0,
    errors: [],
  };

  // Load the access token from the integrations table
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "hubspot"),
      eq(integrations.status, "connected")
    ),
    columns: { accessTokenEnc: true },
  });

  if (!integration?.accessTokenEnc) {
    result.errors.push("No connected HubSpot integration found");
    return result;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(integration.accessTokenEnc);
  } catch {
    result.errors.push("Failed to decrypt HubSpot access token");
    return result;
  }

  // Sync contacts → leads
  let contacts: HubspotContact[] = [];
  try {
    contacts = await fetchHubspotContacts(accessToken);
  } catch (error) {
    result.errors.push(
      `Contact fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  for (const contact of contacts) {
    // Skip contacts with no email — we can't do outreach without one
    if (!contact.email) {
      result.contactsSkipped++;
      continue;
    }

    try {
      await upsertLead(companyId, contact);
      result.contactsSynced++;
    } catch (error) {
      result.errors.push(
        `Lead upsert failed for ${contact.email}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Sync closed-won deals → customers
  let deals: HubspotDeal[] = [];
  try {
    deals = await fetchHubspotDeals(accessToken);
  } catch (error) {
    result.errors.push(
      `Deal fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  for (const deal of deals) {
    if (deal.stage !== "closedwon") continue;

    try {
      await insertCustomerFromDeal(companyId, deal);
      result.dealsSynced++;
    } catch (error) {
      result.errors.push(
        `Customer insert failed for deal ${deal.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}

/**
 * Inserts a lead from a HubSpot contact.
 * Skips if a lead with the same primary key already exists (ON CONFLICT DO NOTHING).
 * HubSpot ID is stored in enrichmentData for future delta syncs.
 */
async function upsertLead(companyId: string, contact: HubspotContact): Promise<void> {
  await db
    .insert(leads)
    .values({
      companyId,
      firstName: contact.firstName || null,
      lastName: contact.lastName || null,
      email: contact.email,
      companyName: contact.company || null,
      title: contact.jobTitle || null,
      source: "hubspot",
      status: mapHubspotStatusToLeadStatus(contact.lifecycleStage, contact.leadStatus),
      enrichmentData: {
        hubspotId: contact.id,
        lifecycleStage: contact.lifecycleStage,
        leadStatus: contact.leadStatus,
      },
    })
    .onConflictDoNothing();
}

/**
 * Inserts a customer record from a closed-won HubSpot deal.
 * Uses ON CONFLICT DO NOTHING — duplicate deals are skipped silently.
 */
async function insertCustomerFromDeal(companyId: string, deal: HubspotDeal): Promise<void> {
  const mrr = deal.amountCents > 0 ? (deal.amountCents / 100).toFixed(2) : "0";

  await db
    .insert(customers)
    .values({
      companyId,
      name: deal.name,
      externalId: `hubspot:${deal.id}`,
      mrr,
      notes: `Imported from HubSpot deal. Closed: ${deal.closeDateIso ?? "unknown"}`,
    })
    .onConflictDoNothing();
}

