import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { authParams } from '../lib/auth-helper.js';

/**
 * Exercises the full companies CRUD path:
 *   POST create → GET list → GET single → PATCH update → DELETE
 *
 * Each VU creates and cleans up its own company so runs are isolated.
 */
export function runCompanies(sessionToken) {
  const params = authParams(sessionToken);
  let companyId = null;

  group('companies: create', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/companies`,
      JSON.stringify({
        name: `LoadTest Co ${Date.now()}`,
        tagline: 'k6 load test company',
        industry: 'SaaS',
        stage: 'early-revenue',
      }),
      params
    );

    if (check(res, { 'POST /companies 201': (r) => r.status === 201 })) {
      companyId = res.json('data.id');
    }
  });

  group('companies: list', () => {
    const res = http.get(`${BASE_URL}/api/v1/companies`, params);
    check(res, { 'GET /companies 200': (r) => r.status === 200 });
  });

  if (companyId) {
    group('companies: get single', () => {
      const res = http.get(`${BASE_URL}/api/v1/companies/${companyId}`, params);
      check(res, { 'GET /companies/:id 200': (r) => r.status === 200 });
    });

    group('companies: update', () => {
      const res = http.patch(
        `${BASE_URL}/api/v1/companies/${companyId}`,
        JSON.stringify({ tagline: 'updated by k6', version: 1 }),
        params
      );
      check(res, { 'PATCH /companies/:id 200': (r) => r.status === 200 });
    });

    group('companies: delete', () => {
      const res = http.del(`${BASE_URL}/api/v1/companies/${companyId}`, null, params);
      check(res, { 'DELETE /companies/:id 200': (r) => r.status === 200 });
    });
  }
}
