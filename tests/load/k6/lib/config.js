export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
export const TEST_USER_EMAIL = __ENV.TEST_EMAIL || 'loadtest@mammoth.test';
export const TEST_USER_PASSWORD = __ENV.TEST_PASSWORD || 'LoadTest123!';

export const STAGES_SMOKE = [
  { duration: '30s', target: 1 },
];

export const STAGES_LOAD = [
  { duration: '30s', target: 10 },
  { duration: '5m',  target: 50 },
  { duration: '30s', target: 0  },
];

export const STAGES_STRESS = [
  { duration: '30s', target: 50  },
  { duration: '1m',  target: 100 },
  { duration: '1m',  target: 200 },
  { duration: '30s', target: 0   },
];

export const THRESHOLDS_SMOKE = {
  http_req_failed:   ['rate<0.10'],
  http_req_duration: ['p(95)<5000'],
};

export const THRESHOLDS_LOAD = {
  http_req_failed:   [{ threshold: 'rate<0.05', abortOnFail: false }],
  http_req_duration: [
    { threshold: 'p(95)<2000', abortOnFail: false },
    { threshold: 'p(99)<5000', abortOnFail: false },
  ],
};

export const THRESHOLDS_STRESS = {
  http_req_failed:   [{ threshold: 'rate<0.15', abortOnFail: false }],
  http_req_duration: [{ threshold: 'p(99)<10000', abortOnFail: false }],
};
