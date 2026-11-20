#!/bin/bash
# seed.sh DATABASE_URL DATA_DIR: load the shop's data into a build's freshly migrated tables (docs/02-tables.md),
# exactly as the spec says: COPY, move the orders id sequence past the loaded ids, ANALYZE. Then keep a copy of
# the starting stock in a schema of our own (w27) for the stock check, and reset pg_stat_statements.
set -euo pipefail
DB="$1"; DIR="$2"
psql "$DB" -v ON_ERROR_STOP=1 -q -o /dev/null <<SQL
\copy products (sku, name, category, price_cents, stock) FROM '$DIR/products.csv' WITH (FORMAT csv, HEADER true)
\copy orders (id, customer_id, created_at, total_cents) FROM '$DIR/orders.csv' WITH (FORMAT csv, HEADER true)
\copy order_lines (order_id, sku, qty, price_cents) FROM '$DIR/order_lines.csv' WITH (FORMAT csv, HEADER true)
SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT max(id) FROM orders));
ANALYZE;
DROP SCHEMA IF EXISTS w27 CASCADE;
CREATE SCHEMA w27;
CREATE TABLE w27.initial AS SELECT sku, stock FROM public.products;
CREATE TABLE w27.mark AS SELECT max(id) AS max_seed_id, now() AS seeded_at FROM public.orders;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT pg_stat_statements_reset();
SQL
