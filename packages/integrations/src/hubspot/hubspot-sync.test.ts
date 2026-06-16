import { describe, it, expect } from "vitest";
import { mapHubspotStatusToLeadStatus } from "./hubspot-status-mapper.ts";

// Tests for the HubSpot → MAMMOTH status mapping logic.
// Also covers name construction and amount parsing which mirror the sync logic.
// DB integration tests are kept separate (require a live database).

describe("mapHubspotStatusToLeadStatus", () => {
  it("maps customer lifecycle to converted", () => {
    expect(mapHubspotStatusToLeadStatus("customer", "")).toBe("converted");
  });

  it("maps evangelist to converted", () => {
    expect(mapHubspotStatusToLeadStatus("evangelist", "")).toBe("converted");
  });

  it("maps UNQUALIFIED lead status to disqualified", () => {
    expect(mapHubspotStatusToLeadStatus("lead", "UNQUALIFIED")).toBe("disqualified");
  });

  it("maps other lifecycle stage to disqualified", () => {
    expect(mapHubspotStatusToLeadStatus("other", "")).toBe("disqualified");
  });

  it("maps salesqualifiedlead to in_sequence", () => {
    expect(mapHubspotStatusToLeadStatus("salesqualifiedlead", "NEW")).toBe("in_sequence");
  });

  it("maps IN_PROGRESS lead status to in_sequence", () => {
    expect(mapHubspotStatusToLeadStatus("lead", "IN_PROGRESS")).toBe("in_sequence");
  });

  it("maps CONNECTED lead status to researched", () => {
    expect(mapHubspotStatusToLeadStatus("subscriber", "CONNECTED")).toBe("researched");
  });

  it("maps OPEN lead status to researched", () => {
    expect(mapHubspotStatusToLeadStatus("subscriber", "OPEN")).toBe("researched");
  });

  it("defaults unknown stages to new", () => {
    expect(mapHubspotStatusToLeadStatus("lead", "NEW")).toBe("new");
    expect(mapHubspotStatusToLeadStatus("", "")).toBe("new");
  });
});

describe("HubSpot contact name construction", () => {
  it("joins first and last name", () => {
    const name = buildFullName("John", "Doe");
    expect(name).toBe("John Doe");
  });

  it("handles missing last name", () => {
    const name = buildFullName("John", "");
    expect(name).toBe("John");
  });

  it("handles missing first name", () => {
    const name = buildFullName("", "Doe");
    expect(name).toBe("Doe");
  });

  it("returns empty string when both names are empty", () => {
    expect(buildFullName("", "")).toBe("");
  });
});

describe("HubSpot deal amount parsing", () => {
  it("converts string amount to cents", () => {
    expect(amountStringToCents("1500.00")).toBe(150000);
  });

  it("handles integer string", () => {
    expect(amountStringToCents("99")).toBe(9900);
  });

  it("returns 0 for empty string", () => {
    expect(amountStringToCents("")).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(amountStringToCents(null)).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(amountStringToCents("not-a-number")).toBe(0);
  });

  it("rounds floating point cents correctly", () => {
    expect(amountStringToCents("10.005")).toBe(1001);
  });
});

// ---- Pure helper implementations (mirror the sync logic for testability) ----

function buildFullName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function amountStringToCents(amountStr: string | null | undefined): number {
  if (!amountStr) return 0;
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return 0;
  return Math.round(amount * 100);
}
