import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM: 32-byte key, 12-byte IV, 16-byte auth tag.
// In production, swap getEncryptionKey() to fetch a data key from AWS KMS.
// The env var approach is dev-only — never store a KMS key in an env var.
const ALGORITHM = "aes-256-gcm";
const KEY_HEX_LENGTH = 64; // 32 bytes = 64 hex characters
const IV_BYTE_LENGTH = 12; // 96-bit IV recommended for GCM mode
const SEPARATOR = ":";
const SEGMENT_COUNT = 3;

/**
 * Reads the encryption key from the environment.
 * In production this should be replaced with a KMS data key fetch.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env["OAUTH_ENCRYPTION_KEY"];

  if (!keyHex || keyHex.length !== KEY_HEX_LENGTH) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Run: openssl rand -hex 32"
    );
  }

  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypts a plain-text OAuth token using AES-256-GCM.
 * Returns a colon-separated string: `iv:authTag:ciphertext` (all hex-encoded).
 * The IV is randomly generated per call, so the same input never produces
 * the same ciphertext twice — safe for deterministic lookups is NOT a goal here.
 *
 * @param plaintext - The raw token string to encrypt (e.g. "ya29.abc123...")
 * @returns Encrypted hex string in the format "iv:authTag:ciphertext"
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encryptedBuffer = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encryptedBuffer.toString("hex"),
  ].join(SEPARATOR);
}

/**
 * Decrypts a token produced by encryptToken().
 * Throws if the format is wrong or if GCM authentication fails (tampered data).
 *
 * @param encrypted - The "iv:authTag:ciphertext" hex string from the database
 * @returns The original plain-text token
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(SEPARATOR);

  if (parts.length !== SEGMENT_COUNT) {
    throw new Error(
      `Invalid encrypted token format. Expected ${SEGMENT_COUNT} colon-separated hex segments.`
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decryptedBuffer.toString("utf8");
}
