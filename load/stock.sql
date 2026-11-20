-- stock.sql: after a load run. Every order placed during the run (ids above the seeded ones) is compared with
-- the stock that is left. For each product: sold = units in new orders; it should be that
-- start stock - sold = stock now, and sold <= start stock. Oversold and lost updates both show up here.
-- Works whatever indexes the build made: one pass over order_lines, nothing correlated.
\set QUIET on
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE n_orders AS SELECT o.id, o.total_cents FROM orders o, w27.mark m WHERE o.id > m.max_seed_id;
CREATE TEMP TABLE n_lines AS SELECT l.* FROM order_lines l, w27.mark m WHERE l.order_id > m.max_seed_id;
CREATE TEMP TABLE per AS
  SELECT i.sku, i.stock AS start_stock, coalesce(s.sold, 0) AS sold, p.stock AS stock_now
    FROM w27.initial i JOIN products p ON p.sku = i.sku
    LEFT JOIN (SELECT sku, sum(qty)::bigint AS sold FROM n_lines GROUP BY sku) s ON s.sku = i.sku;
CREATE TEMP TABLE tot AS
  SELECT o.id, o.total_cents, coalesce(t.sum, 0) AS lines_sum, t.id IS NULL AS no_lines
    FROM n_orders o LEFT JOIN (SELECT order_id AS id, sum(qty * price_cents) AS sum FROM n_lines GROUP BY order_id) t ON t.id = o.id;
SELECT json_build_object(
  'new_orders', (SELECT count(*) FROM n_orders),
  'new_orders_without_lines', (SELECT count(*) FROM tot WHERE no_lines),
  'bad_totals', (SELECT count(*) FROM tot WHERE total_cents <> lines_sum),
  'products_sold', (SELECT count(*) FROM per WHERE sold > 0),
  'oversold_products', (SELECT count(*) FROM per WHERE sold > start_stock),
  'oversold_units', (SELECT coalesce(sum(sold - start_stock), 0) FROM per WHERE sold > start_stock),
  'negative_stock', (SELECT count(*) FROM per WHERE stock_now < 0),
  'stock_mismatch_products', (SELECT count(*) FROM per WHERE start_stock - sold <> stock_now),
  'stock_mismatch_units', (SELECT coalesce(sum(abs(start_stock - sold - stock_now)), 0) FROM per),
  'worst', (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT sku, start_stock, sold, stock_now FROM per
             WHERE sold > start_stock OR start_stock - sold <> stock_now
             ORDER BY abs(start_stock - sold - stock_now) DESC, sku LIMIT 12) x));
