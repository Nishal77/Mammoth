import { db, companies, users } from "@mammoth/db";
import { eq } from "drizzle-orm";
import { planHasFeature, minimumPlanForFeature, getPlan } from "./plan-definitions.ts";
import type { PlanFeature, PlanTier } from "./plan-definitions.ts";

export type PlanGateResult =
  | { allowed: true }
  | { allowed: false; currentTier: PlanTier; requiredTier: PlanTier; feature: PlanFeature };

/**
 * Checks whether the owner of a company has the right plan to use a feature.
 * Returns allowed=false with the required upgrade tier when the feature is locked.
 *
 * @param companyId - The company making the request
 * @param feature   - The feature to check access for
 */
export async function checkPlanAccess(
  companyId: string,
  feature: PlanFeature
): Promise<PlanGateResult> {
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { ownerId: true },
  });

  if (!company) {
    return {
      allowed: false,
      currentTier: "free",
      requiredTier: minimumPlanForFeature(feature),
      feature,
    };
  }

  const owner = await db.query.users.findFirst({
    where: eq(users.id, company.ownerId),
    columns: { plan: true },
  });

  const currentTier = (owner?.plan ?? "free") as PlanTier;
  const hasAccess = planHasFeature(currentTier, feature);

  if (!hasAccess) {
    return {
      allowed: false,
      currentTier,
      requiredTier: minimumPlanForFeature(feature),
      feature,
    };
  }

  return { allowed: true };
}

/**
 * Checks whether a company can activate another department based on their plan.
 * Returns false once the plan's maxDepartments limit is reached.
 *
 * @param companyId          - The company making the request
 * @param activeDepartments  - How many departments are currently active
 */
export async function checkDepartmentLimit(
  companyId: string,
  activeDepartments: number
): Promise<{ allowed: true } | { allowed: false; limit: number; tier: PlanTier }> {
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { ownerId: true },
  });

  const owner = company
    ? await db.query.users.findFirst({
        where: eq(users.id, company.ownerId),
        columns: { plan: true },
      })
    : null;

  const plan = getPlan(owner?.plan ?? "free");

  if (activeDepartments >= plan.maxDepartments) {
    return {
      allowed: false,
      limit: plan.maxDepartments,
      tier: plan.tier,
    };
  }

  return { allowed: true };
}
