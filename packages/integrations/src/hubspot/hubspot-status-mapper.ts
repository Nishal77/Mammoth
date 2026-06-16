// Pure mapping functions with no dependencies — safe to import in tests without a DB.

export type LeadStatus =
  | "new"
  | "researched"
  | "in_sequence"
  | "replied"
  | "meeting_booked"
  | "converted"
  | "disqualified";

/**
 * Maps HubSpot lifecycle stage + lead status to MAMMOTH's lead status enum.
 *
 * HubSpot lifecycle stages: subscriber, lead, marketingqualifiedlead,
 *   salesqualifiedlead, opportunity, customer, evangelist, other
 * HubSpot lead statuses: NEW, OPEN, IN_PROGRESS, OPEN_DEAL, UNQUALIFIED,
 *   ATTEMPTED_TO_CONTACT, CONNECTED, BAD_TIMING
 *
 * MAMMOTH statuses: new | researched | in_sequence | replied |
 *                   meeting_booked | converted | disqualified
 */
export function mapHubspotStatusToLeadStatus(
  lifecycleStage: string,
  leadStatus: string
): LeadStatus {
  if (lifecycleStage === "customer" || lifecycleStage === "evangelist") {
    return "converted";
  }

  if (leadStatus === "UNQUALIFIED" || lifecycleStage === "other") {
    return "disqualified";
  }

  if (lifecycleStage === "salesqualifiedlead" || leadStatus === "IN_PROGRESS") {
    return "in_sequence";
  }

  if (leadStatus === "CONNECTED" || leadStatus === "OPEN") {
    return "researched";
  }

  return "new";
}
