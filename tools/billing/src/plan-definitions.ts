// MAMMOTH subscription plans.
// All limits are enforced server-side — not just in UI.

export type PlanTier = "free" | "growth" | "scale" | "enterprise";

export type PlanFeature =
  | "departments_all"   // Access to all 9 departments
  | "integrations"      // External integrations (Stripe, HubSpot, GitHub, Slack)
  | "semantic_memory"   // Qdrant vector search
  | "daily_briefings"   // Automated daily/weekly briefings
  | "slack_digest"      // Slack channel notifications
  | "api_access";       // Programmatic API access

export type PlanDefinition = {
  tier: PlanTier;
  /** Max departments the company can activate */
  maxDepartments: number;
  /** Max agent tasks per day across all departments */
  maxTasksPerDay: number;
  /** Max daily AI spend in USD before agents pause */
  maxAiCostPerDayUsd: number;
  /** Which features are unlocked on this plan */
  features: Set<PlanFeature>;
  /** Monthly price in cents (0 for free) */
  monthlyPriceCents: number;
};

// The plans are defined as a constant record so they are easy to look up by tier.
export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    maxDepartments: 1,
    maxTasksPerDay: 5,
    maxAiCostPerDayUsd: 0.5,
    features: new Set([] as PlanFeature[]),
    monthlyPriceCents: 0,
  },

  growth: {
    tier: "growth",
    maxDepartments: 5,
    maxTasksPerDay: 50,
    maxAiCostPerDayUsd: 5,
    features: new Set<PlanFeature>([
      "integrations",
      "semantic_memory",
      "daily_briefings",
    ]),
    monthlyPriceCents: 9900,
  },

  scale: {
    tier: "scale",
    maxDepartments: 9,
    maxTasksPerDay: 500,
    maxAiCostPerDayUsd: 50,
    features: new Set<PlanFeature>([
      "departments_all",
      "integrations",
      "semantic_memory",
      "daily_briefings",
      "slack_digest",
      "api_access",
    ]),
    monthlyPriceCents: 29900,
  },

  enterprise: {
    tier: "enterprise",
    maxDepartments: 9,
    maxTasksPerDay: Infinity,
    maxAiCostPerDayUsd: Infinity,
    features: new Set<PlanFeature>([
      "departments_all",
      "integrations",
      "semantic_memory",
      "daily_briefings",
      "slack_digest",
      "api_access",
    ]),
    monthlyPriceCents: 0, // custom pricing
  },
};

/**
 * Returns the plan definition for a tier.
 * Falls back to free if the tier is somehow unknown.
 */
export function getPlan(tier: string): PlanDefinition {
  return PLANS[tier as PlanTier] ?? PLANS.free;
}

/**
 * Checks whether a plan includes a specific feature.
 *
 * @param tier    - The user's current plan tier
 * @param feature - The feature to check
 */
export function planHasFeature(tier: string, feature: PlanFeature): boolean {
  return getPlan(tier).features.has(feature);
}

/**
 * Returns the minimum plan tier required for a feature.
 * Useful for upgrade prompts ("Upgrade to Growth to unlock integrations").
 */
export function minimumPlanForFeature(feature: PlanFeature): PlanTier {
  const order: PlanTier[] = ["free", "growth", "scale", "enterprise"];

  for (const tier of order) {
    if (PLANS[tier].features.has(feature)) return tier;
  }

  return "enterprise";
}
