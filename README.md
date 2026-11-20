# agent-load-test

The kit from The Coderlog's video "Claude Code vs Codex Built the Same API. I Load Tested Both Until One Broke." Use it to give your coding agent the same job and then load test what it builds.

The job is a shop's order API in Node and PostgreSQL 17 with six endpoints: product search, a product page, placing an order (which checks and takes stock), getting an order, a customer's order history and a daily top-sellers report. The four files in `docs/` are the whole spec. They say nothing about traffic, data size or orders arriving at the same time, so the load test checks what the spec left out.

## What's here
- `docs/`: the spec (start with `docs/01-overview.md`).
- `tests/`: the 45 written tests. `npm test` runs them against your build and a small sample shop (300 products, 2,000 orders).
- `load/gen27.py`: makes the shop's data, the same every time. `small` is the test fixtures; `big` is 100,000 products and 2,000,000 orders over a year, with five popular products that have only 500 in stock.
- `load/seed.sh`: loads that data into a build's freshly migrated database.
- `load/deploy.sh`: puts one build on the API server (install, migrate, seed, start, wait for `/health`).
- `load/load.js`: the k6 script.
- `load/stock.sql`: run after a load test. It counts oversold units, lost stock updates and orders whose total doesn't match their lines.
- `load/top.sql`: the queries that took the database's time (needs `pg_stat_statements`).
- `PROMPTS.md`: the two prompts both agents got.

## Run it
1. Copy this repo into an empty folder, give your agent the build prompt from `PROMPTS.md`, and point `DATABASE_URL` at an empty PostgreSQL 17 database. It's done when `npm test` passes.
2. On the API server: `python3 load/gen27.py big /data/seed`, then `bash load/deploy.sh build.tgz /data/seed` (a tarball of the build). `deploy.sh` reads `W27_PG_BASE`, `W27_DB`, `W27_PORT` and `W27_APP_DIR`; set `W27_LOCAL=1` to run it without systemd.
3. From a second machine on the same network: `k6 run -e TARGET=http://<api-server>:8080 -e OUT=summary.json load/load.js`
4. Back on the API server: `psql "$DATABASE_URL" -f load/stock.sql`

The load test starts with a 20 second warm-up, then sends 50, 100, 200, 400, 800, 1,600 and 3,200 requests a second for a minute each. A step breaks when its p95 passes 500 ms, more than 1% of requests fail, or k6 has to drop more than 1%. The run stops 20 seconds into the first broken step, so the last step that held is the result. The traffic is 35% product pages, 20% search, 20% new orders (a quarter of them for the five popular products), 10% order lookups, 10% customer history and 5% daily reports. Environment variables at the top of `load.js` change the steps and the limits.

Load test on a machine the size of the one you'll run in production. In the video the API server was an Azure Standard_D2as_v5 (2 vCPUs, 8 GiB) with Postgres on the same machine, and my Mac mini was far faster than it.

## What happened in the video
Claude Code (Opus 5.5) and Codex CLI (GPT-6 Astra) each built the API three times at their default effort, medium. All six passed the 45 tests, and all six held 100 requests a second and broke at 200. Then each agent got its own k6 report and the second prompt. Every Codex build held 400. Claude Code's builds held 800, 1,600 and 3,200, and the last one never broke. No build sold a unit it didn't have.

## Licence
MIT. See `LICENSE`.
