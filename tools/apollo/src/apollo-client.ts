import { z } from "zod";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;

const ApolloPersonSchema = z.object({
  id: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  organization_name: z.string().nullable(),
  employment_history: z.array(z.object({ current: z.boolean().optional() })).optional(),
  seniority: z.string().nullable(),
  phone_numbers: z.array(z.object({ sanitized_number: z.string() })).optional(),
});

const ApolloOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  website_url: z.string().nullable(),
  employees: z.number().nullable(),
  industry: z.string().nullable(),
  annual_revenue: z.number().nullable(),
});

const ApolloSearchResponseSchema = z.object({
  people: z.array(ApolloPersonSchema),
  pagination: z.object({
    page: z.number(),
    per_page: z.number(),
    total_entries: z.number(),
  }),
});

const ApolloEnrichResponseSchema = z.object({
  person: ApolloPersonSchema.nullable(),
  organization: ApolloOrganizationSchema.nullable().optional(),
});

export type ApolloLead = {
  apolloId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  title: string;
  company: string;
  linkedinUrl: string | null;
  seniority: string | null;
  phone: string | null;
};

export type ApolloSearchFilters = {
  personTitles?: string[];
  organizationNumEmployeesRanges?: string[];
  organizationIndustryTagIds?: string[];
  personLocations?: string[];
  keywords?: string[];
  page?: number;
  perPage?: number;
};

/**
 * Searches Apollo.io for leads matching the given filters.
 * Returns structured lead records ready for MAMMOTH leads table.
 *
 * @param apiKey - Apollo.io API key from company integrations
 * @param filters - Search filters (titles, company sizes, locations, etc.)
 */
export async function searchApolloLeads(
  apiKey: string,
  filters: ApolloSearchFilters
): Promise<ApolloLead[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        person_titles: filters.personTitles ?? [],
        organization_num_employees_ranges: filters.organizationNumEmployeesRanges ?? [],
        organization_industry_tag_ids: filters.organizationIndustryTagIds ?? [],
        person_locations: filters.personLocations ?? [],
        q_keywords: filters.keywords?.join(" ") ?? "",
        page: filters.page ?? 1,
        per_page: Math.min(filters.perPage ?? 25, 100),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Apollo API error: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    const parsed = ApolloSearchResponseSchema.parse(raw);

    return parsed.people.map(mapApolloPersonToLead);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Enriches a single person by email address via Apollo.io.
 * Returns null if no match found (not a hard error — the person may not be in Apollo).
 *
 * @param apiKey - Apollo.io API key
 * @param email - Email address to enrich
 */
export async function enrichLeadByEmail(
  apiKey: string,
  email: string
): Promise<ApolloLead | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ email, reveal_personal_emails: false }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const raw = await response.json();
    const parsed = ApolloEnrichResponseSchema.parse(raw);

    if (!parsed.person) return null;
    return mapApolloPersonToLead(parsed.person);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mapApolloPersonToLead(person: z.infer<typeof ApolloPersonSchema>): ApolloLead {
  const firstName = person.first_name ?? person.name?.split(" ")[0] ?? "";
  const lastName =
    person.last_name ??
    person.name?.split(" ").slice(1).join(" ") ??
    "";

  return {
    apolloId: person.id,
    firstName,
    lastName,
    email: person.email,
    title: person.title ?? "",
    company: person.organization_name ?? "",
    linkedinUrl: person.linkedin_url,
    seniority: person.seniority,
    phone: person.phone_numbers?.[0]?.sanitized_number ?? null,
  };
}
