// The test harness: resets the database, runs `npm run migrate`, loads tests/fixtures, starts `npm start`.
// Don't change this file (docs/01-overview.md).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const FIX = join(HERE, 'fixtures');

export function readCsv(name) {
  const [head, ...rows] = readFileSync(join(FIX, name), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return rows.map((r) => {
    const v = r.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, /^-?\d+$/.test(v[i]) && c !== 'sku' ? Number(v[i]) : v[i]]));
  });
}

function freePort() {
  return new Promise((ok, bad) => {
    const s = createServer();
    s.unref();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function insertAll(client, table, rows) {
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [];
    const marks = chunk.map((r, j) => `(${cols.map((c, k) => { vals.push(r[c]); return `$${j * cols.length + k + 1}`; }).join(',')})`);
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${marks.join(',')}`, vals);
  }
}

function stopGroup(proc) {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
}

export async function start() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const mig = spawnSync('npm', ['run', '--silent', 'migrate'], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 120_000 });
    if (mig.status !== 0) throw new Error(`npm run migrate failed:\n${mig.stdout}\n${mig.stderr}`);
    await insertAll(client, 'products', readCsv('products.csv'));
    await insertAll(client, 'orders', readCsv('orders.csv'));
    await insertAll(client, 'order_lines', readCsv('order_lines.csv'));
    await client.query("SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT max(id) FROM orders))");
    await client.query('ANALYZE');
  } finally {
    await client.end();
  }
  const port = await freePort();
  const proc = spawn('npm', ['start'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.status === 200) return { base, stop: () => stopGroup(proc) };
    } catch { /* not up yet */ }
    if (proc.exitCode !== null) break;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  stopGroup(proc);
  throw new Error(`the server did not answer GET /health within 20 s:\n${log.slice(-2000)}`);
}
