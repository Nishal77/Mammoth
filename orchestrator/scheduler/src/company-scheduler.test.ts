import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for CompanyScheduler — BullMQ job lifecycle management.
 * Queue is mocked — no Redis required.
 */

const {
  mockQueueAdd,
  mockGetRepeatableJobs,
  mockRemoveRepeatableByKey,
  mockQueueClose,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockGetRepeatableJobs: vi.fn().mockResolvedValue([]),
  mockRemoveRepeatableByKey: vi.fn().mockResolvedValue(undefined),
  mockQueueClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getRepeatableJobs: mockGetRepeatableJobs,
    removeRepeatableByKey: mockRemoveRepeatableByKey,
    close: mockQueueClose,
  })),
}));

import { CompanyScheduler } from "./company-scheduler.ts";
import { JOB_NAMES } from "./cron-definitions.ts";

const COMPANY_ID = "company-test-123";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRepeatableJobs.mockResolvedValue([]);
});

describe("CompanyScheduler.startCompany", () => {
  it("registers 3 repeatable jobs for a new company", async () => {
    const scheduler = new CompanyScheduler();
    await scheduler.startCompany(COMPANY_ID);
    await scheduler.close();

    expect(mockQueueAdd).toHaveBeenCalledTimes(3);

    const callArgs = mockQueueAdd.mock.calls.map((c) => c[0] as string);
    expect(callArgs).toContain(JOB_NAMES.CEO_BRAIN_CYCLE);
    expect(callArgs).toContain(JOB_NAMES.RESEARCH_CYCLE);
    expect(callArgs).toContain(JOB_NAMES.FINANCE_CYCLE);
  });

  it("each job includes the correct companyId in data", async () => {
    const scheduler = new CompanyScheduler();
    await scheduler.startCompany(COMPANY_ID);
    await scheduler.close();

    for (const call of mockQueueAdd.mock.calls) {
      const data = call[1] as { companyId: string };
      expect(data.companyId).toBe(COMPANY_ID);
    }
  });

  it("each job has a deterministic jobId for deduplication", async () => {
    const scheduler = new CompanyScheduler();
    await scheduler.startCompany(COMPANY_ID);
    await scheduler.close();

    const jobIds = mockQueueAdd.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    // All job IDs should include the companyId
    for (const jobId of jobIds) {
      expect(jobId).toContain(COMPANY_ID);
    }
    // No duplicates
    expect(new Set(jobIds).size).toBe(jobIds.length);
  });
});

describe("CompanyScheduler.stopCompany", () => {
  it("removes repeatable jobs matching the company", async () => {
    const matchingKey = `repeat:${JOB_NAMES.CEO_BRAIN_CYCLE}:${COMPANY_ID}:360000`;
    mockGetRepeatableJobs.mockResolvedValue([
      { id: `repeatable:${JOB_NAMES.CEO_BRAIN_CYCLE}:${COMPANY_ID}`, key: matchingKey, name: JOB_NAMES.CEO_BRAIN_CYCLE, next: Date.now() + 3_600_000 },
    ]);

    const scheduler = new CompanyScheduler();
    await scheduler.stopCompany(COMPANY_ID);
    await scheduler.close();

    expect(mockRemoveRepeatableByKey).toHaveBeenCalledWith(matchingKey);
  });

  it("does not remove jobs for other companies", async () => {
    const otherCompanyKey = `repeat:${JOB_NAMES.CEO_BRAIN_CYCLE}:other-company:360000`;
    mockGetRepeatableJobs.mockResolvedValue([
      { id: `repeatable:${JOB_NAMES.CEO_BRAIN_CYCLE}:other-company`, key: otherCompanyKey, name: JOB_NAMES.CEO_BRAIN_CYCLE, next: Date.now() + 3_600_000 },
    ]);

    const scheduler = new CompanyScheduler();
    await scheduler.stopCompany(COMPANY_ID);
    await scheduler.close();

    // Nothing removed because the key doesn't contain COMPANY_ID
    expect(mockRemoveRepeatableByKey).not.toHaveBeenCalled();
  });
});

describe("CompanyScheduler.triggerImmediateCycle", () => {
  it("adds a high-priority one-off job", async () => {
    const scheduler = new CompanyScheduler();
    const jobId = await scheduler.triggerImmediateCycle(COMPANY_ID);
    await scheduler.close();

    expect(mockQueueAdd).toHaveBeenCalledOnce();
    const [name, data, opts] = mockQueueAdd.mock.calls[0] as [string, { companyId: string }, { priority: number }];
    expect(name).toBe(JOB_NAMES.CEO_BRAIN_CYCLE);
    expect(data.companyId).toBe(COMPANY_ID);
    expect(opts.priority).toBe(1);
    expect(jobId).toBe("job-1");
  });
});
