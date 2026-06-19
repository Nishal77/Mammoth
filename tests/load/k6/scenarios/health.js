import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../lib/config.js';

/**
 * Hits the /health endpoint — no auth required.
 * Used as a baseline to confirm the server is up before heavier scenarios run.
 */
export function runHealth() {
  const res = http.get(`${BASE_URL}/health`);

  check(res, {
    'health status 200': (r) => r.status === 200,
    'health response fast': (r) => r.timings.duration < 200,
  });
}
