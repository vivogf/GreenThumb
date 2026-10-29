# M9 runbook: recovery-key hash (stage 1) + two-phase key rotation

What ships: migration `server/migrations/008_recovery_key_hash.sql` (hash column, pending column, trigger) and
the build that uses it (login by current OR pending hash, `regenerate` writes only a pending key,
`POST /api/auth/confirm-recovery-key` promotes it). The plaintext column `users.recovery_key` stays until
stage 2 (migration 009, not part of this runbook).

Why the order matters: the recovery key is the only credential. The KMP app erases its key and local data on a
401 at login, so a false 401 loses an account for good. 008 is compatible with the build that runs now, so the
database changes first and the code second; the code can be rolled back without touching the database.

Nothing in this file was run while writing it. Run each step by hand, read its output, then go to the next.

**IRREVERSIBLE** marks a step that cannot be undone by running something else.

Hosts and paths: VPS `<SSH_USER>@<VPS_IP>`, app `/var/www/greenthumb`, DB `greenthumb` owned by role
`greenthumb`, Postgres local (peer auth for OS user `postgres`), pm2 app `greenthumb`.

Never print key material: no `SELECT *` on `users`, no `pm2 env`, no bare `pm2 describe` / `pm2 jlist` on a
shared screen (they print `.env` values), no `set -x` while a smoke-test key is in a variable.

---

## 0. Before the window

1. **Commit.** The owner commits the M9 work. `scripts/deploy.sh` refuses a dirty tree, and the manual steps
   below also assume one: `REVISION` must name the exact code that runs.
   ```bash
   cd ~/Proj/GreenThumbPWA && git status --porcelain --untracked-files=no   # must print nothing
   git rev-parse HEAD                                                        # the revision to deploy
   ```
   The untracked `Icon.png`, `Icon_with_title.jpg`, `droid-wiki/` sit outside the deployed paths and do not block.
2. Run `npm test` and `npx tsc --noEmit` on that commit. Both must pass.
3. KMP: update every test phone to the KMP build with two key slots (`RECOVERY_KEY` + `RECOVERY_KEY_PENDING`)
   before the server build goes live (design step 8, item 12).
4. Pick the window. Not at `:00` (push cron reads `users`) and not at `:17` (hourly backup `pg_dump`). Both take
   locks that make 008 wait; 008 gives up after 5 s (`lock_timeout`). Use `:25`–`:50`.
5. Before the window, save the recovery key of every test account to a password manager (design step 8,
   stage 0). Any unexpected 401 on a phone erases its key; without a copy that account cannot come back.

## 1. Read-only pre-checks (production DB)

On the VPS. Each command only reads.

```bash
ssh <SSH_USER>@<VPS_IP>
cd /var/www/greenthumb
P() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb -c 'SET default_transaction_read_only = on' -c "$1"; }

# 1a. Statement logging. A logged statement can carry bind values (keys, hashes) into the Postgres log.
#     Same as SHOW for each name; SHOW takes one name at a time.
P "SELECT name, setting FROM pg_settings WHERE name IN ('log_statement','log_min_duration_statement','log_parameter_max_length','log_parameter_max_length_on_error','archive_mode') ORDER BY name"

# 1b. recovery_key must be uuid (008 also refuses to run otherwise).
P "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'users'::regclass AND attname = 'recovery_key' AND NOT attisdropped"

# 1c. Keys that are not v4 UUIDs (count only).
P "SELECT count(*) AS total, count(*) FILTER (WHERE recovery_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$') AS non_v4 FROM users"

# 1d. 008 not applied yet, and no column of it exists.
P "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3"
P "SELECT count(*) FROM pg_attribute WHERE attrelid = 'users'::regclass AND attname IN ('recovery_key_hash','pending_recovery_key_hash') AND NOT attisdropped"

# 1e. Isolation level. The confirm/login race handling assumes READ COMMITTED.
P "SHOW default_transaction_isolation"
```

Expected, else stop and decide before going on:

