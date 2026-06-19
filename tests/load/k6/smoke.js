/**
 * Smoke test — 1 VU, 30 seconds.
 *
 * Verifies every major endpoint is reachable and returns expected status codes.
 * Run this in CI after every deploy before promoting to production.
 *
 * Usage:
 *   k6 run tests/load/k6/smoke.js
 *   k6 run -e BASE_URL=https://api.staging.mammoth.ai tests/load/k6/smoke.js
 */

import http from 'k6/http';
import { group, sleep } from 'k6';
import { BASE_URL, STAGES_SMOKE, THRESHOLDS_SMOKE } from './lib/config.js';
import { signIn, authParams } from './lib/auth-helper.js';
import { runHealth } from './scenarios/health.js';
import { runCompanies } from './scenarios/companies.js';
import { runGoals } from './scenarios/goals.js';
import { runApprovals } from './scenarios/approvals.js';
import { runDepartments } from './scenarios/departments.js';
import { runMemory } from './scenarios/memory.js';

export const options = {
  stages: STAGES_SMOKE,
  thresholds: THRESHOLDS_SMOKE,
};

export function setup() {
  const sessionToken = signIn();

  const res = http.post(
    `${BASE_URL}/api/v1/companies`,
    JSON.stringify({ name: `Smoke Test Co ${Date.now()}`, stage: 'idea' }),
    authParams(sessionToken)
  );

  const companyId = res.status === 201 ? res.json('data.id') : null;

  return { sessionToken, companyId };
}

export default function (data) {
  const { sessionToken, companyId } = data;

  group('health', () => runHealth());
  group('companies', () => runCompanies(sessionToken));

  if (companyId) {
    group('goals', () => runGoals(sessionToken, companyId));
    group('approvals', () => runApprovals(sessionToken, companyId));
    group('departments', () => runDepartments(sessionToken, companyId));
    group('memory', () => runMemory(sessionToken, companyId));
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
