import { embed, ensureMemoryCollection, memoryCollectionName, qdrant } from "@mammoth/memory-vector";
import type { KnowledgeDocType } from "@mammoth/memory-database";

export type KnowledgeChunk = {
  docId: string;
  docType: KnowledgeDocType;
  department: string;
  filename: string;
  text: string;
  score: number;
};

export type KnowledgeRetrievalOptions = {
  companyId: string;
  query: string;
  /** Filter to chunks for a specific department or "all" (shared). Pass department name to include both dept-specific and "all". */
  department?: string;
  docType?: KnowledgeDocType;
  limit?: number;
};

/**
 * Retrieves relevant knowledge chunks from the company Qdrant collection.
 * Filters by source="knowledge" so memory entries are not mixed with knowledge docs.
 * Degrades gracefully to empty array if Qdrant is unavailable.
 *
 * @param options - Query and filter options
 * @returns Ranked knowledge chunks, most relevant first
 */
export async function retrieveKnowledge(options: KnowledgeRetrievalOptions): Promise<KnowledgeChunk[]> {
  const { companyId, query, department, docType, limit = 6 } = options;

  try {
    await ensureMemoryCollection(companyId);
    const queryVector = await embed(query);

    const filter: Record<string, unknown> = {
      must: [
        { key: "source", match: { value: "knowledge" } },
        ...(docType ? [{ key: "docType", match: { value: docType } }] : []),
        ...(department
          ? [{
              should: [
                { key: "department", match: { value: department } },
                { key: "department", match: { value: "all" } },
              ],
            }]
          : []),
      ],
    };

    const results = await qdrant.search(memoryCollectionName(companyId), {
      vector: queryVector,
      limit,
      with_payload: true,
      filter,
    });

    return results.map((r) => ({
      docId: r.payload?.["docId"] as string,
      docType: r.payload?.["docType"] as KnowledgeDocType,
      department: r.payload?.["department"] as string,
      filename: r.payload?.["filename"] as string,
      text: r.payload?.["text"] as string,
      score: r.score,
    }));
  } catch {
    return [];
  }
}

/**
 * Formats retrieved knowledge chunks into a context block for injection into agent prompts.
 * Wrapped in <knowledge> tags so the model can distinguish it from memory context.
 */
export function formatKnowledgeContext(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return "";

  const sections = chunks.map((c, i) =>
    `[${i + 1}] ${c.docType.toUpperCase()} — ${c.filename}\n${c.text}`
  );

  return `<knowledge>\n${sections.join("\n\n---\n\n")}\n</knowledge>`;
}