| Check | Expected | If not |
|---|---|---|
| `log_statement` | `none` or `ddl` | `mod`/`all` logs every UPDATE with its values: stop |
| `log_min_duration_statement` | `-1` | `>= 0`: slow statements are logged with values unless `log_parameter_max_length = 0` |
| `log_parameter_max_length` | `0` (or `log_min_duration_statement = -1`) | values reach the log on slow statements |
| `log_parameter_max_length_on_error` | `0` | values reach the log on errors |
| `archive_mode` | note it | `on`: WAL archives keep plaintext keys after stage 2; plan for it in 009 |
| type | `uuid` | stop; 008 would raise anyway |
| `non_v4` | `0` | login still works (any UUID spelling is accepted); tell the KMP owner if its input check is v4-only |
| last migration | `007_…` | `008_…` already there: stop, find out who applied it |
| column count | `0` | stop |
| `default_transaction_isolation` | `read committed` | `repeatable read`/`serializable`: a confirm/login race gives 503, not 401. Safe: note it and go on |

Changing a logging setting is a config change (`ALTER SYSTEM` + reload): do it only as a separate decision.

## 2. Rehearsal on a restored copy

Goal: run the new 008 and the new verify script on real data without touching the live DB. Do NOT use
`scripts/ops/restore-rehearsal.mjs` (it drops the copy at the end) and do NOT use `migrate.mjs` here (it would
upload one more plaintext pre-migration dump to R2).

1. Upload only the two new files into a staging dir inside the app dir (so `postgres` resolves from
   `/var/www/greenthumb/node_modules`). From the Mac, on the committed tree:
   ```bash
   cd ~/Proj/GreenThumbPWA
   ssh <SSH_USER>@<VPS_IP> 'mkdir -p /var/www/greenthumb/.m9-staging/server/migrations /var/www/greenthumb/.m9-staging/scripts'
   rsync -az --no-owner --no-group server/migrations/008_recovery_key_hash.sql <SSH_USER>@<VPS_IP>:/var/www/greenthumb/.m9-staging/server/migrations/
   rsync -az --no-owner --no-group --delete scripts/ops/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/.m9-staging/scripts/ops/
   ```
2. Download the newest hourly dump (it contains plaintext keys: mode 600, delete it in step 7).
   ```bash
   cd /var/www/greenthumb && umask 077 && node --input-type=module -e "
   import { loadEnvFile } from './scripts/ops/lib/env.mjs';
   import { r2Client, backupsBucket, listObjects, downloadObject } from './scripts/ops/lib/r2.mjs';
   import { newestKey } from './scripts/ops/lib/retention.mjs';
   loadEnvFile(); const c = r2Client();
   const key = newestKey(await listObjects(c, backupsBucket(), 'hourly/'), 'hourly/');
   console.log(key);
   await downloadObject(c, backupsBucket(), key, '/root/m9-rehearsal.dump'); c.destroy();"
   ```
3. Restore into `greenthumb_restore_check`, owned by `greenthumb` (same flags as the rehearsal script; the copy
   is NOT dropped at the end of this step):
   ```bash
   sudo -u postgres dropdb --if-exists greenthumb_restore_check
   sudo -u postgres createdb -O greenthumb greenthumb_restore_check
   sudo -u postgres pg_restore --no-owner --no-acl --role=greenthumb --exit-on-error --single-transaction \
     -d greenthumb_restore_check < /root/m9-rehearsal.dump
   ```
4. Run 008 as role `greenthumb` with psql, in one transaction (`--single-transaction`; without it
   `SET LOCAL lock_timeout` does nothing). Run it twice: the second run proves it is safe to re-run.
   ```bash
   S=/var/www/greenthumb/.m9-staging/server/migrations/008_recovery_key_hash.sql
   for i in 1 2; do
     sudo -u postgres psql -X -v ON_ERROR_STOP=1 --single-transaction -d greenthumb_restore_check \
       -c 'SET ROLE greenthumb' -f - < "$S" && echo "008 run $i ok"
   done
   ```
   Expected: `008 run 1 ok`, `008 run 2 ok`, no `ERROR`.
5. Verify with the copy's URL (the staging dir has no `.env`, so only this URL is used):
   ```bash
   REHEARSAL_URL="$(node --env-file=/var/www/greenthumb/.env -e 'const u = new URL(process.env.DATABASE_URL); u.pathname = "/greenthumb_restore_check"; process.stdout.write(u.href)')"
   DATABASE_URL="$REHEARSAL_URL" node /var/www/greenthumb/.m9-staging/scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"
   unset REHEARSAL_URL
   ```
   Expected: `total=<users count> mismatched=0 null=0 pending=0 pending_malformed=0 pending_is_current=0`, `exit=0`.
