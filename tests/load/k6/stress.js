/**
 * Stress test — spike to 200 VUs over 3 minutes.
 *
 * Finds the breaking point of the API under abnormal load. Focuses on the
 * read-heavy paths (health, approvals, departments) that scale horizontally
 * and the write paths (companies, memory) that hit the DB hardest.
 *
 * Thresholds are intentionally lenient — this test is about observing
 * degradation patterns, not asserting a pass/fail performance SLA.
 *
 * Usage:
 *   k6 run tests/load/k6/stress.js
 *   k6 run -e BASE_URL=https://api.staging.mammoth.ai tests/load/k6/stress.js
 */

import http from 'k6/http';
import { group, sleep } from 'k6';
import { BASE_URL, STAGES_STRESS, THRESHOLDS_STRESS } from './lib/config.js';
import { signIn, authParams } from './lib/auth-helper.js';
import { runHealth } from './scenarios/health.js';
import { runApprovals } from './scenarios/approvals.js';
import { runDepartments } from './scenarios/departments.js';
import { runMemory } from './scenarios/memory.js';

export const options = {
  stages: STAGES_STRESS,
  thresholds: THRESHOLDS_STRESS,
};

export function setup() {
  const sessionToken = signIn();

  const res = http.post(
    `${BASE_URL}/api/v1/companies`,
    JSON.stringify({
      name: `Stress Test Co ${Date.now()}`,
      stage: 'scaling',
      industry: 'SaaS',
    }),
    authParams(sessionToken)
  );

  const companyId = res.status === 201 ? res.json('data.id') : null;

  return { sessionToken, companyId };
}

export default function (data) {
  const { sessionToken, companyId } = data;

  group('health', () => runHealth());

  if (!companyId) {
    sleep(0.5);
    return;
  }

  // Under stress: interleave read-heavy paths to surface connection pool exhaustion
  const vu = __VU % 4;

  if (vu === 0) {
    group('memory reads', () => runMemory(sessionToken, companyId));
  } else if (vu === 1) {
    group('approvals reads', () => runApprovals(sessionToken, companyId));
  } else if (vu === 2) {
    group('departments reads', () => runDepartments(sessionToken, companyId));
  } else {
    // Write path — most stress on DB
    const res = http.post(
      `${BASE_URL}/api/v1/companies/${companyId}/memory`,
      JSON.stringify({
        memoryType: 'identity',
        key: `stress-${__VU}-${Date.now()}`,
        value: 'Stress test entry.',
        source: 'stress_test',
      }),
      authParams(sessionToken)
    );
    // 200/201 both valid; 500+ signals DB pressure
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      console.log(`memory write failed: vu=${__VU} status=${res.status}`);
    }
  }

  sleep(0.5);
}

export function teardown(data) {
  if (!data.companyId) return;

  http.del(
    `${BASE_URL}/api/v1/companies/${data.companyId}`,
    null,
    authParams(data.sessionToken)
  );
}
