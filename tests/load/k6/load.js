/**
 * Load test — ramp to 50 VUs over 6 minutes.
 *
 * Simulates steady-state production traffic. All major API paths run
 * concurrently across VUs. Passes when p95 < 2s and error rate < 5%.
 *
 * Usage:
 *   k6 run tests/load/k6/load.js
 *   k6 run -e BASE_URL=https://api.staging.mammoth.ai tests/load/k6/load.js
 */

import http from 'k6/http';
import { group, sleep } from 'k6';
import { BASE_URL, STAGES_LOAD, THRESHOLDS_LOAD } from './lib/config.js';
import { signIn, authParams } from './lib/auth-helper.js';
import { runHealth } from './scenarios/health.js';
import { runCompanies } from './scenarios/companies.js';
import { runGoals } from './scenarios/goals.js';
import { runApprovals } from './scenarios/approvals.js';
import { runDepartments } from './scenarios/departments.js';
import { runMemory } from './scenarios/memory.js';

export const options = {
  stages: STAGES_LOAD,
  thresholds: THRESHOLDS_LOAD,
};

export function setup() {
  const sessionToken = signIn();

  const res = http.post(
    `${BASE_URL}/api/v1/companies`,
    JSON.stringify({
      name: `Load Test Co ${Date.now()}`,
      stage: 'early-revenue',
      industry: 'SaaS',
    }),
    authParams(sessionToken)
  );

  const companyId = res.status === 201 ? res.json('data.id') : null;

  return { sessionToken, companyId };
}

export default function (data) {
  const { sessionToken, companyId } = data;

  // Health check every iteration — cheapest signal of server health
  group('health', () => runHealth());

  // Rotate through write-heavy and read-heavy paths based on VU index
  // so not all VUs hammer the same route simultaneously
  const vu = __VU % 3;

  if (vu === 0) {
    group('companies', () => runCompanies(sessionToken));
  } else if (vu === 1 && companyId) {
    group('goals', () => runGoals(sessionToken, companyId));
    group('memory', () => runMemory(sessionToken, companyId));
  } else if (companyId) {
    group('approvals', () => runApprovals(sessionToken, companyId));
    group('departments', () => runDepartments(sessionToken, companyId));
  }

  sleep(1);
}

export function teardown(data) {
  if (!data.companyId) return;

  http.del(
    `${BASE_URL}/api/v1/companies/${data.companyId}`,
    null,
    authParams(data.sessionToken)
  );
}
