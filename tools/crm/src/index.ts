export { fetchHubspotContacts, fetchHubspotDeals } from "./hubspot-client.ts";
export type { HubspotContact, HubspotDeal } from "./hubspot-client.ts";

export { syncHubspot } from "./hubspot-sync.ts";
export type { HubspotSyncResult } from "./hubspot-sync.ts";

export { mapHubspotStatusToLeadStatus } from "./hubspot-status-mapper.ts";
export type { LeadStatus } from "./hubspot-status-mapper.ts";
