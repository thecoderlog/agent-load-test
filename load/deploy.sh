#!/bin/bash
# deploy.sh BUILD_TGZ DATA_DIR: put one build on the app server, exactly as the spec runs it.
#   npm ci (or npm install), a fresh empty database, npm run migrate, the seed data (seed.sh), npm start, /health.
# W27_LOCAL=1 is for testing the kit without VMs (no systemd, a database URL of your own).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TGZ="$1"; DATA="$2"
APP="${W27_APP_DIR:-/srv/w27app}"; PORT="${W27_PORT:-8080}"; DB="${W27_DB:-shop}"
BASE="${W27_PG_BASE:-postgresql://w27:w27@127.0.0.1:5432}"
URL="$BASE/$DB"
t0=$(date +%s)
if [ -n "${W27_LOCAL:-}" ]; then
  [ -f "$APP.pid" ] && { kill -- -"$(cat "$APP.pid")" 2>/dev/null || true; rm -f "$APP.pid"; sleep 1; }
else
  sudo systemctl stop w27-app 2>/dev/null || true
  sudo systemctl reset-failed w27-app 2>/dev/null || true
  sudo mkdir -p "$(dirname "$APP")" && sudo chown "$(id -u):$(id -g)" "$(dirname "$APP")"
fi
rm -rf "$APP" && mkdir -p "$APP" && tar xzf "$TGZ" -C "$APP"
cd "$APP"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --loglevel=error; else npm install --no-audit --no-fund --loglevel=error; fi
t1=$(date +%s)
psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB OWNER w27"
DATABASE_URL="$URL" npm run --silent migrate
t2=$(date +%s)
bash "$HERE/seed.sh" "$URL" "$DATA"
t3=$(date +%s)
if [ -n "${W27_LOCAL:-}" ]; then
  (PORT="$PORT" DATABASE_URL="$URL" setsid npm start > "$APP.log" 2>&1 & echo $! > "$APP.pid")
else
  sudo systemd-run --quiet --unit w27-app --uid "$(id -u)" --gid "$(id -g)" -p WorkingDirectory="$APP" -p LimitNOFILE=65536 \
    --setenv=PORT="$PORT" --setenv=DATABASE_URL="$URL" --setenv=PATH=/usr/local/bin:/usr/bin:/bin --setenv=HOME="$HOME" \
    /usr/local/bin/npm start
fi
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    t4=$(date +%s)
    echo "DEPLOY OK install $((t1-t0))s migrate $((t2-t1))s seed $((t3-t2))s start $((t4-t3))s"
    exit 0
  fi
  sleep 1
done
echo "DEPLOY FAIL: no answer from GET /health on port $PORT within 120 s"
[ -n "${W27_LOCAL:-}" ] && tail -40 "$APP.log" || sudo journalctl -u w27-app --no-pager -n 40
exit 1
