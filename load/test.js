import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const myCounter = new Counter('my_counter');
export const responseTime = new Trend('response_time');

// Test configuration
export const options = {
  thresholds: {
    http_req_failed: ['rate<=0.001'], // ≤0.1% ошибок
    http_req_duration: ['p(95)<=200'], // p95 ≤ 200ms
  },
  stages: [
    { duration: '30s', target: 20 },   // Разогрев до 20 VUs
    { duration: '1m', target: 50 },    // Увеличение до 50 VUs
    { duration: '2m', target: 100 },   // Пик нагрузки - 100 VUs
    { duration: '1m', target: 0 },     // Плавное снижение
  ],
};

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  // Test главной страницы
  let res = http.get(`${BASE}/`);
  check(res, { 
    'status 200': (r) => r.status === 200,
    'has visits': (r) => r.json('visits') !== undefined,
  });
  
  errorRate.add(res.status !== 200);
  responseTime.add(res.timings.duration);
  myCounter.add(1);

  sleep(1);

  // Test health check
  let h = http.get(`${BASE}/health`);
  check(h, { 
    'health ok': (r) => r.status === 200 && r.json('status') === 'healthy',
  });

  sleep(1);

  // Test slow endpoint (10% запросов)
  if (Math.random() < 0.1) {
    let slow = http.get(`${BASE}/slow`);
    check(slow, { 'slow response ok': (r) => r.status === 200 });
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  return `
    ====== k6 Load Test Summary ======
    
    Scenarios: ${Object.keys(data.metrics).length}
    
    HTTP Requests:
      - Total: ${data.metrics.http_reqs.values.count}
      - Failed: ${data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * 100 : 0}%
    
    Response Times:
      - p50: ${data.metrics.http_req_duration.values['p(50)']} ms
      - p95: ${data.metrics.http_req_duration.values['p(95)']} ms
      - p99: ${data.metrics.http_req_duration.values['p(99)']} ms
    
    ===================================
  `;
}