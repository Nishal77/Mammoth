import { db, policyOverrides } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";

export type PolicyRuleOverrides = {
  /** DB-sourced additions to ALWAYS_RING_3. Cannot remove hardcoded defaults. */
  alwaysRing3Extra: ReadonlySet<string>;
  /** DB-sourced additions to PERMANENTLY_BLOCKED. Cannot remove hardcoded defaults. */
  permanentlyBlockedExtra: ReadonlySet<string>;
};

const CACHE_TTL_MS = 5 * 60 * 1_000;

type CacheEntry = { overrides: PolicyRuleOverrides; expiresAt: number };
let ruleCache: CacheEntry | null = null;

/**
 * Returns merged policy rule overrides from the DB, cached for 5 minutes.
 * On DB failure, returns an empty override set so hardcoded defaults still apply.
 *
 * The cache is global per-process — safe because BullMQ workers are isolated
 * processes and AsyncLocalStorage handles per-job dispatch context separately.
 */
export async function loadPolicyRuleOverrides(): Promise<PolicyRuleOverrides> {
  const now = Date.now();
  if (ruleCache && ruleCache.expiresAt > now) return ruleCache.overrides;

  try {
    const rows = await db
      .select({
        ruleSet: policyOverrides.ruleSet,
        actionType: policyOverrides.actionType,
      })
      .from(policyOverrides)
      .where(eq(policyOverrides.isActive, true));

    const alwaysRing3Extra = new Set<string>();
    const permanentlyBlockedExtra = new Set<string>();

    for (const row of rows) {
      if (row.ruleSet === "always_ring3") alwaysRing3Extra.add(row.actionType);
      else if (row.ruleSet === "permanently_blocked") permanentlyBlockedExtra.add(row.actionType);
    }

    const overrides: PolicyRuleOverrides = { alwaysRing3Extra, permanentlyBlockedExtra };
    ruleCache = { overrides, expiresAt: now + CACHE_TTL_MS };
    return overrides;
  } catch {
    // Fail open — hardcoded defaults in policy-constants.ts remain in force.
    return { alwaysRing3Extra: new Set(), permanentlyBlockedExtra: new Set() };
  }
}
