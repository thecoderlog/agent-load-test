# The prompts

Both agents got exactly the same text, at their default effort, with web search off.

## Build
Build the shop order API that docs/ describes (start with docs/01-overview.md). `npm test` must pass: it runs the tests in tests/, which you must not change. DATABASE_URL in the environment points at an empty PostgreSQL 17 database that is yours to use. Install any npm packages you need.

## The second chance
Each agent got its own numbers: the server (2 vCPUs, 8 GB, Node and PostgreSQL 17 on the same machine, 100,000 products, 2,000,000 orders), the load test, its result, the step table and each endpoint's share, p95 and median. Then:

Make it hold as much traffic as you can on that same server. You can change the code and add indexes; the server, the PostgreSQL settings, the table definitions in docs/02-tables.md and the data loader stay as they are. `npm test` must still pass, and don't change anything in tests/. DATABASE_URL in the environment points at an empty PostgreSQL 17 database that is yours to use.
