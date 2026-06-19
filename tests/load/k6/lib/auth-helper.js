import http from 'k6/http';
import { check, fail } from 'k6';
import { BASE_URL, TEST_USER_EMAIL, TEST_USER_PASSWORD } from './config.js';

/**
 * Signs in with email/password via Better Auth.
 * Returns the raw session token string to be shared across VUs.
 * Called once in setup() — not per VU iteration.
 */
export function signIn() {
  const res = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!check(res, { 'auth sign-in 200': (r) => r.status === 200 })) {
    fail(`sign-in failed: status=${res.status} body=${res.body}`);
  }

  const sessionCookies = res.cookies['better-auth.session_token'];
  if (!sessionCookies || sessionCookies.length === 0) {
    fail('sign-in returned 200 but no session cookie in response');
  }

  return sessionCookies[0].value;
}

/**
 * Returns k6 request params with the session cookie and JSON content type.
 * Use as the final argument to all http.* calls that require auth.
 */
export function authParams(sessionToken) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `better-auth.session_token=${sessionToken}`,
    },
  };
}
