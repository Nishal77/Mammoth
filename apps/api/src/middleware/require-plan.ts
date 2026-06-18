import type { FastifyReply, FastifyRequest } from "fastify";
import { checkPlanAccess } from "@mammoth/tool-billing";
import type { PlanFeature } from "@mammoth/tool-billing";

/**
 * Creates a Fastify preHandler that blocks requests if the company's plan
 * does not include the required feature.
 *
 * Usage in a route definition:
 * ```
 * app.post('/connect', {
 *   preHandler: [authenticate, requireCompanyAccess, requirePlan('integrations')]
 * }, handler)
 * ```
 *
 * Returns 403 with a clear upgrade message when the feature is locked.
 * The caller (frontend) uses the `requiredTier` field to show the correct upgrade prompt.
 *
 * @param feature - The plan feature required to access this route
 */
export function requirePlan(feature: PlanFeature) {
  return async function planGateMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // companyId comes from the URL param — set by require-company-access or earlier middleware
    const { companyId } = request.params as { companyId?: string };

    if (!companyId) {
      reply.status(400).send({
        error: "companyId is required in the route params",
        code: "MISSING_COMPANY_ID",
      });
      return;
    }

    const gateResult = await checkPlanAccess(companyId, feature);

    if (!gateResult.allowed) {
      reply.status(403).send({
        error: `This feature requires the ${gateResult.requiredTier} plan. You are on the ${gateResult.currentTier} plan.`,
        code: "PLAN_UPGRADE_REQUIRED",
        data: {
          currentTier: gateResult.currentTier,
          requiredTier: gateResult.requiredTier,
          feature: gateResult.feature,
        },
      });
    }
  };
}
