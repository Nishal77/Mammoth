import { db, companyMemory } from "@mammoth/memory-database";
import { inArray } from "drizzle-orm";
import { embed } from "./embedding-service.ts";
import { ensureMemoryCollection, memoryCollectionName, qdrant } from "./qdrant-client.ts";

export type SemanticMemoryResult = {
  memoryId: string;
  memoryType: string;
  key: string;
  value: string;
  score: number;
};

/**
 * Searches company memory semantically via Qdrant nearest-neighbor search.
 * Degrades gracefully to empty array if Qdrant is unreachable.
 * The SQL fallback in memory-loader.ts still runs — agents always get some context.
 *
 * @param companyId - Company to search within (its own collection)
 * @param query - Natural language query
 * @param limit - Max results (default 8)
 */
export async function semanticSearch(
  companyId: string,
  query: string,
  limit = 8
): Promise<SemanticMemoryResult[]> {
  try {
    const queryVector = await embed(query);
    await ensureMemoryCollection(companyId);

    const qdrantResults = await qdrant.search(memoryCollectionName(companyId), {
      vector: queryVector,
      limit,
      with_payload: true,
    });

    if (qdrantResults.length === 0) return [];

    const memoryIds = qdrantResults.map((r) => r.id as string);
    const memoryRows = await db.query.companyMemory.findMany({
      where: inArray(companyMemory.id, memoryIds),
      columns: { id: true, memoryType: true, key: true, value: true },
    });

    const rowMap = new Map(memoryRows.map((r) => [r.id, r]));

    const mapped: SemanticMemoryResult[] = [];
    for (const r of qdrantResults) {
      const row = rowMap.get(r.id as string);
      if (!row) continue;
      mapped.push({
        memoryId: row.id,
        memoryType: row.memoryType,
        key: row.key,
        value: row.value,
        score: r.score,
      });
    }
    return mapped;
  } catch {
    // Qdrant unavailable — agents still work via SQL memory in memory-loader
    return [];
  }
}
