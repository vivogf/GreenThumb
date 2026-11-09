# M9 runbook: recovery-key hash, stage 1 + stage 2 in one window

What ships, in one maintenance window (owner's decision 2026-10-29: effectively 0 real users, no multi-day soak):

Placeholders such as `<VPS_IP>`, `<OLD_VPS_IP>`, `<SSH_USER>`, `<R2_BACKUP_BUCKET>` and `<R2_PHOTO_BUCKET>` stand for
values kept out of git in `~/.config/greenthumb/ops.env` (mode 600) on the operator's Mac.

- Migration `server/migrations/008_recovery_key_hash.sql` (stage 1, expand): `users.recovery_key_hash` (backfilled,
  NOT NULL, unique, CHECK), `users.pending_recovery_key_hash`, and a trigger that keeps the hash in sync with the
  plaintext column while the old build may still write it.
- Migration `server/migrations/009_drop_plaintext_recovery_key.sql` (stage 2, contract): refuses to run without the
  008 column or with any NULL hash, keeps the hash NOT NULL and unique, drops the 008 trigger and its function, then
  drops the plaintext column `users.recovery_key`.
- The build that never names `recovery_key`: sign-in and confirm look up by hash only, create stores only the hash
  (plus a second UPDATE so the 008 trigger cannot overwrite it while 009 is not applied yet), regenerate writes only
  a pending hash. It runs on the 008 schema and on the 009 schema. It does **not** run before 008 (no hash column).
- Deploy configs with no logs about people: pm2 stdout/stderr to `/dev/null`, nginx `access_log off;` and
  `error_log /dev/null;` in both server blocks plus HSTS, push cron logging only the UTC time and HTTP status.

Why the order matters: the recovery key is the only credential. The KMP app erases its key and local data on a 401
at sign-in, so a false 401 loses an account for good. Each gate below exists to stop before that can happen.

Nothing in this file was run on the VPS while writing it. The SQL and the new build's statements were rehearsed on
an empty PGlite database (001…009, both migrations twice, the create/login/rotate/confirm statements before and
after 009). Run each step by hand, read its output, then go to the next.

**IRREVERSIBLE** marks a step that cannot be undone by running something else. The owner approved the irreversible
steps of this window on 2026-10-29; each one still runs only after its own precondition passes.

Hosts and paths: VPS `<SSH_USER>@<VPS_IP>`, app `/var/www/greenthumb`, DB `greenthumb` owned by role `greenthumb`,
Postgres local (peer auth for OS user `postgres`), pm2 app `greenthumb`.

Never print key material: no `SELECT *` on `users`, no `pm2 env`, no bare `pm2 describe` / `pm2 jlist` / `pm2 show`
on a shared screen (they print `.env` values), no `set -x` while a key is in a variable.

---

## 0. Before the window

1. **Commit.** The manual steps below assume a clean tree: `REVISION` must name the exact code that runs.
   ```bash
   cd ~/Proj/GreenThumbPWA && git status --porcelain --untracked-files=no   # must print nothing
   git rev-parse HEAD                                                        # the revision to deploy
   ```
   The untracked `Icon.png`, `Icon_with_title.jpg`, `droid-wiki/` sit outside the deployed paths and do not block.
2. On that commit: `npm run check` and `npm test` pass.
3. **Do not use `scripts/deploy.sh` for this window.** It runs `migrate.mjs`, which applies every pending file:
   008 and 009 back to back, with no verify gate between them. After the window nothing is pending and
   `deploy.sh` is the normal path again.
4. KMP: every test phone runs the KMP build with two key slots (`RECOVERY_KEY` + `RECOVERY_KEY_PENDING`).
5. Pick the window. Write steps only at minutes `:25`–`:50`: the push cron reads `users` at `:00` and the hourly
   backup `pg_dump` runs at `:17`. Both take locks that make 008 or 009 wait; each gives up after 5 s
   (`lock_timeout`).
6. Save the recovery key of every test account in a password manager. The manual test account «Тест Ray»
   (user 275) has its key in `~/.config/greenthumb/manual-test/account.json` (`.user.recovery_key`); it must sign in
   after the window (§4.3).

## 1. Read-only pre-checks (production DB)

On the VPS. Each command only reads.

```bash
ssh <SSH_USER>@<VPS_IP>
cd /var/www/greenthumb
P() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb -c 'SET default_transaction_read_only = on' -c "$1"; }

# 1a. Statement logging. A logged statement can carry bind values (keys, hashes) into the Postgres log.
P "SELECT name, setting FROM pg_settings WHERE name IN ('log_statement','log_min_duration_statement','log_parameter_max_length','log_parameter_max_length_on_error','archive_mode') ORDER BY name"

# 1b. recovery_key must be uuid (008 also refuses to run otherwise).
P "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'users'::regclass AND attname = 'recovery_key' AND NOT attisdropped"

# 1c. Keys that are not v4 UUIDs (count only).
P "SELECT count(*) AS total, count(*) FILTER (WHERE recovery_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$') AS non_v4 FROM users"

# 1d. Neither 008 nor 009 applied yet, and no column of 008 exists.
P "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3"
P "SELECT count(*) FROM pg_attribute WHERE attrelid = 'users'::regclass AND attname IN ('recovery_key_hash','pending_recovery_key_hash') AND NOT attisdropped"

# 1e. Isolation level. The confirm/login race handling assumes READ COMMITTED.
P "SHOW default_transaction_isolation"

# 1f. Nothing else depends on users.recovery_key (009 drops it without CASCADE and would stop).
P "SELECT count(*) FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid WHERE d.refobjid = 'users'::regclass AND a.attname = 'recovery_key' AND d.classid = 'pg_rewrite'::regclass"
```

Expected, else stop and decide before going on:

| Check | Expected | If not |
|---|---|---|
| `log_statement` | `none` or `ddl` | `mod`/`all` logs every UPDATE with its values: stop |
| `log_min_duration_statement` | `-1` | `>= 0`: slow statements are logged with values unless `log_parameter_max_length = 0` |
| `log_parameter_max_length` | `0` (or `log_min_duration_statement = -1`) | values reach the log on slow statements |
| `log_parameter_max_length_on_error` | `0` | values reach the log on errors |
| `archive_mode` | `off` | `on`: WAL archives keep the plaintext keys after 009 and `VACUUM FULL`; stop and decide |
| type | `uuid` | stop; 008 would raise anyway |
| `non_v4` | `0` | sign-in still works (any UUID spelling is accepted); tell the KMP owner if its input check is v4-only |
| last migration | `007_…` | `008_…` or `009_…` already there: stop, find out who applied it |
| column count | `0` | stop |
| `default_transaction_isolation` | `read committed` | `repeatable read`/`serializable`: a confirm/login race gives 503, not 401. Note it and go on |
| views on `recovery_key` | `0` | stop: 009 would fail on it (it rolls back cleanly, but the window stalls) |

Changing a logging setting is a config change (`ALTER SYSTEM` + reload): do it only as a separate decision.

## 2. Rehearsal on a restored copy (008 + 009)

Goal: run 008, the verify script and 009 on real data without touching the live DB. Do NOT use
`scripts/ops/restore-rehearsal.mjs` (it drops the copy at the end) and do NOT use `migrate.mjs` here (it would
upload one more plaintext pre-migration dump to R2).

1. Upload the migrations and ops scripts into a staging dir inside the app dir (so `postgres` resolves from
   `/var/www/greenthumb/node_modules`). From the Mac, on the committed tree:
   ```bash
   cd ~/Proj/GreenThumbPWA
   ssh <SSH_USER>@<VPS_IP> 'mkdir -p /var/www/greenthumb/.m9-staging/server/migrations /var/www/greenthumb/.m9-staging/scripts'
   rsync -az --no-owner --no-group server/migrations/008_recovery_key_hash.sql server/migrations/009_drop_plaintext_recovery_key.sql <SSH_USER>@<VPS_IP>:/var/www/greenthumb/.m9-staging/server/migrations/
   rsync -az --no-owner --no-group --delete scripts/ops/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/.m9-staging/scripts/ops/
   ```
2. Download the newest hourly dump (it holds plaintext keys: mode 600, deleted in step 9).
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
3. Restore into `greenthumb_restore_check`, owned by `greenthumb` (same flags as the rehearsal script):
   ```bash
   sudo -u postgres dropdb --if-exists greenthumb_restore_check
   sudo -u postgres createdb -O greenthumb greenthumb_restore_check
   sudo -u postgres pg_restore --no-owner --no-acl --role=greenthumb --exit-on-error --single-transaction \
     -d greenthumb_restore_check < /root/m9-rehearsal.dump
   ```
4. A helper for the next steps: one file, one transaction, as role `greenthumb` (`--single-transaction`; without it
   `SET LOCAL lock_timeout` does nothing):
   ```bash
   S=/var/www/greenthumb/.m9-staging/server/migrations
   M() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 --single-transaction -d greenthumb_restore_check -c 'SET ROLE greenthumb' -f - < "$S/$1"; }
   REHEARSAL_URL="$(node --env-file=/var/www/greenthumb/.env -e 'const u = new URL(process.env.DATABASE_URL); u.pathname = "/greenthumb_restore_check"; process.stdout.write(u.href)')"
   V() { DATABASE_URL="$REHEARSAL_URL" node /var/www/greenthumb/.m9-staging/scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"; }
   ```
   The staging dir has no `.env`, so `V` uses only the copy's URL.
5. 008 twice (the second run proves it is safe to re-run), then verify:
   ```bash
   M 008_recovery_key_hash.sql && echo "008 run 1 ok"
   M 008_recovery_key_hash.sql && echo "008 run 2 ok"
   V
   ```
   Expected: both `ok`, then `total=<users> mismatched=0 null=0 pending=0 pending_malformed=0 pending_is_current=0`,
   `exit=0`. Write down `total`.
6. Old-build behaviour on the 008 copy (rolled back; counts only):
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
7. 009 twice, then the catalog and verify:
   ```bash
   M 009_drop_plaintext_recovery_key.sql && echo "009 run 1 ok"
   M 009_drop_plaintext_recovery_key.sql && echo "009 run 2 ok"
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb_restore_check -c "SELECT
     (SELECT count(*) FROM pg_attribute WHERE attrelid='users'::regclass AND attname='recovery_key' AND NOT attisdropped) AS plaintext_col,
     (SELECT count(*) FROM pg_trigger WHERE tgname='users_recovery_key_hash_sync') AS trg,
     (SELECT count(*) FROM pg_proc WHERE proname='users_recovery_key_hash_sync') AS fn,
     (SELECT attnotnull FROM pg_attribute WHERE attrelid='users'::regclass AND attname='recovery_key_hash') AS hash_not_null,
     (SELECT indisunique FROM pg_index WHERE indexrelid='users_recovery_key_hash_key'::regclass) AS hash_unique"
   V
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb_restore_check -c 'VACUUM FULL users' -c 'ANALYZE users'
   ```
   Expected: both `ok`; `plaintext_col=0 trg=0 fn=0 hash_not_null=t hash_unique=t`; verify prints
   `total=<same as step 5> mismatched=n/a null=0 …`, `exit=0`; `VACUUM` and `ANALYZE` without error.
8. Optional, with a local build pointed at the copy: none needed. The build's statements were rehearsed on PGlite;
   production gets the full smoke test in §4.
9. Clean up. **IRREVERSIBLE** (the copy and the local dump are gone; the R2 dump stays until §6.1):
   ```bash
   unset REHEARSAL_URL
   sudo -u postgres dropdb greenthumb_restore_check
   rm -f /root/m9-rehearsal.dump
   rm -rf /var/www/greenthumb/.m9-staging
   ```

Any failure in 3–7: stop. Production has not been touched.

## 3. Production

Order: upload the new build (the running process keeps the old code in memory) → 008 → verify → start the new
build → smoke → 009 → verify → `VACUUM FULL users` → smoke. The new build needs the 008 columns, so it starts
only after 008. If pm2 restarts the process on its own between the upload and 008, sign-in answers 503 until 008
is in: 503 never makes the KMP app erase a key.

### 3.1 Upload the new build, without 009

1. On the Mac, build the committed tree:
   ```bash
   cd ~/Proj/GreenThumbPWA && npm run build && test -f dist/index.js && git rev-parse HEAD
   ```
2. On the VPS, keep the running build for a rollback:
   ```bash
   cd /var/www/greenthumb && rm -rf dist.prev && cp -a dist dist.prev && cp -a REVISION REVISION.prev
   ```
3. From the Mac, upload the build, the process file, the ops scripts and the migrations **except 009**:
   ```bash
   rsync -az --no-owner --no-group --delete -e 'ssh -o BatchMode=yes' dist/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/dist/
   rsync -az --no-owner --no-group -e 'ssh -o BatchMode=yes' ecosystem.config.cjs package.json package-lock.json <SSH_USER>@<VPS_IP>:/var/www/greenthumb/
   rsync -az --no-owner --no-group --delete -e 'ssh -o BatchMode=yes' scripts/ops/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/scripts/ops/
   rsync -az --no-owner --no-group --delete --exclude '009_*' -e 'ssh -o BatchMode=yes' server/migrations/ <SSH_USER>@<VPS_IP>:/var/www/greenthumb/server/migrations/
   ssh <SSH_USER>@<VPS_IP> 'ls /var/www/greenthumb/server/migrations | tail -2'     # 007_… 008_…, no 009
   ```
   Lockfile: compare `shasum -a 256 package-lock.json` (Mac) with `cat /var/www/greenthumb/.lockfile.sha256`
   (VPS). Different: on the VPS run `npm ci --omit=dev --no-audit --no-fund` and write the new hash into
   `.lockfile.sha256`, as `deploy.sh` does.

### 3.2 Migration 008 (old build still running)

1. Apply 008. **IRREVERSIBLE** (schema change on the live DB; old-build compatible, never rolled back).
   `migrate.mjs` first uploads a pre-migration dump to R2 (it holds plaintext keys; §6.1 deletes it).
   ```bash
   cd /var/www/greenthumb && node --env-file=.env scripts/ops/migrate.mjs
   ```
   Expected: `migrate: pending 008_recovery_key_hash.sql`, `migrate: pre-migration backup …`,
   `migrate: applied 008_recovery_key_hash.sql`. A `pending` line that names 009: stop (the upload of §3.1 step 3
   went wrong); nothing was applied if it failed before `applied`, otherwise go straight on to §3.3 after the verify.
   `55P03` / lock timeout: nothing changed (one transaction). Wait for the next minute inside `:25`–`:50` and run it
   again. Each re-run uploads one more plaintext pre-migration dump: §6.1 deletes all of them anyway.
   Any other failure: do not paste the full output anywhere public (a Postgres message can quote a value); stop.
2. Verify. Read-only. **Gate for everything below.**
   ```bash
   cd /var/www/greenthumb && node scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"
   ```
   Expected: `total=N mismatched=0 null=0 pending=0 pending_malformed=0 pending_is_current=0`, `exit=0`, with `N`
   equal to `total` of the rehearsal give or take the sign-ups since that dump. Anything else: stop. The old build
   keeps working on this schema; roll back the files of §3.1 (§5.1) and investigate.

### 3.3 Start the new build

1. Start from the process file and save. The file sends stdout and stderr to `/dev/null`. pm2 changes log paths
   only when the process is started again, so delete and start instead of `reload` (a few seconds of downtime):
   ```bash
   cd /var/www/greenthumb && pm2 delete greenthumb && pm2 start ecosystem.config.cjs && pm2 save
   pm2 describe greenthumb | grep -E 'status|uptime|restarts'
   pm2 show greenthumb | grep -i 'log path'      # out log path and error log path: /dev/null
   ```
   A log path other than `/dev/null`: stop and find out why before going on.
2. Write the revision and check health:
   ```bash
   echo <revision> > /var/www/greenthumb/REVISION.tmp && mv /var/www/greenthumb/REVISION.tmp /var/www/greenthumb/REVISION
   curl -sS --max-time 30 https://greenthumb.xmpp.site/api/health      # "db":true and "revision":"<revision>"
   ```
3. Run the smoke test of §4.1 (throwaway accounts) and the «Тест Ray» sign-in of §4.3. All as expected, else §5.1.
4. Verify again (§3.2 step 2): still `mismatched=0`. The smoke accounts are deleted by then. Any account created on
   the new build before 009 counts as `mismatched` here, because the 008 trigger filled its plaintext column with a
   random DEFAULT that is not its key; the hash is the issued one. A real sign-up in these minutes explains
   `mismatched` = number of such sign-ups, nothing else does: stop if it is higher.

### 3.4 Migration 009 and VACUUM FULL

1. Upload 009:
   ```bash
   cd ~/Proj/GreenThumbPWA
   rsync -az --no-owner --no-group -e 'ssh -o BatchMode=yes' server/migrations/009_drop_plaintext_recovery_key.sql <SSH_USER>@<VPS_IP>:/var/www/greenthumb/server/migrations/
   ```
2. Apply 009. **IRREVERSIBLE**: the plaintext keys are gone from the live schema; only builds of this commit or
   later run on it. `migrate.mjs` uploads one more pre-migration dump (plaintext keys; §6.1 deletes it).
   ```bash
   cd /var/www/greenthumb && node --env-file=.env scripts/ops/migrate.mjs
   ```
   Expected: `migrate: pending 009_drop_plaintext_recovery_key.sql`, then `migrate: applied 009_…`.
   `009: … users have no recovery_key_hash` or `… must be text`: stop; nothing changed. `55P03`: wait, run again.
   A `cannot drop column … because other objects depend on it` error: nothing changed; stop and decide.
3. Verify (now without a plaintext column):
   ```bash
   cd /var/www/greenthumb && node scripts/ops/verify-recovery-hash.mjs; echo "exit=$?"
   ```
   Expected: `total=N mismatched=n/a null=0 pending=0 pending_malformed=0 pending_is_current=0`, `exit=0`.
4. Rewrite the table so the dropped column's values leave its data pages. **IRREVERSIBLE.** `VACUUM FULL` takes
   an exclusive lock on `users` for its run (seconds for this table); requests that touch `users` wait meanwhile.
   ```bash
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d greenthumb -c 'VACUUM FULL users' -c 'ANALYZE users'
   ```
   What still holds plaintext keys after this: every R2 dump taken before 009 (§6.1), mission-created local dumps
   (§6.1), WAL segments until they are recycled (no archive, check 1a), and old logs (§6.4).
5. Run §4.1 and §4.3 again, then §3.4 step 3 again.

## 4. Smoke tests

### 4.1 Throwaway accounts

From any shell. The keys belong to two accounts that steps 9 and 14 delete. Do not run with `set -x`.

```bash
B=https://greenthumb.xmpp.site
T=$(mktemp -d) && chmod 700 "$T"
J() { curl -sS --max-time 30 -o "$T/body" -w '%{http_code}\n' -H 'content-type: application/json' "$@"; }
F() { node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(eval(process.argv[2]))' "$T/body" "$1"; }

J -c "$T/a" -X POST -d '{"name":"gt-test-m9-smoke"}' "$B/api/auth/create-anonymous"   # 1. 200
F '[typeof o.user.recovery_key, /[0-9a-f]{64}/.test(JSON.stringify(o))]'               # string,false
K1=$(F 'o.user.recovery_key')
J -c "$T/b" -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"     # 2. 200 (second session)
F '[o.user.recovery_key === undefined, /[0-9a-f]{64}/.test(JSON.stringify(o))]'      # true,false
J -b "$T/a" -X POST "$B/api/auth/regenerate-recovery-key"                            # 3. 200
F '[o.user.recovery_key === undefined, typeof o.pending_recovery_key, /[0-9a-f]{64}/.test(JSON.stringify(o))]'   # true,string,false
K2=$(F 'o.pending_recovery_key')
J -b "$T/b" "$B/api/auth/me"                                                          # 4. 200 (sessions intact)
J -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"                # 4. 200 (old key works until confirm)
R=$(node -e 'console.log(require("crypto").randomUUID())')
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$R\"}" "$B/api/auth/confirm-recovery-key"; F 'o.code'      # 4a. 409 not_pending
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/confirm-recovery-key"; F 'o.status'   # 5. 200 committed
J -b "$T/a" -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/confirm-recovery-key"; F 'o.status'   # 6. 200 already_current
J -X POST -d "{\"recoveryKey\":\"$K1\"}" "$B/api/auth/login-recovery"                # 7. 401 (old key dead)
J -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/login-recovery"                # 7. 200
J -b "$T/b" "$B/api/auth/me"                                                          # 8. 401 (second session revoked)
J -b "$T/a" "$B/api/auth/me"                                                          # 8. 200
J -b "$T/a" -X DELETE "$B/api/auth/account"                                           # 9. 200  IRREVERSIBLE (throwaway account)
J -X POST -d "{\"recoveryKey\":\"$K2\"}" "$B/api/auth/login-recovery"                # 9. 401

# Second throwaway account: sign-in with the pending key commits it without a confirm (the KMP path).
J -c "$T/c" -X POST -d '{"name":"gt-test-m9-smoke-2"}' "$B/api/auth/create-anonymous" # 10. 200
L1=$(F 'o.user.recovery_key')
J -b "$T/c" -X POST "$B/api/auth/regenerate-recovery-key"                            # 11. 200
L2=$(F 'o.pending_recovery_key')
J -c "$T/d" -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"     # 12. 200 (pending key, before any confirm)
J -X POST -d "{\"recoveryKey\":\"$L1\"}" "$B/api/auth/login-recovery"                # 13. 401 (old key dead)
J -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"                # 13. 200
J -b "$T/d" -X DELETE "$B/api/auth/account"                                           # 14. 200  IRREVERSIBLE (throwaway account)
J -X POST -d "{\"recoveryKey\":\"$L2\"}" "$B/api/auth/login-recovery"                # 14. 401
J -X POST -d '{"recoveryKey":"not-a-key"}' "$B/api/auth/login-recovery"              # 15. 400
rm -rf "$T"; unset K1 K2 L1 L2 R
```

Any unexpected status: before 009 go to §5.1, after 009 to §5.2.

### 4.2 Where the app logs went

The app keeps no logs now, so a `login-recovery` line cannot be read back. A disagreement between keys and hashes
shows up only in `verify-recovery-hash` (before 009) or as a 401 for a known key (after 009).

### 4.3 The manual test account

From the Mac. Prints the status code only; the key stays in the 600 file.

```bash
node -e '
const { user } = require(process.argv[1]);
fetch("https://greenthumb.xmpp.site/api/auth/login-recovery", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ recoveryKey: user.recovery_key }), signal: AbortSignal.timeout(30000) })
  .then((r) => console.log("Тест Ray login", r.status)).catch((e) => console.log("Тест Ray login failed", e.name));
' ~/.config/greenthumb/manual-test/account.json
```

Expected: `Тест Ray login 200`. A 401 here after 009 is the worst case this runbook guards against: stop and
decide with the owner before anything else; do not touch the phones signed in with that account.

## 5. Rollback

### 5.1 Before 009 (code only; the database stays on 008)

```bash
cd /var/www/greenthumb
rsync -a --delete dist.prev/ dist/
cp -a REVISION.prev REVISION.tmp && mv REVISION.tmp REVISION
pm2 delete greenthumb && pm2 start ecosystem.config.cjs && pm2 save
curl -sS --max-time 30 https://greenthumb.xmpp.site/api/health        # the previous revision
```

Do not drop the 008 columns, index or trigger: the old build ignores the pending column, and its writes of
`recovery_key` go through the trigger, which recomputes the hash and clears any pending key. Two limits:
- An account created on the new build before the rollback has a random plaintext key, so the old build cannot sign
  it in. Only the deleted smoke accounts (and any real sign-up in those minutes) are affected. Such an account
  signs in again as soon as the new build runs.
- A rotation the new build committed wrote only the hash; the old build signs that user in with the plaintext
  column, which still holds the previous key. Avoid rotations on real accounts until 009 is through.

Then remove `server/migrations/009_*` from the VPS if it was uploaded, so no later `migrate.mjs` applies it by
accident.

### 5.2 After 009

There is no schema rollback: the plaintext column is gone, and only builds of this commit or later run on it.
- A bad build: deploy an earlier build that is still at or after this commit, or fix forward.
- Data loss or a broken `users` table: restore the pre-migration dump that `migrate.mjs` uploaded right before 009
  (`pre-migration/` in R2, see `docs/ops/backup-restore.md`), then run `migrate.mjs` again (it re-applies 009). That
  dump holds plaintext keys, so restore it only as a deliberate decision, and keep it only until §6.1 runs.
- Never put a pre-009 build back while the schema is on 009: its create and sign-in name `recovery_key` and fail.

## 6. The rest of the window (after §3.4)

### 6.1 Fresh dump, restore rehearsal, then delete the dumps with plaintext keys

1. Take a fresh backup and rehearse its restore (the usual tools, `docs/ops/backup-restore.md`):
   ```bash
   cd /var/www/greenthumb && node scripts/ops/backup.mjs && node scripts/ops/restore-rehearsal.mjs
   ```
   Both must succeed; the restored copy must have no `recovery_key` column (the rehearsal script drops the copy at
   the end). Else stop: keep the older dumps.
2. **IRREVERSIBLE.** Delete every R2 object in the backups bucket created before 009 was applied (hourly, daily,
   pre-migration, including the two from §3.2 and §3.4), and the mission-created local dumps. List first, with
   names and sizes only; delete only what the list shows as older than the 009 time.

### 6.2 Crontab

`deploy/cron/greenthumb.cron` writes only `<UTC time> check-plants HTTP <code>` to the push log (the response body
lists user ids). Install as in `docs/ops/photos.md`:

```bash
crontab -l > /root/crontab.bak.$(date -u +%Y%m%dT%H%M%SZ)
# copy deploy/cron/greenthumb.cron to /root/greenthumb.cron with scp first
# `|| true`: grep -v exits 1 when no other line is left, and under `set -e` that would install an empty crontab
( crontab -l 2>/dev/null | grep -v -e 'greenthumb' || true ; grep -v '^#' /root/greenthumb.cron | sed '/^$/d' ) > /root/crontab.new
[ "$(grep -c greenthumb /root/crontab.new)" -eq 3 ] || { echo "crontab.new: expected 3 greenthumb lines, not installed"; exit 1; }
crontab /root/crontab.new && rm /root/crontab.new
crontab -l | grep -c greenthumb                                                                 # 3
crontab -l | grep -cF "$(grep '^PUSH_CHECK_API_KEY=' /var/www/greenthumb/.env | cut -d= -f2-)"  # 0
```

After the next `:00`: `tail -2 /var/log/greenthumb-push.log` shows `<UTC time> check-plants HTTP 200`.
Undo: `crontab /root/crontab.bak.<ts>`.

### 6.3 No logs about people (pm2, nginx, logrotate)

Owner's decision: the server keeps no log that can name a user or a device. App lines carry the user id, nginx
lines carry the client IP. The cron ops logs (`/var/log/greenthumb-push.log`, `-backup.log`, `-photo-sweep.log`)
stay: they hold times, HTTP codes and `backup ok/FAILED` only; `/etc/logrotate.d/greenthumb` rotates them weekly.

1. pm2: done in §3.3 step 1 (`ecosystem.config.cjs`: `out_file` and `error_file` are `/dev/null`).
2. logrotate: copy `deploy/logrotate/greenthumb` to `/etc/logrotate.d/greenthumb` (no pm2 entry), then
   `logrotate -d /etc/logrotate.d/greenthumb` (dry run, prints no log content).
3. nginx: `deploy/nginx/greenthumb.conf` sets `access_log off;` and `error_log /dev/null;` in both server blocks,
   and the HSTS header (§6.5). Back up, compare, then install:
   ```bash
   cp -a /etc/nginx/sites-available/greenthumb /root/greenthumb.nginx.bak.$(date -u +%Y%m%dT%H%M%SZ)
   diff /etc/nginx/sites-available/greenthumb /root/greenthumb.conf      # the repo file, copied with scp
   ```
   Only the no-log lines, the two HSTS lines and their comments differ: copy the repo file over, unless §6.5 is
   not cleared yet; then add only the four no-log lines by hand. Anything else differs (certificate paths,
   server-local edits): add the lines by hand. Then `nginx -t && systemctl reload nginx`.
4. Check:
   ```bash
   pm2 show greenthumb | grep -i 'log path'               # both lines: /dev/null
   nginx -T 2>/dev/null | grep -E 'access_log|error_log'
   ls /etc/nginx/sites-enabled                            # greenthumb only
   ```
   Expected from `nginx -T`: `access_log off;` and `error_log /dev/null;` twice each from the greenthumb site.
   Lines from `/etc/nginx/nginx.conf` (http level) also show; they apply only to server blocks that set nothing
   themselves. Only `grep 'log path'` output may be shown: bare `pm2 show` prints env.

### 6.4 Scan the old logs, then delete them

**IRREVERSIBLE.** Run only after §6.3 step 4 passes, else new lines appear at once.

1. Scan. Read-only; prints counts only. After 009 it matches by hash (current and pending):
   ```bash
   cd /var/www/greenthumb && node scripts/ops/scan-logs-for-keys.mjs '/root/.pm2/logs/*' '/var/log/nginx/*'; echo "exit=$?"
   ```
   - `exit=0`: no live key in these logs. Go to step 2.
   - `exit=2`: **STOP.** Live keys are in the logs. The matched accounts must rotate their keys or be deleted
     before the logs go. The owner decides; then scan again.
   - `exit=1`: error (a missing path, a directory in the glob, no DB): fix it, then scan again.
2. Delete:
   ```bash
   pm2 ls                                                       # greenthumb is the only app, else narrow the glob
   du -sh /root/.pm2/logs/*.log* /var/log/nginx/access.log* /var/log/nginx/error.log*   # sizes only; write them down
   pm2 flush
   rm -f /root/.pm2/logs/*.log* /var/log/nginx/access.log* /var/log/nginx/error.log*
   systemctl reload nginx                                       # nginx reopens its files and lets go of the deleted ones
   ls -la /root/.pm2/logs /var/log/nginx
   ```
   Never `cat`, `tail` or `less` these files, before or after: sizes only.

The old VPS `<OLD_VPS_IP>` also holds pm2 and nginx logs from before the cutover. They get the same
scan-then-delete as a separate step.

### 6.5 HSTS

`deploy/nginx/greenthumb.conf` adds `Strict-Transport-Security "max-age=31536000" always` at the 443 server level and
repeats it in `location /photos/` (a location with its own `add_header` drops the inherited ones).

**IRREVERSIBLE** for every browser that sees the header: for one year it refuses plain HTTP and certificate
click-through on `greenthumb.xmpp.site`. A lapsed certificate then locks web users out. Precondition, else stop:
```bash
certbot renew --dry-run --no-random-sleep-on-renew    # must succeed
systemctl is-active certbot.timer                      # active
nginx -T 2>/dev/null | grep -c Strict-Transport-Security   # 0 before; a non-zero count: do not add a second one
```
Then install the repo file as in §6.3 step 3 (or add the two `add_header` lines by hand), `nginx -t && systemctl
reload nginx`, and check both places:
```bash
curl -sI --max-time 30 https://greenthumb.xmpp.site/ | grep -i strict-transport-security
curl -sI --max-time 30 https://greenthumb.xmpp.site/photos/m9-check | grep -i strict-transport-security
```

## 7. Known costs (accepted in the design, not fixed here)

- A pending key has no expiry: a rotation abandoned on the web leaves a second working key until the next
  regenerate or confirm. A stolen session can quietly get a pending key.
- A leaked old key works until the confirm.
- An Expo-app regenerate fails on the client (no `user.recovery_key` in the answer) and leaves a pending key
  behind; the old key keeps working.
- A session upserted right after the commit's `DELETE` can survive it (race in `express-session`).
- The reverse race: a sign-in that arrives with a live cookie while another device commits can lose that sid.
  The next request gets 401, KMP signs in again, and it converges with no loss.
- The key hash is unsalted SHA-256 (it must be a lookup index). The key has 122 random bits, so the hash cannot be
  reversed by guessing; it is still treated as a secret: never logged, never returned.
