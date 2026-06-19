import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { authParams } from '../lib/auth-helper.js';

const MEMORY_TYPES = ['identity', 'icp', 'competitor', 'product_lesson', 'playbook_refinement'];

/**
 * Exercises the company memory read and write paths:
 *   GET all memory → GET by type → POST upsert a memory entry
 *
 * Memory reads are the most common founder dashboard query, so this
 * scenario is intentionally read-heavy (4:1 read/write ratio).
 */
export function runMemory(sessionToken, companyId) {
  const params = authParams(sessionToken);
  const base = `${BASE_URL}/api/v1/companies/${companyId}/memory`;

  group('memory: get all', () => {
    const res = http.get(base, params);
    check(res, { 'GET /memory 200': (r) => r.status === 200 });
  });

  for (const memType of MEMORY_TYPES.slice(0, 2)) {
    group(`memory: get type=${memType}`, () => {
      const res = http.get(`${base}?type=${memType}`, params);
      check(res, {
        [`GET /memory?type=${memType} 200`]: (r) => r.status === 200,
      });
    });
  }

  group('memory: upsert identity entry', () => {
    const res = http.post(
      base,
      JSON.stringify({
        memoryType: 'identity',
        key: `k6-test-${Date.now()}`,
        value: 'Load test memory entry written by k6 — safe to delete.',
        source: 'load_test',
      }),
      params
    );
    check(res, {
      'POST /memory 200 or 201': (r) => r.status === 200 || r.status === 201,
    });
  });
}
