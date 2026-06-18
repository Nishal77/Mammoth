import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the memory writer before importing the module under test.
// Without this, importing outcome-capturer.ts would trigger the DB connection.
vi.mock("../memory/memory-writer.ts", () => ({
  upsertMemory: vi.fn().mockResolvedValue(undefined),
}));

import { captureOutcome } from "./outcome-capturer.ts";
import { upsertMemory } from "../memory/memory-writer.ts";

const BASE_OUTPUT = {
  content: "Published a blog post about Q4 roadmap.",
  summary: {},
  approvalRequired: false,
  actionType: "publish_blog_post",
  confidence: 0.9,
} as const;

describe("captureOutcome — filtering rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves to memory when confidence >= 0.7 and ringLevel <= 2", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "content",
      taskType: "publish_blog_post",
      output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.9 },
    });

    expect(upsertMemory).toHaveBeenCalledOnce();
  });

  it("saves Ring 2 completions", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "marketing",
      taskType: "send_campaign",
      output: { ...BASE_OUTPUT, ringLevel: 2, confidence: 0.8 },
    });

    expect(upsertMemory).toHaveBeenCalledOnce();
  });

  it("skips Ring 3 completions — outcome not certain until founder approves", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "sales",
      taskType: "send_outreach",
      output: { ...BASE_OUTPUT, ringLevel: 3, confidence: 0.9 },
    });

    // Ring 3 = waiting for approval, outcome unknown — do not save.
    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it("skips low-confidence outputs (< 0.7)", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "content",
      taskType: "draft_post",
      output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.65 },
    });

    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it("skips exactly 0.69 confidence (threshold is >= 0.7, not >)", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "content",
      taskType: "draft_post",
      output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.69 },
    });

    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it("saves exactly 0.7 confidence (boundary case)", async () => {
    await captureOutcome({
      companyId: "comp-1",
      department: "content",
      taskType: "draft_post",
      output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.7 },
    });

    expect(upsertMemory).toHaveBeenCalledOnce();
  });

  it("passes the correct companyId to upsertMemory", async () => {
    await captureOutcome({
      companyId: "comp-xyz",
      department: "content",
      taskType: "publish_blog_post",
      output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.9 },
    });

    expect(upsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "comp-xyz" })
    );
  });

  it("does not throw if upsertMemory rejects — errors are swallowed", async () => {
    vi.mocked(upsertMemory).mockRejectedValueOnce(new Error("DB unavailable"));

    // Should resolve without throwing — memory capture is non-blocking.
    await expect(
      captureOutcome({
        companyId: "comp-1",
        department: "content",
        taskType: "publish",
        output: { ...BASE_OUTPUT, ringLevel: 1, confidence: 0.9 },
      })
    ).resolves.toBeUndefined();
  });
});
