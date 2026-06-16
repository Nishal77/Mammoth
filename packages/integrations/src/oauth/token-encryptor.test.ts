import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "./token-encryptor.ts";

// A valid 32-byte key in hex format for testing
const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

describe("token-encryptor", () => {
  beforeEach(() => {
    // Set the env var before each test
    process.env["OAUTH_ENCRYPTION_KEY"] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env["OAUTH_ENCRYPTION_KEY"];
  });

  describe("encryptToken", () => {
    it("returns a colon-separated string with 3 parts", () => {
      const encrypted = encryptToken("my-secret-token");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);
    });

    it("each part is a non-empty hex string", () => {
      const encrypted = encryptToken("my-secret-token");
      const [iv, authTag, ciphertext] = encrypted.split(":");
      expect(iv).toMatch(/^[0-9a-f]+$/);
      expect(authTag).toMatch(/^[0-9a-f]+$/);
      expect(ciphertext).toMatch(/^[0-9a-f]+$/);
    });

    it("produces different output each time (random IV)", () => {
      const first = encryptToken("same-token");
      const second = encryptToken("same-token");
      expect(first).not.toBe(second);
    });

    it("throws when OAUTH_ENCRYPTION_KEY is missing", () => {
      delete process.env["OAUTH_ENCRYPTION_KEY"];
      expect(() => encryptToken("token")).toThrow("OAUTH_ENCRYPTION_KEY");
    });

    it("throws when OAUTH_ENCRYPTION_KEY is wrong length", () => {
      process.env["OAUTH_ENCRYPTION_KEY"] = "tooshort";
      expect(() => encryptToken("token")).toThrow("OAUTH_ENCRYPTION_KEY");
    });
  });

  describe("decryptToken", () => {
    it("roundtrips a simple token", () => {
      const original = "ya29.access-token-xyz";
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(original);
    });

    it("roundtrips a token with special characters", () => {
      const original = "token with spaces & special=chars+and/slashes";
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(original);
    });

    it("roundtrips a long token (simulating a JWT)", () => {
      const original = "eyJhbGciOiJIUzI1NiJ9." + "x".repeat(300);
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(original);
    });

    it("roundtrips an empty string", () => {
      const encrypted = encryptToken("");
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe("");
    });

    it("throws on invalid format (not 3 segments)", () => {
      expect(() => decryptToken("only:two")).toThrow("Invalid encrypted token format");
      expect(() => decryptToken("one")).toThrow("Invalid encrypted token format");
      expect(() => decryptToken("a:b:c:d")).toThrow("Invalid encrypted token format");
    });

    it("throws when auth tag is tampered (GCM integrity check)", () => {
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");

      // Flip a byte in the auth tag
      const tamperedAuthTag = parts[1]!.slice(0, -2) + "ff";
      const tampered = [parts[0], tamperedAuthTag, parts[2]].join(":");

      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws when ciphertext is tampered", () => {
      const encrypted = encryptToken("real-token");
      const parts = encrypted.split(":");

      // Append garbage to ciphertext
      const tamperedCiphertext = parts[2] + "deadbeef";
      const tampered = [parts[0], parts[1], tamperedCiphertext].join(":");

      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws when OAUTH_ENCRYPTION_KEY is missing during decryption", () => {
      const encrypted = encryptToken("token");
      delete process.env["OAUTH_ENCRYPTION_KEY"];
      expect(() => decryptToken(encrypted)).toThrow("OAUTH_ENCRYPTION_KEY");
    });

    it("throws when decrypting with a different key (wrong key)", () => {
      const encrypted = encryptToken("secret");

      // Change to a different key
      process.env["OAUTH_ENCRYPTION_KEY"] = "b".repeat(64);
      expect(() => decryptToken(encrypted)).toThrow();
    });
  });
});
