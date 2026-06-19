/**
 * Unit tests for the dispatch-context security primitive.
 *
 * The dispatch context enforces that write tools are only callable from
 * inside an approved action execution — never directly from agent code.
 * These tests verify the AsyncLocalStorage isolation guarantee.
 */

import { describe, it, expect } from "vitest";
import {
  requireDispatchContext,
  runWithDispatchContext,
  type DispatchContext,
} from "@mammoth/shared/security";
import { ForbiddenError } from "@mammoth/shared/errors";

const TEST_CTX: DispatchContext = {
  approvalId: "approval-001",
  companyId: "company-001",
  actionType: "send_email_campaign",
};

// ── requireDispatchContext ─────────────────────────────────────────────────

describe("requireDispatchContext()", () => {
  it("throws ForbiddenError when called outside any dispatch context", () => {
    expect(() => requireDispatchContext()).toThrow(ForbiddenError);
  });

  it("includes a clear error message directing agents to createApproval()", () => {
    try {
      requireDispatchContext();
    } catch (err) {
      expect(err instanceof ForbiddenError).toBe(true);
      expect((err as ForbiddenError).message).toContain("dispatch context");
    }
  });

  it("returns the context when called inside runWithDispatchContext()", async () => {
    const ctx = await runWithDispatchContext(TEST_CTX, async () => {
      return requireDispatchContext();
    });

    expect(ctx.approvalId).toBe(TEST_CTX.approvalId);
    expect(ctx.companyId).toBe(TEST_CTX.companyId);
    expect(ctx.actionType).toBe(TEST_CTX.actionType);
  });
});

// ── runWithDispatchContext ─────────────────────────────────────────────────

describe("runWithDispatchContext()", () => {
  it("makes the context available inside the callback", async () => {
    let capturedCtx: DispatchContext | undefined;

    await runWithDispatchContext(TEST_CTX, async () => {
      capturedCtx = requireDispatchContext();
    });

    expect(capturedCtx).toEqual(TEST_CTX);
  });

  it("context is not visible outside the callback — storage is scoped", async () => {
    await runWithDispatchContext(TEST_CTX, async () => {
      // Inside: context exists
      expect(() => requireDispatchContext()).not.toThrow();
    });

    // Outside: context is gone
    expect(() => requireDispatchContext()).toThrow(ForbiddenError);
  });

  it("nested contexts are isolated — inner context does not leak to outer", async () => {
    const outerCtx: DispatchContext = { ...TEST_CTX, approvalId: "outer" };
    const innerCtx: DispatchContext = { ...TEST_CTX, approvalId: "inner" };

    await runWithDispatchContext(outerCtx, async () => {
      await runWithDispatchContext(innerCtx, async () => {
        expect(requireDispatchContext().approvalId).toBe("inner");
      });
      // Back in outer — inner ctx gone
      expect(requireDispatchContext().approvalId).toBe("outer");
    });
  });

  it("concurrent runs are fully isolated — no cross-talk between parallel dispatch chains", async () => {
    const ctxA: DispatchContext = { ...TEST_CTX, approvalId: "approval-A" };
    const ctxB: DispatchContext = { ...TEST_CTX, approvalId: "approval-B" };

    // Simulate two concurrent tool executions
    const [seenA, seenB] = await Promise.all([
      runWithDispatchContext(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 5)); // yield
        return requireDispatchContext().approvalId;
      }),
      runWithDispatchContext(ctxB, async () => {
        return requireDispatchContext().approvalId;
      }),
    ]);

    expect(seenA).toBe("approval-A");
    expect(seenB).toBe("approval-B");
  });
});
