import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env["QDRANT_URL"] ?? "http://localhost:6333";
const QDRANT_API_KEY = process.env["QDRANT_API_KEY"];

// text-embedding-3-small output dimension
export const EMBEDDING_DIMENSION = 1536;

// One collection per company — architectural isolation, not a query preference.
export const qdrant = QDRANT_API_KEY
  ? new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY })
  : new QdrantClient({ url: QDRANT_URL });

/**
 * Returns the Qdrant collection name for a given company.
 * Hyphens stripped to satisfy Qdrant collection name rules.
 */
export function memoryCollectionName(companyId: string): string {
  return `mammoth_${companyId.replace(/-/g, "")}`;
}

/**
 * Ensures the per-company Qdrant collection exists.
 * No-op if already present — safe to call before every upsert.
 */
export async function ensureMemoryCollection(companyId: string): Promise<void> {
  const name = memoryCollectionName(companyId);
  try {
    await qdrant.getCollection(name);
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size: EMBEDDING_DIMENSION, distance: "Cosine" },
    });
  }
}
