import { db, companyMemory, memoryEmbeddings } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { embed, hashContent } from "@mammoth/memory-vector";
import { ensureMemoryCollection, memoryCollectionName, qdrant } from "@mammoth/memory-vector";
import type { MemoryType } from "@mammoth/memory-database";

export type UpsertMemoryOptions = {
  companyId: string;
  memoryType: MemoryType;
  key: string;
  value: string;
  source: string;
  confidence?: number;
};

// Types where near-duplicate entries bloat context without adding signal.
const DEDUP_MEMORY_TYPES = new Set(["product_lesson", "playbook_refinement"]);
// Cosine similarity threshold above which a new entry is considered a duplicate.
const DEDUP_SIMILARITY_THRESHOLD = 0.92;

/**
 * Upserts a memory entry to Postgres and syncs the embedding to Qdrant.
 * For `product_lesson` and `playbook_refinement` types, skips the write when
 * a semantically near-identical entry already exists (similarity ≥ 0.92).
 * This prevents the context window from filling with redundant lessons over time.
 *
 * @param options - Memory entry details
 * @returns The persisted memory row id, or existing row id when deduped
 */
export async function upsertMemory(options: UpsertMemoryOptions): Promise<string> {
  if (DEDUP_MEMORY_TYPES.has(options.memoryType)) {
    const isDuplicate = await isNearDuplicate(options.companyId, options.value);
    if (isDuplicate) return "deduped";
  }
  const [row] = await db
    .insert(companyMemory)
    .values({
      companyId: options.companyId,
      memoryType: options.memoryType,
      key: options.key,
      value: options.value,
      source: options.source,
      confidence: options.confidence?.toString(),
    })
    .onConflictDoUpdate({
      target: [companyMemory.companyId, companyMemory.memoryType, companyMemory.key],
      set: {
        value: options.value,
        source: options.source,
        updatedAt: new Date(),
      },
    })
    .returning({ id: companyMemory.id });

  const memoryId = row!.id;
  const hash = hashContent(options.value);

  // Only re-embed if value changed (hash mismatch)
  const existingEmbedding = await db.query.memoryEmbeddings.findFirst({
    where: and(
      eq(memoryEmbeddings.memoryId, memoryId),
      eq(memoryEmbeddings.contentHash, hash)
    ),
    columns: { id: true },
  });

  if (!existingEmbedding) {
    await syncEmbedding({
      companyId: options.companyId,
      memoryId,
      memoryType: options.memoryType,
      key: options.key,
      value: options.value,
      hash,
    });
  }

  return memoryId;
}

async function syncEmbedding(opts: {
  companyId: string;
  memoryId: string;
  memoryType: string;
  key: string;
  value: string;
  hash: string;
}): Promise<void> {
  const text = `${opts.memoryType}: ${opts.key}\n${opts.value}`;
  const vector = await embed(text);

  await ensureMemoryCollection(opts.companyId);

  // Use memoryId as the Qdrant point ID — deterministic, no extra mapping needed
  await qdrant.upsert(memoryCollectionName(opts.companyId), {
    wait: true,
    points: [
      {
        id: opts.memoryId,
        vector,
        payload: {
          memoryType: opts.memoryType,
          key: opts.key,
          companyId: opts.companyId,
        },
      },
    ],
  });

  // Remove stale embedding record, write fresh one
  await db
    .delete(memoryEmbeddings)
    .where(eq(memoryEmbeddings.memoryId, opts.memoryId));

  await db.insert(memoryEmbeddings).values({
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    contentHash: opts.hash,
    qdrantPointId: opts.memoryId,
  });
}

/**
 * Returns true when an existing memory entry in Qdrant has cosine similarity
 * ≥ DEDUP_SIMILARITY_THRESHOLD with the candidate value.
 * Fails open — if Qdrant is unavailable, returns false (allow write).
 */
async function isNearDuplicate(companyId: string, value: string): Promise<boolean> {
  try {
    await ensureMemoryCollection(companyId);
    const vector = await embed(value);
    const results = await qdrant.search(memoryCollectionName(companyId), {
      vector,
      limit: 1,
      with_payload: false,
      score_threshold: DEDUP_SIMILARITY_THRESHOLD,
    });
    return results.length > 0;
  } catch {
    return false;
  }
}
