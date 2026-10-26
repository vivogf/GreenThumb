#!/usr/bin/env bash
# Copy the Neon database into the local Postgres on the new VPS (run ON the VPS as root).
#
#   neon-sync.sh <url-file> [--promote]
#
# <url-file> holds one line `DATABASE_URL=<neon url>` (mode 600). It is deleted on exit.
# Feed it from the old server without the URL ever touching argv or a terminal:
#   ssh <SSH_USER>@<OLD_VPS_IP> "grep '^DATABASE_URL=' /var/www/greenthumb/.env" \
#     | ssh <SSH_USER>@<VPS_IP> 'umask 077; cat > ~/.gt-neon-url'
#
# Steps: read-only Neon session (counts, photo_url profile) -> pg_dump -Fc to /var/backups/greenthumb/
# -> restore into greenthumb_restore_check -> compare row counts. Without --promote the check DB is dropped.
# With --promote the app is stopped, the check DB replaces `greenthumb`, and the app is started again.
set -euo pipefail

URL_FILE="${1:?usage: neon-sync.sh <url-file> [--promote]}"
PROMOTE=0
[ "${2:-}" = "--promote" ] && PROMOTE=1

umask 077
WORK="$(mktemp -d /root/.gt-neon-sync.XXXXXX)"
cleanup() { rm -f "$URL_FILE"; rm -rf "$WORK"; }
trap cleanup EXIT

BACKUP_DIR=/var/backups/greenthumb
install -d -m 700 "$BACKUP_DIR"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DUMP="$BACKUP_DIR/neon-$TS.dump"
CHECK_DB=greenthumb_restore_check

# libpq env vars, never argv. The direct (non-pooler) endpoint is used because pg_dump needs session mode.
node - "$URL_FILE" > "$WORK/pgenv" <<'JS'
const fs = require('fs');
const file = process.argv[process.argv.length - 1];
const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
if (!line) { console.error('neon-sync: no DATABASE_URL line in the url file'); process.exit(1); }
const u = new URL(line.slice('DATABASE_URL='.length).trim());
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const vars = {
  PGHOST: u.hostname.replace(/-pooler(?=\.)/, ''),
  PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  PGSSLMODE: u.searchParams.get('sslmode') || 'require',
  PGOPTIONS: '-c default_transaction_read_only=on',
  PGCONNECT_TIMEOUT: '15',
};
for (const [k, v] of Object.entries(vars)) console.log(`export ${k}=${q(v)}`);
JS

COUNT_SQL_GEN="select string_agg(format('select %L, count(*) from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname = 'public'"
PHOTO_SQL="select count(*) filter (where photo_url like 'data:%') as data_url, count(*) filter (where photo_url ~ '^https?://') as http_url, count(*) filter (where coalesce(photo_url, '') = '') as empty from plants"

table_counts() { # uses whatever libpq env / args are given
  local sql
  sql="$("$@" -XAt -v ON_ERROR_STOP=1 -c "$COUNT_SQL_GEN")"
  "$@" -XAt -F ' ' -v ON_ERROR_STOP=1 -c "$sql" | LC_ALL=C sort
}

echo "==> Neon (read-only): counts and dump"
(
  . "$WORK/pgenv"
  echo "server: $(psql -XAt -c 'show server_version')"
  table_counts psql > "$WORK/neon-counts.txt"
  echo "photo_url (data/http/empty): $(psql -XAt -F ' ' -c "$PHOTO_SQL")"
  pg_dump -Fc --no-owner --no-acl -f "$DUMP"
)
echo "dump: $DUMP ($(stat -c %s "$DUMP") bytes)"

echo "==> restore into $CHECK_DB"
sudo -u postgres dropdb --if-exists "$CHECK_DB"
sudo -u postgres createdb -O greenthumb "$CHECK_DB"
sudo -u postgres pg_restore --no-owner --no-acl --role=greenthumb --exit-on-error -d "$CHECK_DB" < "$DUMP"
table_counts sudo -u postgres psql -d "$CHECK_DB" > "$WORK/local-counts.txt"

echo "==> row counts (table neon local)"
LC_ALL=C join -a1 -a2 -e MISSING -o 0,1.2,2.2 "$WORK/neon-counts.txt" "$WORK/local-counts.txt" | tee "$WORK/joined.txt"
if awk '$2 != $3 { bad = 1 } END { exit bad ? 0 : 1 }' "$WORK/joined.txt"; then
  echo "neon-sync: row counts differ; $CHECK_DB kept for inspection, nothing promoted" >&2
  exit 1
fi
echo "row counts equal"

if [ "$PROMOTE" = 0 ]; then
  sudo -u postgres dropdb "$CHECK_DB"
  echo "rehearsal only: $CHECK_DB dropped"
  exit 0
fi

echo "==> promote $CHECK_DB -> greenthumb"
APP_WAS_ONLINE=0
if pm2 describe greenthumb 2>/dev/null | grep -q 'status.*online'; then APP_WAS_ONLINE=1; pm2 stop greenthumb >/dev/null; fi
PREV_DB="greenthumb_restore_check_prev"
sudo -u postgres dropdb --if-exists "$PREV_DB"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<SQL
select pg_terminate_backend(pid) from pg_stat_activity where datname = 'greenthumb' and pid <> pg_backend_pid();
alter database greenthumb rename to $PREV_DB;
alter database $CHECK_DB rename to greenthumb;
SQL
if [ "$APP_WAS_ONLINE" = 1 ]; then pm2 start greenthumb >/dev/null; fi
sudo -u postgres dropdb "$PREV_DB"
echo "promoted; previous greenthumb DB dropped (the dump $DUMP is the copy of record)"
