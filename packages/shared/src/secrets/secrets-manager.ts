/**
 * Secrets manager abstraction.
 * Dev: reads from environment variables directly.
 * Production: swap the provider to HashiCorp Vault by setting VAULT_ADDR + VAULT_TOKEN.
 *
 * Usage pattern: always call getSecret() — never read process.env directly in business logic.
 * This makes it trivial to migrate to Vault without touching application code.
 */

type SecretsProvider = "env" | "vault";

const PROVIDER: SecretsProvider =
  process.env["VAULT_ADDR"] && process.env["VAULT_TOKEN"] ? "vault" : "env";

const VAULT_ADDR = process.env["VAULT_ADDR"] ?? "";
const VAULT_TOKEN = process.env["VAULT_TOKEN"] ?? "";
const VAULT_MOUNT = process.env["VAULT_MOUNT"] ?? "secret";

/**
 * Retrieves a secret by key.
 * In dev/env mode: reads from process.env directly.
 * In vault mode: fetches from HashiCorp Vault KV v2 at `{mount}/data/mammoth/{key}`.
 *
 * @param key - Secret name. Maps to env var name OR vault path segment.
 * @param fallback - Value to return if the secret is not found. Throws if omitted.
 */
export async function getSecret(key: string, fallback?: string): Promise<string> {
  if (PROVIDER === "vault") {
    return fetchFromVault(key, fallback);
  }
  return readFromEnv(key, fallback);
}

function readFromEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Secret "${key}" not found in environment. Set the env var or configure Vault.`);
}

async function fetchFromVault(key: string, fallback?: string): Promise<string> {
  // Vault KV v2 path: /v1/{mount}/data/mammoth/{key}
  const url = `${VAULT_ADDR}/v1/${VAULT_MOUNT}/data/mammoth/${key.toLowerCase()}`;

  const response = await fetch(url, {
    headers: {
      "X-Vault-Token": VAULT_TOKEN,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    if (response.status === 404 && fallback !== undefined) return fallback;
    if (response.status === 404) {
      throw new Error(`Secret "${key}" not found in Vault at path ${url}`);
    }
    throw new Error(`Vault request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as { data?: { data?: Record<string, string> } };
  const value = body.data?.data?.["value"];

  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Vault secret "${key}" exists but has no "value" field.`);
  }

  return value;
}

/**
 * Checks whether the secrets manager is configured and reachable.
 * Returns "env" | "vault" and whether it's healthy.
 */
export async function checkSecretsHealth(): Promise<{ provider: SecretsProvider; healthy: boolean; reason?: string }> {
  if (PROVIDER === "env") {
    return { provider: "env", healthy: true };
  }

  try {
    const url = `${VAULT_ADDR}/v1/sys/health`;
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { provider: "vault", healthy: response.ok };
  } catch (error) {
    return {
      provider: "vault",
      healthy: false,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
