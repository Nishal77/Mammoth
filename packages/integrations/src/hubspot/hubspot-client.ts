// HubSpot CRM API client — read contacts and deals, log activities and update lead status.

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

/**
 * Logs an email activity on a HubSpot contact.
 * Called after outreach emails are sent so the CRM reflects actual activity.
 *
 * @param accessToken - HubSpot token
 * @param contactId   - HubSpot contact ID to associate the activity with
 * @param subject     - Email subject line
 * @param bodyText    - Plain-text email body (truncated to 65k chars by HubSpot)
 * @param sentAt      - When the email was sent
 */
export async function logOutreachEmailInHubspot(
  accessToken: string,
  contactId: string,
  subject: string,
  bodyText: string,
  sentAt: Date
): Promise<void> {
  const response = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        hs_timestamp: sentAt.getTime().toString(),
        hs_email_direction: "EMAIL",
        hs_email_status: "SENT",
        hs_email_subject: subject,
        hs_email_text: bodyText.slice(0, 65_000),
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 9 }],
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`HubSpot email log failed: ${response.status} ${errorText}`);
  }
}

/**
 * Updates a HubSpot contact's lead status (e.g. NEW → IN_PROGRESS after first email).
 *
 * @param accessToken - HubSpot token
 * @param contactId   - HubSpot contact ID
 * @param leadStatus  - New lead status value
 */
export async function updateHubspotLeadStatus(
  accessToken: string,
  contactId: string,
  leadStatus: "NEW" | "OPEN" | "IN_PROGRESS" | "OPEN_DEAL" | "CONNECTED" | "UNQUALIFIED"
): Promise<void> {
  const response = await fetch(
    `${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { hs_lead_status: leadStatus } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`HubSpot contact update failed: ${response.status} ${errorText}`);
  }
}
