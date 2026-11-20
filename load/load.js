// load.js: week 27's load test (k6). The same script and the same steps for every build.
// A short warm-up, then one constant-arrival-rate step per rate in STEPS, each STEP_S seconds, one after another.
// A step breaks when its p95 goes over P95_MS, more than 1% of its requests fail, or k6 has to drop more than 1%
// of the requests it should have sent (the server is too slow to keep up). The run stops 20 s into the first
// broken step, so the last step that held is the build's result.
//
//   k6 run -e TARGET=http://<api-server>:8080 -e OUT=summary.json load.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:8080';
const STEPS = (__ENV.STEPS || '50,100,200,400,800,1600,3200').split(',').map(Number);
const STEP_S = Number(__ENV.STEP_S || 60);
const WARM_S = Number(__ENV.WARM_S || 20);
const P95_MS = Number(__ENV.P95_MS || 500);
const PRODUCTS = Number(__ENV.PRODUCTS || 100000);
const MAX_ORDER = Number(__ENV.MAX_ORDER || 2000000);
const CUSTOMERS = Number(__ENV.CUSTOMERS || 200000);
const FIRST_DAY = Date.parse(`${__ENV.FIRST_DAY || '2025-11-19'}T00:00:00Z`);
const HOT = (__ENV.HOT || 'P000101,P000102,P000103,P000104,P000105').split(',');
const WORDS = ['mug', 'oak', 'lamp', 'blue', 'linen', 'chair', 'glass', 'rug', 'tea', 'copper', 'soft', 'vase', 'stone', 'bowl'];
const CATS = ['kitchen', 'dining', 'bath', 'bedroom', 'living', 'garden', 'office', 'kids', 'lighting', 'storage', 'decor', 'textiles'];

const stockRefused = new Counter('w27_out_of_stock');
const hotPlaced = new Counter('w27_hot_orders_placed');

const pad = (n) => `P${String(n).padStart(6, '0')}`;
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const popular = () => Math.min(PRODUCTS, Math.floor(PRODUCTS * Math.random() ** 2.2) + 1);

const scenarios = {
  warmup: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: `${WARM_S}s`, preAllocatedVUs: 20, maxVUs: 100, exec: 'shop' },
};
const thresholds = {};
STEPS.forEach((rate, i) => {
  const name = `r${String(rate).padStart(4, '0')}`;
  scenarios[name] = {
    executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: `${STEP_S}s`, startTime: `${WARM_S + i * STEP_S}s`,
    preAllocatedVUs: Math.min(rate, 400), maxVUs: Math.min(rate * 2, 4000), gracefulStop: '5s', exec: 'shop',
  };
  const stop = { abortOnFail: true, delayAbortEval: '20s' };
  thresholds[`http_req_duration{scenario:${name}}`] = [{ threshold: `p(95)<${P95_MS}`, ...stop }];
  thresholds[`http_req_failed{scenario:${name}}`] = [{ threshold: 'rate<0.01', ...stop }];
  thresholds[`dropped_iterations{scenario:${name}}`] = [{ threshold: `count<${Math.max(1, Math.round(rate * STEP_S * 0.01))}`, ...stop }];
  thresholds[`http_reqs{scenario:${name}}`] = ['count>=0'];
});

for (const n of ['GET /products', 'GET /products/:sku', 'GET /orders/:id', 'POST /orders', 'GET /customers/:id/orders', 'GET /reports/top-products']) {
  thresholds[`http_req_duration{name:${n}}`] = ['max>=0']; // so the summary has each endpoint's own p95
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  noConnectionReuse: false,
};

http.setResponseCallback(http.expectedStatuses(200, 201, 409));
const P = { timeout: '5s' };
const J = { headers: { 'content-type': 'application/json' }, timeout: '5s', tags: { name: 'POST /orders' } };

