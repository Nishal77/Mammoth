import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { authParams } from '../lib/auth-helper.js';

/**
 * Exercises the goals path under a shared company:
 *   POST create → GET list → PATCH update
 *
 * Uses the companyId provisioned in setup() so we always have a valid parent.
 */
export function runGoals(sessionToken, companyId) {
  const params = authParams(sessionToken);
  const base = `${BASE_URL}/api/v1/companies/${companyId}/goals`;
  let goalId = null;

  group('goals: create', () => {
    const res = http.post(
      base,
      JSON.stringify({
        title: `Reach $1M ARR — k6 ${Date.now()}`,
        type: 'revenue',
        targetValue: '1000000',
        unit: 'USD',
        deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }),
      params
    );

    if (check(res, { 'POST /goals 201': (r) => r.status === 201 })) {
      goalId = res.json('data.id');
    }
  });

  group('goals: list', () => {
    const res = http.get(base, params);
    check(res, { 'GET /goals 200': (r) => r.status === 200 });
  });

  if (goalId) {
    group('goals: update progress', () => {
      const res = http.patch(
        `${base}/${goalId}`,
        JSON.stringify({ currentValue: '50000' }),
        params
      );
      check(res, { 'PATCH /goals/:id 200': (r) => r.status === 200 });
    });
  }
}
