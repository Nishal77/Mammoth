import OpenAI from "openai";
import { createHash } from "crypto";
import { MODELS } from "../router/model-router.ts";

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
    model: MODELS.EMBEDDING,
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
