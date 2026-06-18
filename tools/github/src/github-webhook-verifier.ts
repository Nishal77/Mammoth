import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a GitHub webhook signature using HMAC-SHA256.
 * GitHub sends the signature in the `x-hub-signature-256` header.
 *
 * Timing-safe comparison prevents timing attacks.
 * Returns false on any validation failure — never throws.
 *
 * @param payload    - Raw request body as a Buffer or string
 * @param signature  - Value of the `x-hub-signature-256` header
 * @param secret     - Webhook secret configured in GitHub repo settings
 */
export function verifyGithubWebhookSignature(
  payload: Buffer | string,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const rawBody = typeof payload === "string" ? Buffer.from(payload) : payload;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
  );
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
