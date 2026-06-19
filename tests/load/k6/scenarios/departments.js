import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { authParams } from '../lib/auth-helper.js';

const DEPARTMENTS = ['ceo', 'marketing', 'sales', 'engineering', 'support', 'research', 'hr', 'content', 'finance'];

/**
 * Exercises the departments read path:
 *   GET all departments → GET dept task history → GET dept outputs
 *
 * Read-only to simulate founder dashboard load. Two departments sampled
 * per iteration to avoid all 9 firing simultaneously per VU.
 */
export function runDepartments(sessionToken, companyId) {
  const params = authParams(sessionToken);
  const base = `${BASE_URL}/api/v1/companies/${companyId}/departments`;

  group('departments: list all', () => {
    const res = http.get(base, params);
    check(res, { 'GET /departments 200': (r) => r.status === 200 });
  });

  const sampled = DEPARTMENTS.slice(0, 2);

  for (const dept of sampled) {
    group(`departments: ${dept} task history`, () => {
      const res = http.get(`${base}/${dept}/tasks`, params);
      check(res, {
        [`GET /departments/${dept}/tasks 200 or 404`]: (r) => r.status === 200 || r.status === 404,
      });
    });

    group(`departments: ${dept} outputs`, () => {
      const res = http.get(`${base}/${dept}/outputs`, params);
      check(res, {
        [`GET /departments/${dept}/outputs 200 or 404`]: (r) => r.status === 200 || r.status === 404,
      });
    });
  }
}
