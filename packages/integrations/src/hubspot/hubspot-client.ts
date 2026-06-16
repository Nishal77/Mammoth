// HubSpot CRM API client — read contacts and deals.
// Uses the HubSpot private app token (no OAuth refresh needed for private apps).
// Documentation: https://developers.hubspot.com/docs/api/crm/contacts

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const REQUEST_TIMEOUT_MS = 15_000;

// Only fetch the properties we actually store — avoids pulling the full object
const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "company",
  "phone",
  "jobtitle",
  "lifecyclestage",
  "hs_lead_status",
].join(",");

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "closedate",
  "hubspot_owner_id",
  "associated_company",
].join(",");

export type HubspotContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: string;
  leadStatus: string;
};

export type HubspotDeal = {
  id: string;
  name: string;
  amountCents: number;
  stage: string;
  closeDateIso: string | null;
};

/**
 * Fetches the most recent contacts from HubSpot (up to 100 per call).
 * Uses the v3 CRM search API for consistent sorting.
 *
 * @param accessToken - HubSpot private app token or OAuth access token
 * @param limit       - Maximum number of contacts to return (default 100, max 100)
 */
export async function fetchHubspotContacts(
  accessToken: string,
  limit = 100
): Promise<HubspotContact[]> {
  const url = new URL(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts`);
  url.searchParams.set("properties", CONTACT_PROPERTIES);
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set("sort", "-createdate");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`HubSpot contacts API failed: HTTP ${response.status} — ${errorText}`);
  }

  const body = (await response.json()) as {
    results: Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;
  };

  return body.results.map((result) => ({
    id: result.id,
    firstName: result.properties["firstname"] ?? "",
    lastName: result.properties["lastname"] ?? "",
    email: result.properties["email"] ?? "",
    company: result.properties["company"] ?? "",
    phone: result.properties["phone"] ?? "",
    jobTitle: result.properties["jobtitle"] ?? "",
    lifecycleStage: result.properties["lifecyclestage"] ?? "lead",
    leadStatus: result.properties["hs_lead_status"] ?? "NEW",
  }));
}

/**
 * Fetches open deals from HubSpot CRM.
 * Only returns deals that are not in a "closed won" or "closed lost" stage.
 *
 * @param accessToken - HubSpot private app token or OAuth access token
 * @param limit       - Maximum number of deals to return (default 100)
 */
export async function fetchHubspotDeals(
  accessToken: string,
  limit = 100
): Promise<HubspotDeal[]> {
  const url = new URL(`${HUBSPOT_BASE_URL}/crm/v3/objects/deals`);
  url.searchParams.set("properties", DEAL_PROPERTIES);
  url.searchParams.set("limit", String(Math.min(limit, 100)));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`HubSpot deals API failed: HTTP ${response.status} — ${errorText}`);
  }

  const body = (await response.json()) as {
    results: Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;
  };

  return body.results.map((result) => {
    // HubSpot stores deal amount as a string like "1500.00"
    const amountStr = result.properties["amount"] ?? "0";
    const amountCents = Math.round(parseFloat(amountStr) * 100);

    return {
      id: result.id,
      name: result.properties["dealname"] ?? "",
      amountCents: isNaN(amountCents) ? 0 : amountCents,
      stage: result.properties["dealstage"] ?? "unknown",
      closeDateIso: result.properties["closedate"] ?? null,
    };
  });
}
