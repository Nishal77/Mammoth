import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { authParams } from '../lib/auth-helper.js';

/**
 * Exercises the approvals read path (list + single).
 * Approvals are created by agent runs, not by API clients, so this scenario
 * tests the read and resolution paths that founders interact with most.
 *
 * If an approval exists in the setup company, the scenario also tests
 * the resolve (approve/reject) path.
 */
export function runApprovals(sessionToken, companyId) {
  const params = authParams(sessionToken);
  const base = `${BASE_URL}/api/v1/companies/${companyId}/approvals`;
  let firstApprovalId = null;

  group('approvals: list pending', () => {
    const res = http.get(`${base}?status=pending`, params);
    check(res, { 'GET /approvals 200': (r) => r.status === 200 });

    if (res.status === 200) {
      const items = res.json('data') ?? [];
      if (Array.isArray(items) && items.length > 0) {
        firstApprovalId = items[0].id;
      }
    }
  });

  group('approvals: list all', () => {
    const res = http.get(base, params);
    check(res, { 'GET /approvals (all) 200': (r) => r.status === 200 });
  });

  if (firstApprovalId) {
    group('approvals: get single', () => {
      const res = http.get(`${base}/${firstApprovalId}`, params);
      check(res, {
        'GET /approvals/:id 200': (r) => r.status === 200,
      });
    });

    // Resolve in load test only when explicitly enabled — avoid consuming real approvals
    if (__ENV.RESOLVE_APPROVALS === 'true') {
      group('approvals: resolve (approve)', () => {
        const res = http.post(
          `${base}/${firstApprovalId}/resolve`,
          JSON.stringify({ action: 'approve' }),
          params
        );
        check(res, {
          'POST /approvals/:id/resolve 200': (r) => r.status === 200,
        });
      });
    }
  }
}
