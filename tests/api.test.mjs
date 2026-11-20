// The written tests for the shop order API (docs/). Don't change this file.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readCsv, start } from './harness.mjs';

const products = readCsv('products.csv');
const orders = readCsv('orders.csv');
const lines = readCsv('order_lines.csv');
const bySku = new Map(products.map((p) => [p.sku, p]));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // byte order, like COLLATE "C"
const byName = (a, b) => cmp(a.name, b.name) || cmp(a.sku, b.sku);
const iso = (s) => new Date(s.replace(' ', 'T').replace('+00', 'Z')).toISOString();

let srv;
before(async () => { srv = await start(); });
after(() => srv?.stop());

async function get(path) {
  const r = await fetch(srv.base + path);
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(path, body, raw = false) {
  const r = await fetch(srv.base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const view = (p) => ({ sku: p.sku, name: p.name, category: p.category, price_cents: p.price_cents, stock: p.stock });
// products the order tests use: plenty of stock, so other tests don't change what they see
const stocked = products.filter((p) => p.stock >= 50).sort((a, b) => cmp(a.sku, b.sku));

describe('health', () => {
  test('GET /health answers {ok: true}', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  });
});

describe('products', () => {
  test('GET /products/:sku returns the product', async () => {
    const p = products[41];
    const r = await get(`/products/${p.sku}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, view(p));
  });

  test('GET /products/:sku with an unknown sku is 404', async () => {
    const r = await get('/products/P999999');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not_found');
  });

  test('search with no parameters: first 20 by name, total is every product', async () => {
    const r = await get('/products');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, products.length);
    assert.deepEqual(r.body.items, [...products].sort(byName).slice(0, 20).map(view));
  });

  test('q matches part of the name, ignoring case', async () => {
    const want = products.filter((p) => p.name.toLowerCase().includes('mug')).sort(byName);
    const r = await get('/products?q=MuG&limit=100');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, want.length);
    assert.deepEqual(r.body.items, want.slice(0, 100).map(view));
  });

  test('category filter', async () => {
    const want = products.filter((p) => p.category === 'kitchen').sort(byName);
    const r = await get('/products?category=kitchen&limit=100');
    assert.equal(r.body.total, want.length);
    assert.deepEqual(r.body.items, want.slice(0, 100).map(view));
  });

  test('q and category together', async () => {
    const want = products.filter((p) => p.category === 'bath' && p.name.toLowerCase().includes('oak')).sort(byName);
    const r = await get('/products?q=oak&category=bath');
    assert.equal(r.body.total, want.length);
    assert.deepEqual(r.body.items, want.slice(0, 20).map(view));
  });

  test('limit and offset page through the matches', async () => {
    const want = [...products].sort(byName).slice(35, 42).map(view);
    const r = await get('/products?limit=7&offset=35');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, products.length);
    assert.deepEqual(r.body.items, want);
  });

  test('limit 100 is allowed', async () => {
    const r = await get('/products?limit=100');
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 100);
  });

  test('a search with no matches', async () => {
    const r = await get('/products?q=zzzznothing');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { total: 0, items: [] });
  });

  for (const qs of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'offset=-1', 'offset=x']) {
    test(`?${qs} is 400`, async () => {
      const r = await get(`/products?${qs}`);
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'bad_request');
    });
  }
});

describe('orders', () => {
  test('POST /orders saves the order: 201, prices, total, lines sorted by sku', async () => {
    const [a, b] = [stocked[3], stocked[1]];
    const r = await post('/orders', { customer_id: 9001, lines: [{ sku: a.sku, qty: 2 }, { sku: b.sku, qty: 1 }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.customer_id, 9001);
    assert.deepEqual(r.body.lines, [
      { sku: b.sku, qty: 1, price_cents: b.price_cents },
      { sku: a.sku, qty: 2, price_cents: a.price_cents },
    ]);
    assert.equal(r.body.total_cents, b.price_cents + 2 * a.price_cents);
    assert.ok(r.body.id > Math.max(...orders.map((o) => o.id)), 'new ids come after the loaded ones');
    assert.ok(Math.abs(Date.parse(r.body.created_at) - Date.now()) < 60_000, 'created_at is now');
    assert.match(r.body.created_at, /Z$/);
  });

  test('placing an order takes the stock', async () => {
    const p = stocked[5];
    const before = (await get(`/products/${p.sku}`)).body.stock;
    const r = await post('/orders', { customer_id: 9002, lines: [{ sku: p.sku, qty: 3 }] });
    assert.equal(r.status, 201);
    assert.equal((await get(`/products/${p.sku}`)).body.stock, before - 3);
  });

  test('GET /orders/:id returns a new order as it was saved', async () => {
    const p = stocked[6];
    const made = await post('/orders', { customer_id: 9003, lines: [{ sku: p.sku, qty: 1 }] });
    const r = await get(`/orders/${made.body.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, made.body);
  });

  test('GET /orders/:id returns a loaded order', async () => {
    const o = orders[1234];
    const want = lines.filter((l) => l.order_id === o.id).sort((x, y) => cmp(x.sku, y.sku))
      .map((l) => ({ sku: l.sku, qty: l.qty, price_cents: l.price_cents }));
    const r = await get(`/orders/${o.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: o.id, customer_id: o.customer_id, created_at: iso(o.created_at), total_cents: o.total_cents, lines: want });
  });

  test('GET /orders/:id with an unknown id is 404', async () => {
    assert.equal((await get('/orders/99999999')).status, 404);
  });

  test('asking for more than the stock is 409 and changes nothing', async () => {
    const low = products.find((p) => p.stock > 0 && p.stock < 10);
    const ok = stocked[7];
    const okBefore = (await get(`/products/${ok.sku}`)).body.stock;
    const r = await post('/orders', { customer_id: 9004, lines: [{ sku: ok.sku, qty: 1 }, { sku: low.sku, qty: low.stock + 1 }] });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'out_of_stock', sku: low.sku });
    assert.equal((await get(`/products/${ok.sku}`)).body.stock, okBefore);
    assert.equal((await get(`/products/${low.sku}`)).body.stock, low.stock);
    assert.deepEqual((await get('/customers/9004/orders')).body, { items: [] });
  });

  test('a product with stock 0 cannot be ordered', async () => {
    const zero = products.find((p) => p.stock === 0);
    const r = await post('/orders', { customer_id: 9005, lines: [{ sku: zero.sku, qty: 1 }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.sku, zero.sku);
  });

  test('buying the last units is allowed', async () => {
    const p = products.find((x) => x.stock === 2);
    const r = await post('/orders', { customer_id: 9006, lines: [{ sku: p.sku, qty: 2 }] });
    assert.equal(r.status, 201);
    assert.equal((await get(`/products/${p.sku}`)).body.stock, 0);
  });

  test('an unknown sku is 404 with the sku, and changes nothing', async () => {
    const ok = stocked[8];
    const okBefore = (await get(`/products/${ok.sku}`)).body.stock;
    const r = await post('/orders', { customer_id: 9007, lines: [{ sku: ok.sku, qty: 1 }, { sku: 'P999999', qty: 1 }] });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'not_found', sku: 'P999999' });
    assert.equal((await get(`/products/${ok.sku}`)).body.stock, okBefore);
  });

  const s = () => stocked[9].sku;
  const bad = {
    'qty 0': () => ({ customer_id: 1, lines: [{ sku: s(), qty: 0 }] }),
    'qty 21': () => ({ customer_id: 1, lines: [{ sku: s(), qty: 21 }] }),
    'qty 1.5': () => ({ customer_id: 1, lines: [{ sku: s(), qty: 1.5 }] }),
    'the same sku twice': () => ({ customer_id: 1, lines: [{ sku: s(), qty: 1 }, { sku: s(), qty: 1 }] }),
    'no lines': () => ({ customer_id: 1, lines: [] }),
    '11 lines': () => ({ customer_id: 1, lines: stocked.slice(10, 21).map((p) => ({ sku: p.sku, qty: 1 })) }),
    'no customer_id': () => ({ lines: [{ sku: s(), qty: 1 }] }),
    'customer_id 0': () => ({ customer_id: 0, lines: [{ sku: s(), qty: 1 }] }),
    'customer_id as text': () => ({ customer_id: '5', lines: [{ sku: s(), qty: 1 }] }),
  };
  for (const [name, body] of Object.entries(bad)) {
    test(`POST /orders with ${name} is 400`, async () => {
      const r = await post('/orders', body());
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'bad_request');
    });
  }

  test('POST /orders with a body that is not JSON is 400', async () => {
    const r = await post('/orders', '{"customer_id": 1, "lines": [', true);
    assert.equal(r.status, 400);
  });
});

describe('customers', () => {
  const cust = orders.filter((o) => o.customer_id === 17);
  const newest = [...cust].sort((a, b) => cmp(b.created_at, a.created_at) || b.id - a.id)
    .map((o) => ({ id: o.id, created_at: iso(o.created_at), total_cents: o.total_cents }));

  test('GET /customers/:id/orders: newest first, 10 by default', async () => {
    const r = await get('/customers/17/orders');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: newest.slice(0, 10) });
  });

  test('GET /customers/:id/orders with a limit', async () => {
    const r = await get('/customers/17/orders?limit=3');
    assert.deepEqual(r.body, { items: newest.slice(0, 3) });
  });

  test('a customer with no orders', async () => {
    const r = await get('/customers/777777/orders');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: [] });
  });

  test('limit 51 is 400', async () => {
    assert.equal((await get('/customers/17/orders?limit=51')).status, 400);
  });
});

describe('reports', () => {
  function top(date, limit) {
    const ids = new Set(orders.filter((o) => o.created_at.startsWith(date)).map((o) => o.id));
    const agg = new Map();
    for (const l of lines) {
      if (!ids.has(l.order_id)) continue;
      const a = agg.get(l.sku) || { sku: l.sku, name: bySku.get(l.sku).name, units: 0, revenue_cents: 0 };
      a.units += l.qty;
      a.revenue_cents += l.qty * l.price_cents;
      agg.set(l.sku, a);
    }
    return [...agg.values()].sort((a, b) => b.units - a.units || cmp(a.sku, b.sku)).slice(0, limit);
  }
  // the busiest loaded day, so ties and the limit both matter
  const counts = {};
  for (const o of orders) counts[o.created_at.slice(0, 10)] = (counts[o.created_at.slice(0, 10)] || 0) + 1;
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0];

  test('top products on a day, 10 by default', async () => {
    const r = await get(`/reports/top-products?date=${busiest}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { date: busiest, items: top(busiest, 10) });
  });

  test('top products with a limit', async () => {
    const r = await get(`/reports/top-products?date=${busiest}&limit=3`);
    assert.deepEqual(r.body, { date: busiest, items: top(busiest, 3) });
  });

  test('a day with no orders', async () => {
    const r = await get('/reports/top-products?date=2020-01-01');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { date: '2020-01-01', items: [] });
  });

  for (const qs of ['', '?date=2026-13-01', '?date=yesterday']) {
    test(`/reports/top-products${qs} is 400`, async () => {
      assert.equal((await get(`/reports/top-products${qs}`)).status, 400);
    });
  }
});
