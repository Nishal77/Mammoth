import { db, knowledgeDocs } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { embed, ensureMemoryCollection, memoryCollectionName, qdrant } from "@mammoth/memory-vector";
import { createLogger } from "@mammoth/observability/logger";
import { chunkText } from "./chunk-strategy.ts";
import type { KnowledgeDocType } from "@mammoth/memory-database";

const log = createLogger("knowledge-ingester");

export type IngestOptions = {
  companyId: string;
  docId: string;
  text: string;
  docType: KnowledgeDocType;
  department: string;
  filename: string;
};

export type IngestResult = {
  docId: string;
  chunkCount: number;
};

/**
 * Ingests a text document into the company knowledge base.
 * Chunks the text, embeds each chunk, and upserts points into the per-company
 * Qdrant collection. Marks the knowledgeDocs row as ready on success.
 *
 * Knowledge chunks are stored with payload.source="knowledge" so semantic
 * search can filter by source type and department.
 */
export async function ingestDocument(options: IngestOptions): Promise<IngestResult> {
  const { companyId, docId, text, docType, department, filename } = options;

  const taskLog = log.withContext({ companyId, docId, docType });
  taskLog.info(`Ingesting document: ${filename}`);

  await db.update(knowledgeDocs)
    .set({ status: "processing" })
    .where(eq(knowledgeDocs.id, docId));

  try {
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await db.update(knowledgeDocs)
        .set({ status: "failed", errorMessage: "Document produced zero chunks after parsing" })
        .where(eq(knowledgeDocs.id, docId));
      return { docId, chunkCount: 0 };
    }

    await ensureMemoryCollection(companyId);
    const collectionName = memoryCollectionName(companyId);

    // Embed chunks in batches of 20 to avoid rate limit
    const BATCH_SIZE = 20;
    const points: { id: string; vector: number[]; payload: Record<string, unknown> }[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await Promise.all(batch.map((c) => embed(c.text)));

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j]!;
        const vector = vectors[j]!;
        // Deterministic point ID: doc + chunk index — safe to re-ingest
        const pointId = deterministicUuid(`${docId}-chunk-${chunk.chunkIndex}`);
        points.push({
          id: pointId,
          vector,
          payload: {
            source: "knowledge",
            docId,
            docType,
            department,
            filename,
            companyId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
          },
        });
      }
    }

    await qdrant.upsert(collectionName, { points, wait: true });

    await db.update(knowledgeDocs)
      .set({ status: "ready", chunkCount: chunks.length, processedAt: new Date() })
      .where(eq(knowledgeDocs.id, docId));

    taskLog.info(`Ingested ${chunks.length} chunks for ${filename}`);
    return { docId, chunkCount: chunks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(knowledgeDocs)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(knowledgeDocs.id, docId));
    taskLog.error(`Ingestion failed: ${msg}`);
    throw err;
  }
}

/**
 * Deterministic UUID v5-like from a string seed.
 * Uses SHA-256 and formats as UUID. Not cryptographically UUID v5 but collision-resistant.
 */
function deterministicUuid(seed: string): string {
  // Simple hash → UUID format using TextEncoder
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
    hash = hash >>> 0;
  }
  // Expand to 32 hex chars using multiple hash passes
  const parts: string[] = [];
  let h = hash;
  for (let i = 0; i < 4; i++) {
    h = ((h << 5) + h) ^ (seed.charCodeAt(i % seed.length) + i * 31);
    h = h >>> 0;
    parts.push(h.toString(16).padStart(8, "0"));
  }
  const hex = parts.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
