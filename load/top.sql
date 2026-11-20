\set QUIET on
-- top.sql: the queries that took the database's time during the load run (pg_stat_statements).
\pset format unaligned
\pset tuples_only on
SELECT coalesce(json_agg(x), '[]'::json) FROM (
  SELECT calls, round(total_exec_time)::bigint AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms, rows,
         left(regexp_replace(query, '\s+', ' ', 'g'), 400) AS query
    FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
   ORDER BY total_exec_time DESC LIMIT 12) x;
