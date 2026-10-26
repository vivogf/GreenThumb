#!/usr/bin/env bash
# Build on this Mac and ship the build to the production VPS.
#
#   bash scripts/deploy.sh            build, upload, npm ci (only if the lockfile changed),
#                                     migrations (when scripts/ops/migrate.mjs exists), pm2 reload,
#                                     write REVISION, wait for /api/health to report the new revision
#   bash scripts/deploy.sh --dry-run  print the plan (revision, target, file count) and change nothing
#
# Env overrides: DEPLOY_HOST (default <SSH_USER>@<VPS_IP>), DEPLOY_DOMAIN (default greenthumb.xmpp.site).
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-<SSH_USER>@<VPS_IP>}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-greenthumb.xmpp.site}"
TARGET_DIR="/var/www/greenthumb"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
HEALTH_TIMEOUT_S=90

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "deploy: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# Tracked changes anywhere, or untracked files inside the paths that end up in the build or upload.
DIRTY="$(git status --porcelain --untracked-files=no)"
UNTRACKED="$(git status --porcelain --untracked-files=all -- client server shared scripts deploy package.json package-lock.json ecosystem.config.cjs vite.config.ts tsconfig.json | grep '^??' || true)"
if [ -n "$DIRTY" ] || [ -n "$UNTRACKED" ]; then
  echo "deploy: refusing to deploy: the working tree has uncommitted changes. Commit or remove them first." >&2
  printf '%s\n%s\n' "$DIRTY" "$UNTRACKED" | sed '/^$/d' >&2
  exit 1
fi

REVISION="$(git rev-parse HEAD)"
HOST_IP="${DEPLOY_HOST#*@}"

# Upload set: [local path]=remote path. Directories are mirrored with --delete inside themselves only.
UPLOAD_DIRS=()
for d in dist server/migrations scripts/ops; do
  if [ "$d" = dist ] || [ -d "$d" ]; then UPLOAD_DIRS+=("$d"); fi
done
UPLOAD_FILES=(package.json package-lock.json ecosystem.config.cjs)

count_files() {
  local n=${#UPLOAD_FILES[@]} d
  for d in "${UPLOAD_DIRS[@]}"; do
    if [ -d "$d" ]; then n=$((n + $(find "$d" -type f | wc -l))); fi
  done
  echo "$n"
}

LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"

if [ "$DRY_RUN" = 1 ]; then
  REMOTE_STATE="$(ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "cd $TARGET_DIR 2>/dev/null && printf '%s %s\n' \"\$(cat REVISION 2>/dev/null || echo none)\" \"\$(cat .lockfile.sha256 2>/dev/null || echo none)\"" || echo "unreachable unreachable")"
  REMOTE_REV="${REMOTE_STATE%% *}"
  REMOTE_LOCK="${REMOTE_STATE##* }"
  echo "deploy plan (dry run, nothing is built, uploaded or restarted)"
  echo "  revision:        $REVISION"
  echo "  target:          $DEPLOY_HOST:$TARGET_DIR/"
  echo "  deployed now:    $REMOTE_REV"
  echo "  files:           $(count_files) (dist/ counted from the current local build; a real run rebuilds it first)"
  echo "  upload:          ${UPLOAD_DIRS[*]/%//} ${UPLOAD_FILES[*]}"
  if [ "$REMOTE_LOCK" = "$LOCK_HASH" ]; then echo "  npm ci:          skipped (lockfile unchanged)"; else echo "  npm ci:          yes (lockfile hash differs)"; fi
  if [ -f scripts/ops/migrate.mjs ]; then echo "  migrations:      node scripts/ops/migrate.mjs"; else echo "  migrations:      none (no scripts/ops/migrate.mjs)"; fi
  echo "  reload:          pm2 reload greenthumb --update-env (via ecosystem.config.cjs)"
  echo "  health check:    https://$DEPLOY_DOMAIN/api/health via $HOST_IP"
  exit 0
fi

echo "==> build $REVISION"
npm run build
test -f dist/index.js || { echo "deploy: dist/index.js missing after build" >&2; exit 1; }

echo "==> upload to $DEPLOY_HOST:$TARGET_DIR/ ($(count_files) files)"
RSYNC=(rsync -az --no-owner --no-group -e "ssh ${SSH_OPTS[*]}")
for d in "${UPLOAD_DIRS[@]}"; do
  ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "mkdir -p $TARGET_DIR/$d"
  "${RSYNC[@]}" --delete "$d/" "$DEPLOY_HOST:$TARGET_DIR/$d/"
done
"${RSYNC[@]}" "${UPLOAD_FILES[@]}" "$DEPLOY_HOST:$TARGET_DIR/"

echo "==> install, migrate, reload"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "REVISION=$REVISION TARGET_DIR=$TARGET_DIR bash -s" <<'REMOTE'
set -euo pipefail
cd "$TARGET_DIR"
test -f .env || { echo "deploy: $TARGET_DIR/.env is missing" >&2; exit 1; }
chmod 600 .env
NEW_LOCK="$(sha256sum package-lock.json | cut -d' ' -f1)"
OLD_LOCK="$(cat .lockfile.sha256 2>/dev/null || true)"
if [ "$NEW_LOCK" != "$OLD_LOCK" ] || [ ! -d node_modules ]; then
  echo "npm ci --omit=dev (lockfile changed)"
  npm ci --omit=dev --no-audit --no-fund
  echo "$NEW_LOCK" > .lockfile.sha256
else
  echo "npm ci skipped (lockfile unchanged)"
fi
if [ -f scripts/ops/migrate.mjs ]; then
  node --env-file=.env scripts/ops/migrate.mjs
fi
if pm2 describe greenthumb >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save
echo "$REVISION" > REVISION.tmp && mv REVISION.tmp REVISION
REMOTE

echo "==> wait for https://$DEPLOY_DOMAIN/api/health (via $HOST_IP) to report $REVISION"
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
while :; do
  body="$(curl -sS --max-time 5 --resolve "$DEPLOY_DOMAIN:443:$HOST_IP" "https://$DEPLOY_DOMAIN/api/health" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q "\"revision\":\"$REVISION\"" && printf '%s' "$body" | grep -q '"db":true'; then
    echo "healthy: $body"
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "deploy: health did not report revision $REVISION within ${HEALTH_TIMEOUT_S}s; last body: ${body:-<none>}" >&2
    exit 1
  fi
  sleep 2
done
echo "deploy: done ($REVISION)"
