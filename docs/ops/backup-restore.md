# Backups and restore

Database backups of the new VPS `<VPS_IP>` go to the private Cloudflare R2 bucket `<R2_BACKUP_BUCKET>`
(EU jurisdiction). Architecture §2.3 and §2.6 are the source of this plan.

Placeholders such as `<VPS_IP>`, `<OLD_VPS_IP>`, `<SSH_USER>`, `<R2_BACKUP_BUCKET>` and `<R2_PHOTO_BUCKET>` stand for
values kept out of git in `~/.config/greenthumb/ops.env` (mode 600) on the operator's Mac.

## What runs

| Piece | Where | What it does |
|---|---|---|
| `scripts/ops/backup.mjs` | cron, root, `17 * * * *` | `pg_dump -Fc` streamed into R2 `hourly/greenthumb-YYYYMMDDTHHMMSSZ.dump`; the first backup of each UTC day is copied to `daily/greenthumb-YYYYMMDD.dump`; then retention runs |
| `scripts/ops/backup.mjs pre-migration` | called by `migrate.mjs` | same dump under `pre-migration/greenthumb-YYYYMMDDTHHMMSSZ.dump` |
| `scripts/ops/migrate.mjs` | `scripts/deploy.sh` | applies pending `server/migrations/NNN_*.sql`, after a pre-migration dump |
| `scripts/ops/restore-rehearsal.mjs` | by hand | restores the newest hourly dump into a temporary DB and compares row counts |
| `/var/log/greenthumb-backup.log` | logrotate weekly, 8 kept | one line per step, a final `backup ok …` or `backup FAILED …` |

Crontab line (also in `deploy/cron/greenthumb.cron`):

```
17 * * * * cd /var/www/greenthumb && flock -n /var/lock/greenthumb-backup.lock node scripts/ops/backup.mjs >> /var/log/greenthumb-backup.log 2>&1
```

`flock -n` skips a run while the previous one still holds the lock. For a manual run, wait for the lock instead:

```bash
cd /var/www/greenthumb && flock -w 900 /var/lock/greenthumb-backup.lock node scripts/ops/backup.mjs
```

### Retention

Retention runs after every successful backup and keeps the newest objects per prefix:

| Prefix | Kept |
|---|---|
| `hourly/` | 48 |
| `daily/` | 14 |
| `pre-migration/` | 10 |

"Newest" is the UTC timestamp in the key (LastModified when the key has none). The selection is the pure
function `selectForDeletion` in `scripts/ops/lib/retention.mjs`, tested by `scripts/ops/retention.test.mjs`.
A failed `pg_dump` uploads nothing and deletes nothing: the upload stream ends only after `pg_dump` exits 0,
otherwise the multipart upload is aborted.

### Credentials

- The scripts read `DATABASE_URL` and `R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_BACKUPS` from
  the process environment or from `/var/www/greenthumb/.env` (mode 600). An environment value wins over the file.
- `pg_dump` receives the connection as libpq variables (`PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE`), never as
  arguments. `psql`, `createdb`, `dropdb` and `pg_restore` in the rehearsal run as OS user `postgres` with local
  peer auth, so they need no password at all.
- Log lines pass through a redactor; they never contain the connection string, the DB password or R2 keys.

## List backups

On the VPS (the R2 keys stay in the process):

```bash
cd /var/www/greenthumb && node --input-type=module -e "
import { loadEnvFile } from './scripts/ops/lib/env.mjs';
import { r2Client, backupsBucket, listObjects } from './scripts/ops/lib/r2.mjs';
loadEnvFile(); const c = r2Client();
for (const p of ['hourly/', 'daily/', 'pre-migration/']) {
  const objs = await listObjects(c, backupsBucket(), p);
  console.log(p, objs.length);
  for (const o of objs) console.log(' ', o.key, o.size, o.lastModified.toISOString());
}
c.destroy();"
```

## Download one backup

