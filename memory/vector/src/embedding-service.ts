import OpenAI from "openai";
import { createHash } from "crypto";

// Pinned here so memory-vector doesn't depend on agent-base (which depends on memory-retrieval → memory-vector).
const EMBEDDING_MODEL = "text-embedding-3-small";

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

/**
 * Generates a 1536-dimension embedding vector via text-embedding-3-small.
 * Input is silently truncated at 8191 chars (model limit).
 *
 * @param text - Text to embed
 * @returns Float32 vector of length 1536
 */
export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8191),
  });
  return response.data[0]!.embedding;
}

/**
 * Returns a SHA-256 hex digest of the content string.
 * Used to detect stale embeddings without re-reading the full value.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