6. Old-build behaviour on the copy (rolled back; counts only):
   ```bash
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb_restore_check <<'SQL'
   BEGIN;
   SET ROLE greenthumb;
   UPDATE users SET pending_recovery_key_hash = repeat('a', 64) WHERE id = (SELECT min(id) FROM users);
   UPDATE users SET recovery_key = gen_random_uuid() WHERE id = (SELECT min(id) FROM users);  -- the old regenerate
   SELECT count(*) FILTER (WHERE pending_recovery_key_hash IS NOT NULL) AS pending_left,
          count(*) FILTER (WHERE recovery_key_hash <> encode(sha256(convert_to(recovery_key::text, 'UTF8')), 'hex')) AS mismatched
     FROM users;
   INSERT INTO users (name) VALUES ('m9-old-build-insert') RETURNING (recovery_key_hash IS NOT NULL) AS hash_filled;
   ROLLBACK;
   SQL
   ```
   Expected: `pending_left = 0`, `mismatched = 0`, `hash_filled = t`.
7. Clean up. **IRREVERSIBLE** (the copy and the local dump are gone; the R2 dump stays):
   ```bash
   sudo -u postgres dropdb greenthumb_restore_check
   rm -f /root/m9-rehearsal.dump
   rm -rf /var/www/greenthumb/.m9-staging
   ```

Any failure in 3–6: stop. Production has not been touched.

## 3. Production

### 3.1 Migration while the old build still runs

1. From the Mac (committed tree), upload the migrations and ops scripts only. `dist/` stays as it is, so the
   running process is the old build.
   ```bash
   cd ~/Proj/GreenThumbPWA
   rsync -az --no-owner --no-group --delete -e 'ssh -o BatchMode=yes' server/migrations/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/server/migrations/
   rsync -az --no-owner --no-group --delete -e 'ssh -o BatchMode=yes' scripts/ops/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/scripts/ops/
   ```
2. Apply 008. **IRREVERSIBLE** (schema change on the live DB; it is old-build compatible, so it is never rolled
   back). `migrate.mjs` first uploads a pre-migration dump to R2 (it contains plaintext keys; retention keeps 10).
   ```bash
   cd /var/www/greenthumb && node --env-file=.env scripts/ops/migrate.mjs
   ```
   Expected: `migrate: pre-migration backup …`, then `migrate: applied 008_recovery_key_hash.sql`.
   `55P03` / lock timeout: nothing was changed (one transaction). Wait a few minutes, run it again. Each re-run
   uploads one more plaintext pre-migration dump to R2: write down how many, the stage-3 cleanup must count them.
   Any other failure: do not paste the full output anywhere public (a Postgres message can quote a value); stop.
3. Verify. Read-only.
   ```bash
   cd /var/www/greenthumb && node scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"
   ```
   Expected: `mismatched=0 null=0 pending=0 pending_malformed=0 pending_is_current=0`, `exit=0`. Else stop: the old
   build keeps working on this schema, so there is no hurry.
4. Optional: one sign-in in the web app with an existing key. The old build answers it (trigger fills the hash).

### 3.2 The new build

1. On the Mac, build the committed tree:
   ```bash
   cd ~/Proj/GreenThumbPWA && npm run build && test -f dist/index.js && git rev-parse HEAD
   ```
2. On the VPS, keep the running build for a rollback:
   ```bash
   cd /var/www/greenthumb && rm -rf dist.prev && cp -a dist dist.prev && cp -a REVISION REVISION.prev
   ```
3. From the Mac, upload the build and the process file:
   ```bash
   rsync -az --no-owner --no-group --delete -e 'ssh -o BatchMode=yes' dist/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/dist/
   rsync -az --no-owner --no-group -e 'ssh -o BatchMode=yes' ecosystem.config.cjs package.json package-lock.json <SSH_USER>@<VPS_IP>:/var/www/greenthumb/
   ```
   Lockfile: compare `shasum -a 256 package-lock.json` (Mac) with `cat /var/www/greenthumb/.lockfile.sha256`
   (VPS). Different: on the VPS run `npm ci --omit=dev --no-audit --no-fund` and write the new hash into
   `.lockfile.sha256`, as `deploy.sh` does.
