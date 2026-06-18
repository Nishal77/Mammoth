import { z } from "zod";

const EXA_BASE_URL = "https://api.exa.ai";
const REQUEST_TIMEOUT_MS = 15_000;

const ExaSearchResultSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  score: z.number().nullable(),
  publishedDate: z.string().nullable(),
  author: z.string().nullable(),
  text: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

const ExaSearchResponseSchema = z.object({
  results: z.array(ExaSearchResultSchema),
  requestId: z.string().optional(),
});

export type ExaSearchResult = {
  url: string;
  title: string;
  snippet: string;
  publishedDate: string | null;
  relevanceScore: number;
};

export type ExaSearchOptions = {
  query: string;
  numResults?: number;
  /** Include full text of each result */
  includeText?: boolean;
  /** Only return results published after this date (ISO format) */
  startPublishedDate?: string;
  /** Limit results to these domains */
  includeDomains?: string[];
  /** Exclude these domains from results */
  excludeDomains?: string[];
};

/**
 * Searches the live web using Exa AI's neural search API.
 * Returns semantically relevant results grounded in real current content.
 * Used by Research agent for competitor intel and market analysis.
 *
 * @param apiKey - Exa API key
 * @param options - Search query and result configuration
 */
export async function searchWeb(
  apiKey: string,
  options: ExaSearchOptions
): Promise<ExaSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      query: options.query,
      numResults: Math.min(options.numResults ?? 10, 25),
      type: "neural",
      useAutoprompt: true,
      contents: {
        text: options.includeText ?? true,
        highlights: { numSentences: 3, highlightsPerUrl: 2 },
      },
    };

    if (options.startPublishedDate) body["startPublishedDate"] = options.startPublishedDate;
    if (options.includeDomains?.length) body["includeDomains"] = options.includeDomains;
    if (options.excludeDomains?.length) body["excludeDomains"] = options.excludeDomains;

    const response = await fetch(`${EXA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    const parsed = ExaSearchResponseSchema.parse(raw);

    return parsed.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      snippet: r.highlights?.join(" ") ?? r.text?.slice(0, 500) ?? "",
      publishedDate: r.publishedDate,
      relevanceScore: r.score ?? 0.5,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Finds similar pages to a given URL using Exa's findSimilar endpoint.
 * Used by Research agent to find competitors' related content.
 *
 * @param apiKey - Exa API key
 * @param url - Source URL to find similar content for
 * @param numResults - Number of similar results to return
 */
export async function findSimilarPages(
  apiKey: string,
  url: string,
  numResults = 5
): Promise<ExaSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${EXA_BASE_URL}/findSimilar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ url, numResults, contents: { text: true } }),
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const raw = await response.json();
    const parsed = ExaSearchResponseSchema.parse(raw);

    return parsed.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      snippet: r.text?.slice(0, 500) ?? "",
      publishedDate: r.publishedDate,
      relevanceScore: r.score ?? 0.5,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Formats Exa search results into a concise context block for agent prompts.
 * Prevents prompt bloat while preserving the most relevant signal.
 *
 * @param results - Array of search results from searchWeb()
 * @param maxLength - Maximum character length for the formatted output
 */
export function formatSearchResultsForPrompt(
  results: ExaSearchResult[],
  maxLength = 3000
): string {
  const lines: string[] = [];

  for (const result of results) {
    const entry = [
      `[${result.title}](${result.url})`,
      result.publishedDate ? `Published: ${result.publishedDate}` : null,
      result.snippet ? result.snippet : null,
    ]
      .filter(Boolean)
      .join("\n");

    if (lines.join("\n\n").length + entry.length > maxLength) break;
    lines.push(entry);
  }

  return lines.join("\n\n---\n\n");
}
