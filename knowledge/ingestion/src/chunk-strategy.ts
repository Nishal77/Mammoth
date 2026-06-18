const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 120;

export type TextChunk = {
  chunkIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
};

/**
 * Splits text into overlapping chunks using a recursive character strategy.
 * Tries to split on paragraph, then sentence, then word boundaries before
 * falling back to hard character splits. Preserves semantic continuity via overlap.
 *
 * @param text - Full document text
 * @param chunkSize - Target characters per chunk (default 800)
 * @param overlap - Characters to repeat at chunk boundaries (default 120)
 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) {
    return [{ chunkIndex: 0, text: normalized, charStart: 0, charEnd: normalized.length }];
  }

  const chunks: TextChunk[] = [];
  let pos = 0;
  let index = 0;

  while (pos < normalized.length) {
    const end = Math.min(pos + chunkSize, normalized.length);
    let splitAt = end;

    if (end < normalized.length) {
      // Try paragraph break first
      const paraBreak = normalized.lastIndexOf("\n\n", end);
      if (paraBreak > pos + chunkSize / 2) {
        splitAt = paraBreak + 2;
      } else {
        // Try sentence boundary
        const sentenceBreak = Math.max(
          normalized.lastIndexOf(". ", end),
          normalized.lastIndexOf("! ", end),
          normalized.lastIndexOf("? ", end)
        );
        if (sentenceBreak > pos + chunkSize / 2) {
          splitAt = sentenceBreak + 2;
        } else {
          // Try word boundary
          const wordBreak = normalized.lastIndexOf(" ", end);
          if (wordBreak > pos + chunkSize / 2) {
            splitAt = wordBreak + 1;
          }
        }
      }
    }

    chunks.push({
      chunkIndex: index,
      text: normalized.slice(pos, splitAt).trim(),
      charStart: pos,
      charEnd: splitAt,
    });

    index++;
    pos = Math.max(pos + 1, splitAt - overlap);
  }

  return chunks;
}