export function shop() {
  const x = Math.random() * 100;
  if (x < 20) { // search
    const q = Math.random() < 0.7 ? `q=${WORDS[rint(0, WORDS.length - 1)]}` : `category=${CATS[rint(0, CATS.length - 1)]}`;
    const r = http.get(`${TARGET}/products?${q}&limit=20&offset=${Math.random() < 0.8 ? 0 : rint(1, 5) * 20}`, { ...P, tags: { name: 'GET /products' } });
    check(r, { 'search 200': (res) => res.status === 200 });
  } else if (x < 55) { // one product
    const r = http.get(`${TARGET}/products/${pad(popular())}`, { ...P, tags: { name: 'GET /products/:sku' } });
    check(r, { 'product 200': (res) => res.status === 200 });
  } else if (x < 65) { // one order
    const r = http.get(`${TARGET}/orders/${rint(1, MAX_ORDER)}`, { ...P, tags: { name: 'GET /orders/:id' } });
    check(r, { 'order 200': (res) => res.status === 200 });
  } else if (x < 85) { // place an order; one in four asks for a hot product (5 of them, 500 in stock each)
    const hot = Math.random() < 0.25;
    const lines = [];
    const seen = new Set();
    if (hot) { const s = HOT[rint(0, HOT.length - 1)]; lines.push({ sku: s, qty: rint(1, 3) }); seen.add(s); }
    const extra = hot ? rint(0, 1) : rint(1, 3);
    while (lines.length < (hot ? 1 : 0) + extra) {
      const s = pad(popular());
      if (HOT.includes(s) || seen.has(s)) continue;
      seen.add(s);
      lines.push({ sku: s, qty: rint(1, 4) });
    }
    const r = http.post(`${TARGET}/orders`, JSON.stringify({ customer_id: rint(1, CUSTOMERS), lines }), J);
    if (r.status === 409) stockRefused.add(1);
    if (hot && r.status === 201) hotPlaced.add(1);
    check(r, { 'order placed or refused': (res) => res.status === 201 || res.status === 409 });
  } else if (x < 95) { // a customer's orders
    const r = http.get(`${TARGET}/customers/${rint(1, CUSTOMERS)}/orders`, { ...P, tags: { name: 'GET /customers/:id/orders' } });
    check(r, { 'customer 200': (res) => res.status === 200 });
  } else { // the daily report
    const day = new Date(FIRST_DAY + rint(0, 364) * 86400000).toISOString().slice(0, 10);
    const r = http.get(`${TARGET}/reports/top-products?date=${day}`, { ...P, tags: { name: 'GET /reports/top-products' } });
    check(r, { 'report 200': (res) => res.status === 200 });
  }
}

export function handleSummary(data) {
  const out = __ENV.OUT || 'summary.json';
  const steps = [];
  for (const rate of STEPS) {
    const name = `r${String(rate).padStart(4, '0')}`;
    const m = (k) => data.metrics[`${k}{scenario:${name}}`];
    const reqs = m('http_reqs');
    if (!reqs || !reqs.values.count) continue;
    const dur = m('http_req_duration');
    const failed = m('http_req_failed');
    const dropped = m('dropped_iterations');
    const broke = [dur, failed, dropped].some((x) => x && x.thresholds && Object.values(x.thresholds).some((t) => !t.ok));
    steps.push({
      rate, requests: reqs.values.count, rps: reqs.values.rate, p95_ms: dur ? dur.values['p(95)'] : null,
      p99_ms: dur ? dur.values['p(99)'] : null, med_ms: dur ? dur.values.med : null,
      failed_rate: failed ? failed.values.rate : null, dropped: dropped ? dropped.values.count : 0, broke,
    });
  }
  const held = steps.filter((s) => !s.broke).map((s) => s.rate);
  const brokeAt = steps.find((s) => s.broke);
  const result = {
    target: TARGET, steps, held_rps: held.length ? Math.max(...held) : 0, broke_at_rps: brokeAt ? brokeAt.rate : null,
    out_of_stock: data.metrics.w27_out_of_stock ? data.metrics.w27_out_of_stock.values.count : 0,
    hot_orders_placed: data.metrics.w27_hot_orders_placed ? data.metrics.w27_hot_orders_placed.values.count : 0,
    by_endpoint: Object.fromEntries(Object.entries(data.metrics).filter(([k]) => k.startsWith('http_req_duration{name:'))
      .map(([k, v]) => [k.slice(23, -1), { p95_ms: v.values['p(95)'], med_ms: v.values.med }])),
    metrics: data.metrics,
  };
  const lines = steps.map((s) => `  ${String(s.rate).padStart(5)} req/s  sent ${String(s.requests).padStart(7)}  p95 ${s.p95_ms === null ? '-' : s.p95_ms.toFixed(0).padStart(5)} ms  failed ${(100 * (s.failed_rate || 0)).toFixed(2).padStart(6)}%  dropped ${String(s.dropped).padStart(6)}  ${s.broke ? 'BROKE' : 'held'}`);
  const text = `\nweek 27 load test against ${TARGET}\n${lines.join('\n')}\n  held up to ${result.held_rps} req/s${brokeAt ? `, broke at ${brokeAt.rate}` : ', never broke'}\n`;
  return { [out]: JSON.stringify(result, null, 2), stdout: text };
}
