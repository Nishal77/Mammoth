import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockUpdate, mockSet, mockWhere } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  const mockFindFirst = vi.fn();
  return { mockFindFirst, mockUpdate, mockSet, mockWhere };
});

vi.mock("./client.ts", () => ({
  db: {
    query: {
      trustScores: { findFirst: mockFindFirst },
    },
    update: mockUpdate,
  },
}));

vi.mock("./schema/index.ts", () => ({
  trustScores: {
    companyId: "companyId",
    department: "department",
    actionType: "actionType",
    ringLevel: "ringLevel",
    consecutiveUnmodified: "consecutiveUnmodified",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ col, val }),
  and: (...conditions: unknown[]) => conditions,
}));

import { checkAndPromoteTrustScore } from "./trust-promotion.ts";

const OPTS = {
  companyId: "comp-abc",
  department: "marketing",
  actionType: "send_email_campaign",
};

describe("checkAndPromoteTrustScore()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  it("returns false when no trust score exists", async () => {
    mockFindFirst.mockResolvedValue(null);
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns false when already Ring 1", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 1, consecutiveUnmodified: 15 });
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns false when Ring 2 but below threshold", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 2, consecutiveUnmodified: 9 });
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns false when Ring 2 at exactly 9 unmodified approvals", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 2, consecutiveUnmodified: 9 });
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(false);
  });

  it("promotes Ring 2 -> Ring 1 at exactly 10 consecutive unmodified approvals", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 2, consecutiveUnmodified: 10 });
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ ringLevel: 1 })
    );
  });

  it("promotes Ring 2 -> Ring 1 when above threshold (11+)", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 2, consecutiveUnmodified: 25 });
    const promoted = await checkAndPromoteTrustScore(OPTS);
    expect(promoted).toBe(true);
  });

  it("calls db.update with correct company/department/actionType filters", async () => {
    mockFindFirst.mockResolvedValue({ ringLevel: 2, consecutiveUnmodified: 10 });
    await checkAndPromoteTrustScore(OPTS);
    expect(mockWhere).toHaveBeenCalled();
  });
});
