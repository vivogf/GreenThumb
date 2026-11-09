# Photos in R2: migration and orphan sweep

Plant photos live in the private R2 bucket `<R2_PHOTO_BUCKET>` under `p/<uuid>.<ext>` and are served by
`GET /photos/<uuid>.<ext>` (architecture §2.5). The database keeps only the https URL in `plants.photo_url`
(`""` means no photo).

Placeholders such as `<VPS_IP>`, `<OLD_VPS_IP>`, `<SSH_USER>`, `<R2_BACKUP_BUCKET>` and `<R2_PHOTO_BUCKET>` stand for
values kept out of git in `~/.config/greenthumb/ops.env` (mode 600) on the operator's Mac.

## One-off migration of legacy base64 photos

`scripts/ops/migrate-photos.mjs` moves every `plants.photo_url` that starts with `data:` to R2.

```bash
cd /var/www/greenthumb
node scripts/ops/migrate-photos.mjs --dry-run   # counts only: to_migrate, invalid (with plant ids), skipped
node scripts/ops/migrate-photos.mjs             # real run
```

- The real run first takes a `pre-migration/` database backup (only when there is something to change).
- Each valid row: decode (JPEG/PNG/WebP, magic bytes, at most 5 MiB) → upload `p/<uuid>.<ext>` → update the row
  with a compare-and-set on the old value. If the row changed meanwhile, the user value stays and the uploaded
  object is deleted again.
- A data URL that fails to decode or has a wrong type/size becomes `""`; the output lists those plant ids.
- Rows that are not `data:` URLs are skipped, so a rerun changes nothing and takes no backup.
- Output has counts, plant ids and keys only, never photo data.

Rollback: restore the `pre-migration/` dump the run printed (see `backup-restore.md`). The uploaded objects
stay in R2 and the next sweep removes them once nothing references them.

## Daily orphan sweep

`scripts/ops/sweep-photos.mjs` lists R2 `p/` objects and deletes those that no DB row references and whose
LastModified is at least `--min-age-hours` (default 24) old. The age guard keeps uploads whose DB update has not
committed yet. Keys that do not match `p/<uuid>.<jpg|png|webp>` are never touched.

References come from `REFERENCE_SOURCES` in `scripts/ops/lib/sweep.mjs`: `plants.photo_url`, and
`plant_photos.object_key` / `plant_photos.url`. A table that does not exist yet (`plant_photos` before M4) is
skipped; any other query error stops the sweep before it deletes anything. The selection is the pure function
`selectOrphans`, tested by `scripts/ops/sweep.test.mjs`.

```bash
cd /var/www/greenthumb
node scripts/ops/sweep-photos.mjs --dry-run --min-age-hours 0   # list every unreferenced object, delete nothing
node scripts/ops/sweep-photos.mjs --dry-run                      # what tonight's run would delete
```

Log: `/var/log/greenthumb-photo-sweep.log` (logrotate weekly, 8 kept, `/etc/logrotate.d/greenthumb`). Each run
writes `sweep start`, `objects=N referenced=M candidates=K keys=…` and `sweep done deleted=K` or `sweep FAILED …`.

nginx may still serve a deleted photo from `/var/cache/nginx/gt_photos` for up to 1 day.

## Install or update the cron lines

All GreenThumb lines are in `deploy/cron/greenthumb.cron`. Replace the GreenThumb lines of the root crontab and
keep every other line:

```bash
( crontab -l 2>/dev/null | grep -v -e 'greenthumb' ; grep -v '^#' /root/greenthumb.cron | sed '/^$/d' ) | crontab -
```

(`/root/greenthumb.cron` is the repo file copied over with `scp`.) Check that no key is stored literally:
`crontab -l | grep -cF "$(grep '^PUSH_CHECK_API_KEY=' /var/www/greenthumb/.env | cut -d= -f2-)"` prints `0`.
