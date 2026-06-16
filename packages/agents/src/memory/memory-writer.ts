import { db, companyMemory, memoryEmbeddings } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { embed, hashContent } from "./embedding-service.ts";
import { ensureMemoryCollection, memoryCollectionName, qdrant } from "./qdrant-client.ts";
import type { MemoryType } from "@mammoth/db";

export type UpsertMemoryOptions = {
  companyId: string;
  memoryType: MemoryType;
  key: string;
  value: string;
  source: string;
  confidence?: number;
};

/**
 * Upserts a memory entry to Postgres and syncs the embedding to Qdrant.
 * Skips re-embedding when the content hash is unchanged (value not modified).
 *
 * @param options - Memory entry details
 * @returns The persisted memory row id
 */
export async function upsertMemory(options: UpsertMemoryOptions): Promise<string> {
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
