# Shop order API

Build the HTTP JSON API for the shop: product search, orders, a customer's order history and a daily top-sellers
report. The four files in `docs/` are the whole spec.

## Stack
- Node.js (the version on this machine), TypeScript or JavaScript, any npm packages you like.
- PostgreSQL 17. `DATABASE_URL` in the environment points at an empty database that is yours to use.

## Commands (in `package.json`)
- `npm run migrate` creates the tables in `docs/02-tables.md` in the database at `DATABASE_URL`. It runs once,
  on an empty database.
- `npm start` starts the server. It listens on the port in `PORT` (8080 if `PORT` is not set), on all interfaces
  (`0.0.0.0`), and reads the database from `DATABASE_URL`.
- `npm test` runs the tests in `tests/`. Keep this script as it is.

## General rules
- Requests and responses are JSON (`Content-Type: application/json`).
- Money is always a whole number of cents.
- Times are UTC, written as ISO 8601 with a `Z`, for example `2026-11-18T09:30:00.000Z`.
- `GET /health` answers 200 with `{"ok": true}`.
- Errors answer with a JSON body `{"error": "<code>"}` and these status codes:
  - 400 `bad_request` for a missing or invalid parameter or body,
  - 404 `not_found` for an unknown id or sku,
  - 409 `out_of_stock` when an order asks for more than a product has (see `docs/04-orders.md`).

## The tests
`npm test` resets the database, runs your `npm run migrate`, loads the data in `tests/fixtures/` straight into
the tables, starts your server with `npm start` and checks every endpoint. All of them must pass. Don't change
anything in `tests/`.