```bash
cd /var/www/greenthumb && umask 077 && node --input-type=module -e "
import { loadEnvFile } from './scripts/ops/lib/env.mjs';
import { r2Client, backupsBucket, downloadObject } from './scripts/ops/lib/r2.mjs';
loadEnvFile(); const c = r2Client();
await downloadObject(c, backupsBucket(), process.argv[1], '/root/restore.dump'); c.destroy();" \
  hourly/greenthumb-20261026T151703Z.dump
pg_restore --list /root/restore.dump | grep 'TABLE DATA'   # structure check
```

Dumps contain recovery keys. Keep downloaded files in `/root` (mode 600) and delete them when done.

## Run the restore rehearsal

```bash
cd /var/www/greenthumb && node scripts/ops/restore-rehearsal.mjs
```

It prints the `hourly/` key it used, restores it into `greenthumb_restore_check` with
`pg_restore --no-owner --no-acl --role=greenthumb --single-transaction` (never `--create`), prints a table of row
counts (restored vs live; `session` may drift), drops the temporary DB and removes its work dir in `/tmp`.
Exit code 0 means all counts match. Take a fresh manual backup right before it for an exact comparison.

## Restore into the live DB

Use this only to recover from data loss. It replaces the live database `greenthumb`.

1. Download the chosen dump to `/root/restore.dump` (see above) and check it with `pg_restore --list`.
2. Take a backup of the current state first, even if it is broken:
   `cd /var/www/greenthumb && flock -w 900 /var/lock/greenthumb-backup.lock node scripts/ops/backup.mjs pre-migration`
3. Stop the app and the backup cron for the duration: `pm2 stop greenthumb`, comment the backup line with `crontab -e`.
4. Restore into a fresh DB, then swap names (the old DB stays as `greenthumb_before_restore` until you drop it):
   ```bash
   sudo -u postgres dropdb --if-exists greenthumb_incoming
   sudo -u postgres createdb -O greenthumb greenthumb_incoming
   sudo -u postgres pg_restore --no-owner --no-acl --role=greenthumb --exit-on-error --single-transaction \
     -d greenthumb_incoming < /root/restore.dump
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
   select pg_terminate_backend(pid) from pg_stat_activity where datname = 'greenthumb' and pid <> pg_backend_pid();
   alter database greenthumb rename to greenthumb_before_restore;
   alter database greenthumb_incoming rename to greenthumb;
   SQL
   ```
5. Start the app: `pm2 start greenthumb`; check `curl -fsS http://127.0.0.1:5000/api/health` shows `"db":true`.
6. Re-enable the backup cron line. After you have checked the data, drop the old copy:
   `sudo -u postgres dropdb greenthumb_before_restore`. Delete `/root/restore.dump`.

Do not use `pg_restore --create`: it can restore into the database name stored in the archive instead of the
target you named.

## Roll back a migration

Every `migrate.mjs` run that has pending files first writes `pre-migration/greenthumb-<ts>.dump`, then applies each
file in its own transaction and records it in `schema_migrations(name, applied_at)`.

1. A failed migration file rolls back by itself (one transaction per file); fix the file and deploy again.
2. To undo a migration that was applied: find the dump taken just before it. Its timestamp is a little earlier
   than the `applied_at` of the batch:
   `sudo -u postgres psql -X -d greenthumb -Atc "select name, applied_at from schema_migrations order by name"`
3. Deploy the previous commit (without the migration file), or keep the app stopped.
4. Restore that `pre-migration/` dump into the live DB with the steps above. The restored DB has the old
   `schema_migrations` rows, so the migration counts as pending again if its file comes back.
5. Writes made between the migration and the rollback are lost unless you copy them over by hand from
   `greenthumb_before_restore`.

## Install or update the cron line

```bash
LINE='17 * * * * cd /var/www/greenthumb && flock -n /var/lock/greenthumb-backup.lock node scripts/ops/backup.mjs >> /var/log/greenthumb-backup.log 2>&1'
( crontab -l 2>/dev/null | grep -v 'scripts/ops/backup.mjs'; echo "$LINE" ) | crontab -
```