4. Restart from the process file and save. The new file sends stdout and stderr to `/dev/null` (no user logs,
   §6.3). pm2 changes log paths only when the process is started again, so delete and start instead of
   `reload` (a few seconds of downtime):
   ```bash
   cd /var/www/greenthumb && pm2 delete greenthumb && pm2 start ecosystem.config.cjs && pm2 save
   pm2 describe greenthumb | grep -E 'status|uptime|restarts'
   pm2 show greenthumb | grep -i 'log path'      # out log path and error log path: /dev/null
   ```
   A log path other than `/dev/null`: the old file is still in use; stop and find out why before going on.
5. Write the revision and check health:
   ```bash
   echo <revision> > /var/www/greenthumb/REVISION.tmp && mv /var/www/greenthumb/REVISION.tmp /var/www/greenthumb/REVISION
   curl -sS https://greenthumb.xmpp.site/api/health      # "db":true and "revision":"<revision>"
   ```

Why not `scripts/deploy.sh`: it uploads, migrates and reloads in one go, with no verify gate between 008 and the
new build and no `dist.prev`.

## 4. Smoke test on a throwaway account

From any shell. The keys belong to two accounts that steps 9 and 14 delete. Do not run with `set -x`.

```bash
B=https://greenthumb.xmpp.site
T=$(mktemp -d) && chmod 700 "$T"
J() { curl -sS -o "$T/body" -w '%{http_code}\n' -H 'content-type: application/json' "$@"; }
F() { node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(eval(process.argv[2]))' "$T/body" "$1"; }

J -c "$T/a" -X POST -d '{"name":"m9-smoke"}' "$B/api/auth/create-anonymous"         # 1. 200
K1=$(F 'o.user.recovery_key')
J -c "$T/b" -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"     # 2. 200 (second session)
J -b "$T/a" -X POST "$B/api/auth/regenerate-recovery-key"                            # 3. 200
F '[o.user.recovery_key === undefined, typeof o.pending_recovery_key, /[0-9a-f]{64}/.test(JSON.stringify(o))]'   # true,string,false
K2=$(F 'o.pending_recovery_key')
J -b "$T/b" "$B/api/auth/me"                                                          # 4. 200 (sessions intact)
J -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"                # 4. 200 (old key works until confirm)
R=$(node -e 'console.log(require("crypto").randomUUID())')
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$R\"}" "$B/api/auth/confirm-recovery-key"; F 'o.code'      # 4a. 409 not_pending (key not the pending one)
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/confirm-recovery-key"; F 'o.status'   # 5. 200 committed
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/confirm-recovery-key"; F 'o.status'   # 6. 200 already_current
J -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"                # 7. 401 (old key dead)
J -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/login-recovery"                # 7. 200
J -b "$T/b" "$B/api/auth/me"                                                          # 8. 401 (second session revoked)
J -b "$T/a" "$B/api/auth/me"                                                          # 8. 200
J -b "$T/a" -X DELETE "$B/api/auth/account"                                           # 9. 200  IRREVERSIBLE (throwaway account)
J -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/login-recovery"                # 9. 401

# Second throwaway account: sign-in with the pending key commits it without a confirm (the KMP path).
J -c "$T/c" -X POST -d '{"name":"m9-smoke-2"}' "$B/api/auth/create-anonymous"       # 10. 200
L1=$(F 'o.user.recovery_key')
J -b "$T/c" -X POST "$B/api/auth/regenerate-recovery-key"                            # 11. 200
L2=$(F 'o.pending_recovery_key')
J -c "$T/d" -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"     # 12. 200 (pending key, before any confirm)
J -X POST -d "{\"recoveryKey\":\"$L1\"}" "$B/api/auth/login-recovery"                # 13. 401 (old key dead)
J -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"                # 13. 200
J -b "$T/d" -X DELETE "$B/api/auth/account"                                           # 14. 200  IRREVERSIBLE (throwaway account)
J -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"                # 14. 401
rm -rf "$T"; unset K1 K2 L1 L2 R
```

Then on the VPS:

```bash
cd /var/www/greenthumb && node scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"   # mismatched=0 …, exit=0
```

