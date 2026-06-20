import { db, trustScores } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";

const PROMOTION_THRESHOLD = 10;

/**
 * Checks if a trust score has reached the promotion threshold and upgrades it.
 * 10 consecutive unmodified approvals for an action type → Ring 2 becomes Ring 1.
 * Called after every trust score update.
 */
export async function checkAndPromoteTrustScore(options: {
  companyId: string;
  department: string;
  actionType: string;
}): Promise<boolean> {
  const score = await db.query.trustScores.findFirst({
    where: and(
      eq(trustScores.companyId, options.companyId),
      eq(trustScores.department, options.department),
      eq(trustScores.actionType, options.actionType)
    ),
    columns: {
      ringLevel: true,
      consecutiveUnmodified: true,
    },
  });

  if (!score) return false;
  if (score.ringLevel !== 2) return false;
  if (score.consecutiveUnmodified < PROMOTION_THRESHOLD) return false;

  // Promote Ring 2 → Ring 1 for this action type
  await db
    .update(trustScores)
    .set({ ringLevel: 1, updatedAt: new Date() })
    .where(
      and(
        eq(trustScores.companyId, options.companyId),
        eq(trustScores.department, options.department),
        eq(trustScores.actionType, options.actionType)
      )
    );

  console.log(
    `[trust-promotion] Promoted ${options.department}/${options.actionType} Ring 2 → Ring 1`,
    { companyId: options.companyId, consecutiveUnmodified: score.consecutiveUnmodified }
  );

  return true;
}