The app keeps no logs now (§6.3), so the `login-recovery: hash_miss` line cannot be read back. A hash that
disagrees with its key shows up here as `mismatched` > 0: stop rotations until it is explained.
This verify (§3.1 step 3 before the start, and again at the end of the soak) is the stage-1 exit test.

Any unexpected status in steps 1–14: go to section 5.

## 5. Rollback (code only; the database stays as it is)

```bash
cd /var/www/greenthumb
rsync -a --delete dist.prev/ dist/
cp -a REVISION.prev REVISION.tmp && mv REVISION.tmp REVISION
pm2 reload ecosystem.config.cjs --update-env && pm2 save
curl -sS https://greenthumb.xmpp.site/api/health        # the previous revision
```

Do not drop the 008 columns, index or trigger. Why it is safe: the old build ignores the pending column; its
regenerate writes `recovery_key`, and the trigger recomputes the hash and clears any pending key. A rotation the
new build already committed wrote the plaintext column too, so the old build signs that user in. A KMP phone with
a pending key gets 404 on confirm from the old build and keeps both keys.

## 6. Separate manual steps (not part of the deploy)

### 6.1 nginx HSTS

`deploy/nginx/greenthumb.conf` adds `Strict-Transport-Security "max-age=31536000"` at server level and repeats
it in `location /photos/` (a location with its own `add_header` drops the inherited ones).

**IRREVERSIBLE** for every browser that sees the header: for one year it refuses plain HTTP and certificate
click-through on `greenthumb.xmpp.site`. Removing the header later does not undo that. A lapsed certificate then
locks web users out. The certificate is the Let's Encrypt one issued on 2026-10-26, valid until 2027-01-24, with
a deploy-hook that reloads nginx (`docs/ops/cutover.md`, step 6). Before this step, both must hold, else stop:
```bash
certbot renew --dry-run --no-random-sleep-on-renew    # must succeed
systemctl is-active certbot.timer                      # active
```

1. Read what is there now:
   ```bash
   nginx -T 2>/dev/null | grep -n add_header
   ```
   A `Strict-Transport-Security` line already present: stop, do not add a second one.
2. Back up and compare with the repo file (copied to `/root/greenthumb.conf` with `scp`):
   ```bash
   cp -a /etc/nginx/sites-available/greenthumb /root/greenthumb.nginx.bak.$(date -u +%Y%m%dT%H%M%SZ)
   diff /etc/nginx/sites-available/greenthumb /root/greenthumb.conf
   ```
   Only the two HSTS lines, the no-log lines of §6.3 and their comments differ: copy the file over. Anything
   else differs (certificate paths, server-local edits): add the two `add_header` lines by hand instead.
3. Test, then reload:
   ```bash
   nginx -t && systemctl reload nginx
   ```
4. Check both places:
   ```bash
   curl -sI https://greenthumb.xmpp.site/ | grep -i strict-transport-security
   curl -sI https://greenthumb.xmpp.site/photos/m9-check | grep -i strict-transport-security
   ```

### 6.2 Crontab

`deploy/cron/greenthumb.cron` changes the push line: the log gets a UTC timestamp and the HTTP status only (the
response body lists user ids). Install as in `docs/ops/photos.md`:

```bash
crontab -l > /root/crontab.bak.$(date -u +%Y%m%dT%H%M%SZ)
# copy deploy/cron/greenthumb.cron to /root/greenthumb.cron with scp first
( crontab -l 2>/dev/null | grep -v -e 'greenthumb' ; grep -v '^#' /root/greenthumb.cron | sed '/^$/d' ) | crontab -
crontab -l | grep -c greenthumb                                                                 # 3
crontab -l | grep -cF "$(grep '^PUSH_CHECK_API_KEY=' /var/www/greenthumb/.env | cut -d= -f2-)"  # 0
```

After the next `:00`: `tail -2 /var/log/greenthumb-push.log` shows `<UTC time> check-plants HTTP 200`.
Undo: `crontab /root/crontab.bak.<ts>`.

### 6.3 No user logs (pm2 and nginx)

Owner's decision: the server keeps no log that can name a user or a device. App lines carry the user id, nginx
lines carry the client IP. The cron ops logs (`/var/log/greenthumb-push.log`, `-backup.log`, `-photo-sweep.log`)
stay: they hold HTTP codes and `backup ok/FAILED` only, and `/etc/logrotate.d/greenthumb` rotates them weekly,
8 kept.

1. pm2: done in §3.2 step 4 (`ecosystem.config.cjs` sends stdout and stderr to `/dev/null`).
2. logrotate: copy `deploy/logrotate/greenthumb` to `/etc/logrotate.d/greenthumb` (the pm2 entry is gone), then
   `logrotate -d /etc/logrotate.d/greenthumb` (dry run, prints no log content).
3. nginx: `deploy/nginx/greenthumb.conf` sets `access_log off;` and `error_log /dev/null;` in both server blocks.
   Back up first:
   ```bash
   cp -a /etc/nginx/sites-available/greenthumb /root/greenthumb.nginx.bak.$(date -u +%Y%m%dT%H%M%SZ)
   ```
   The repo file also carries the HSTS header. If §6.1 is not done yet, add only these four lines by hand. If
   it is done, copy the repo file over after the diff check of §6.1 step 2. Then test and reload:
   ```bash
   nginx -t && systemctl reload nginx
   ```
4. Check (replaces the old idea of grepping pm2 logs for `"user":{"id"`):
   ```bash
   pm2 show greenthumb | grep -i 'log path'               # both lines: /dev/null
   nginx -T 2>/dev/null | grep -E 'access_log|error_log'
   ls /etc/nginx/sites-enabled                            # greenthumb only
   ```
   Expected from `nginx -T`: `access_log off;` and `error_log /dev/null;` twice each from the greenthumb site.
   Lines from `/etc/nginx/nginx.conf` (http level, `/var/log/nginx/...`) also show. They apply only to server
   blocks that set nothing themselves, and to nginx start-up messages. Any other site in `sites-enabled` still
   logs: decide about it separately. Only `grep 'log path'` output may be shown: bare `pm2 show` prints env.

### 6.4 Delete the old logs that carry user data

**IRREVERSIBLE.** Run only after §6.3 step 4 passes, else new lines appear at once.

Logs from builds before M9 can hold response bodies with keys. Scan them first; delete only on exit 0.

1. Scan. Read-only; prints counts only (files, distinct UUIDs, matches with current and pending keys):
   ```bash
   cd /var/www/greenthumb && node scripts/ops/scan-logs-for-keys.mjs '/root/.pm2/logs/*' '/var/log/nginx/*'; echo "exit=$?"
   ```
   - `exit=0`: no live key in these logs. Go to step 2.
   - `exit=2`: **STOP.** Live keys are in the logs. The matched accounts must rotate their keys or be deleted
     before the logs go. The owner decides which; then run the scan again.
   - `exit=1`: error (a missing path, a directory in the glob, no DB): stop and fix it, then run again.
2. Delete:

```bash
pm2 ls                                                       # greenthumb is the only app, else narrow the glob to greenthumb-*
du -sh /root/.pm2/logs/*.log* /var/log/nginx/access.log* /var/log/nginx/error.log*   # sizes only; write them down
pm2 flush
rm -f /root/.pm2/logs/*.log* /var/log/nginx/access.log* /var/log/nginx/error.log*
systemctl reload nginx                                       # nginx reopens its files and lets go of the deleted ones
ls -la /root/.pm2/logs /var/log/nginx
```

Never `cat`, `tail` or `less` these files, before or after: sizes only.

The old VPS `<OLD_VPS_IP>` also holds pm2 and nginx logs from before the cutover. They get the same
scan-then-delete in the stage-3 cleanup (design step 8, stage 3).

## 7. Known costs (accepted in the design, not fixed here)

- A pending key has no expiry: a rotation abandoned on the web leaves a second working key until the next
  regenerate or confirm. A stolen session can quietly get a pending key.
- A leaked old key works until the confirm.
- An Expo-app regenerate now fails on the client (no `user.recovery_key` in the answer) and leaves a pending key
  behind; the old key keeps working.
- A session upserted right after the commit's `DELETE` can survive it (race in `express-session`).
- The reverse race: a sign-in that arrives with a live cookie while another device commits can lose that sid.
  The next request gets 401, KMP signs in again, and it converges with no loss.
