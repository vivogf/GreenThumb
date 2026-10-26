# Cutover: old server → new VPS

Moves `greenthumb.xmpp.site` from the old server `<OLD_VPS_IP>` (app on Neon) to the new VPS
`<VPS_IP>` (app on local Postgres 17). Architecture §4.2 is the source of this plan.

## Timeline

| Event | UTC time | Who |
|---|---|---|
| New VPS prepared (app, nginx, copied cert, `.env` parity, Neon rehearsal) | 2026-10-26 15:08 | infra worker (`m1-vps-prepare`) |
| Pre-flip reboot test of the new VPS (boot at 15:10:33; pm2 `greenthumb` online, Postgres and nginx active after boot) | 2026-10-26 15:09:37 | infra worker |
| DNS A record flipped to `<VPS_IP>` (all five resolvers confirmed at 16:40, zone serial 2026102600) | 2026-10-26, before 16:40 | user |
| Old app stopped (`pm2 stop greenthumb` on `<OLD_VPS_IP>`) | 2026-10-26 16:40:31 | infra worker (`m1-cutover-finalize`) |
| **Cutover timestamp** (final Neon dump restored, new server takes writes) | 2026-10-26 16:41:00 | infra worker (`m1-cutover-finalize`) |
| Fresh Let's Encrypt cert on the new VPS (valid to 2027-01-24) | 2026-10-26 16:41:48 | infra worker |
| GreenThumb retired on the old server (cron commented, pm2 app deleted, site disabled, cert deleted) | 2026-10-26 16:47:15 | infra worker |
| `PUSH_CHECK_API_KEY` rotated on the new VPS only (user-approved; 64 hex from `openssl rand -hex 32`, pm2 reloaded with `--update-env`; backup `.env.bak-pushkey-20261026T173722Z`, mode 600). The old server's rollback `.env` keeps the previous key; the push cron reads the key from `.env` at run time, so a rollback needs no crontab change | 2026-10-26 17:37:22 | infra worker (`m1-pushcheck-key-rotate`) |

Final sync record: Neon and the new DB both had users 66, plants 23, session 290 (288 not expired),
expo_push_subscriptions 7, push_subscriptions 3, fcm_push_subscriptions 0; photo_url profile 15 `data:`,
2 `http(s)`, 6 empty. The dump is `greenthumb-backups/pre-migration/neon-final-2026-10-26T16-40-42Z.dump`
(2 552 443 bytes; local copy `/var/backups/greenthumb/neon-2026-10-26T16-40-42Z.dump`). After the swap,
`migrate.mjs` re-recorded `001_baseline.sql` (a no-op on the Neon schema), taking its own pre-migration backup.

## State before the flip

- New VPS: pm2 app `greenthumb` from `/var/www/greenthumb/ecosystem.config.cjs` on `127.0.0.1:5000`,
  `pm2-root` systemd unit enabled, `pm2 save` done. Postgres on `127.0.0.1:5432`, DB `greenthumb` owned by role
  `greenthumb`.
- nginx site `/etc/nginx/sites-available/greenthumb` (from `deploy/nginx/greenthumb.conf`), symlinked in
  `sites-enabled`. TLS uses the certificate copied from the old server into `/etc/ssl/greenthumb/`
  (mode 600, root only), valid until 2026-12-27.
- `.env` on the new VPS: `SESSION_SECRET PUSH_CHECK_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
  VITE_VAPID_PUBLIC_KEY FIREBASE_SERVICE_ACCOUNT_JSON` equal to the old server (compared by sha256);
  `DATABASE_URL` points to the local Postgres.
- The only GreenThumb cron line on the new VPS is the hourly backup (`17 * * * *`, R2 `greenthumb-backups`).
  The old server still runs the hourly push cron.
- Rehearsal: `scripts/ops/neon-sync.sh` dumped Neon to `/var/backups/greenthumb/neon-<ts>.dump` and restored it.
  Row counts were equal on both sides (users 66, plants 23, session 310, expo_push_subscriptions 7,
  push_subscriptions 3, fcm_push_subscriptions 0); photo_url profile: 15 `data:`, 2 `http(s)`, 6 empty.

Check the new VPS before the flip, from the Mac:

```bash
curl -fsS --resolve greenthumb.xmpp.site:443:<VPS_IP> https://greenthumb.xmpp.site/api/health
bash scripts/deploy.sh --dry-run
```

## Cutover steps

1. **Deploy the latest commit** to the new VPS: `bash scripts/deploy.sh` (clean tree only). Health must report
   the new revision.
2. **User flips DNS** in the DNS provider panel: `A greenthumb.xmpp.site → <VPS_IP>`, TTL 600, no AAAA record.
   Nothing else changes in DNS.
3. **Confirm DNS** from the Mac (the DNS provider name servers are not reachable from it):
   `dig +short @1.1.1.1 greenthumb.xmpp.site A` and `dig +short @8.8.8.8 greenthumb.xmpp.site A` both print
   `<VPS_IP>`.
4. **Freeze writes on the old server**: back up first, then stop only the GreenThumb app.
   ```bash
   ssh <SSH_USER>@<OLD_VPS_IP> 'pm2 stop greenthumb'
   ```
5. **Final data sync** from Neon into the new DB (the URL never reaches argv or a terminal):
   ```bash
   ssh <SSH_USER>@<OLD_VPS_IP> "grep '^DATABASE_URL=' /var/www/greenthumb/.env" \
     | ssh <SSH_USER>@<VPS_IP> 'umask 077; cat > ~/.gt-neon-url'
   ssh <SSH_USER>@<VPS_IP> 'bash /var/www/greenthumb/scripts/ops/neon-sync.sh ~/.gt-neon-url --promote'
   ```
   The script stops and starts the app around the swap, compares per-table row counts and deletes the URL file.
   Upload the produced dump to R2 as `pre-migration/neon-final-<UTC ts>.dump` (architecture §8.1):
   ```bash
   ssh <SSH_USER>@<VPS_IP> 'cd /var/www/greenthumb && D=$(ls -t /var/backups/greenthumb/neon-*.dump | head -1) && \
     node --input-type=module -e "
   import { createReadStream } from \"node:fs\";
   import { Upload } from \"@aws-sdk/lib-storage\";
   import { loadEnvFile } from \"./scripts/ops/lib/env.mjs\";
   import { r2Client, backupsBucket } from \"./scripts/ops/lib/r2.mjs\";
   loadEnvFile(); const c = r2Client();
   const key = \"pre-migration/neon-final-\" + process.argv[1].match(/neon-(.+)\\.dump$/)[1] + \".dump\";
   await new Upload({ client: c, queueSize: 1, partSize: 5 * 1024 * 1024,
     params: { Bucket: backupsBucket(), Key: key, Body: createReadStream(process.argv[1]) } }).done();
   console.log(\"uploaded\", key); c.destroy();" "$D"'
   ```
   Retention keeps the newest 10 objects under `pre-migration/`, so this dump rotates out after 10 later migrations.
   Record the counts and the photo_url profile in the handoff, and write the cutover timestamp above.
   The swap replaces the whole DB, so `schema_migrations` comes back empty: run
   `ssh <SSH_USER>@<VPS_IP> 'cd /var/www/greenthumb && node scripts/ops/migrate.mjs && pm2 reload greenthumb --update-env'`.
6. **Fresh certificate on the new VPS** (DNS now points here, so HTTP-01 works through the
   `/.well-known/acme-challenge/` location):
   ```bash
   ssh <SSH_USER>@<VPS_IP> 'certbot certonly --webroot -w /var/www/certbot -d greenthumb.xmpp.site \
     --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook "systemctl reload nginx"'
   ```
   Then point `ssl_certificate`/`ssl_certificate_key` in the site to
   `/etc/letsencrypt/live/greenthumb.xmpp.site/{fullchain,privkey}.pem`, run `nginx -t`, reload, verify with
   `curl -vI https://greenthumb.xmpp.site` and `certbot renew --dry-run --no-random-sleep-on-renew` (without that flag a
   non-interactive run first sleeps up to 8 minutes). Remove `/etc/ssl/greenthumb/` afterwards.
7. **Enable the push cron on the new VPS** (push `0 * * * *`, log `/var/log/greenthumb-push.log`; the line is in
   `deploy/cron/greenthumb.cron` and reads the API key from `.env` at run time). The backup line
   (`17 * * * *`, see `docs/ops/backup-restore.md`) is already installed.
8. **Retire GreenThumb on the old server** (only these pieces; prosody, coturn, `xmpp.site`,
   `projects.xmpp.site` and their certs stay untouched). Back up each file before editing
   (`cp -a <file> <file>.bak.<UTC ts>`):
   - comment out the GreenThumb line in the root crontab;
   - `pm2 delete greenthumb && pm2 save --force` (plain `pm2 save` skips an empty list and leaves the old app in
     `dump.pm2`);
   - `rm /etc/nginx/sites-enabled/greenthumb` (keep `sites-available/greenthumb`), then
     `nginx -t && systemctl reload nginx`; check that `https://xmpp.site` and `https://projects.xmpp.site` still answer;
   - `certbot delete --cert-name greenthumb.xmpp.site` (only this cert).
   - `/var/www/greenthumb` stays on disk as the rollback copy. Neon stays untouched as a frozen archive.

## Rollback

Use this if the new VPS cannot serve the app after the flip.

1. **DNS back**: the user points the A record `greenthumb.xmpp.site` back to `<OLD_VPS_IP>` (TTL 600).
   Confirm with `dig @1.1.1.1` / `dig @8.8.8.8`.
2. **Re-enable the old nginx site**:
   ```bash
   ssh <SSH_USER>@<OLD_VPS_IP> 'ln -s /etc/nginx/sites-available/greenthumb /etc/nginx/sites-enabled/greenthumb \
     && nginx -t && systemctl reload nginx'
   ```
   If `nginx -t` fails, remove the symlink again at once and reload nothing.
3. **Certificate on the old server**: if step 8 already deleted its GreenThumb certificate, obtain one again once
   DNS points back there: `certbot --nginx -d greenthumb.xmpp.site` (or `certbot certonly --nginx` and restore
   the `ssl_certificate` lines from the `.bak` copy of the site file), then `nginx -t` and reload. Until then the
   site file references a missing cert, so do this before step 2's reload, or keep the symlink off until the cert
   exists.
4. **Start the old app**: `ssh <SSH_USER>@<OLD_VPS_IP> 'cd /var/www/greenthumb && pm2 start ecosystem.config.cjs && pm2 save'`
   (or `pm2 start greenthumb` if it was only stopped). It talks to Neon again.
5. **Cron**: uncomment the GreenThumb line in the old server's root crontab, and comment out / remove the
   GreenThumb lines in the new VPS root crontab, so exactly one server sends reminders.
6. **Data written on the new server after the cutover**: Neon does not have it. Either accept the loss
   (accounts, plants and care data created after the cutover timestamp are gone after rollback), or, with the
   user's approval, take `pg_dump -Fc` of the new DB and restore only the new/changed rows into Neon before
   starting the old app. Mission rules keep Neon read-only, so this write needs an explicit user decision.
   The new VPS DB is never deleted during rollback, so the data stays available for a later merge.

## Notes

- The copied certificate is only a bridge: it expires 2026-12-27 and cannot renew on the new VPS. Step 6 replaces it.
- `/photos/` responses are cached by nginx in `/var/cache/nginx/gt_photos` (max 1 GB, each entry at most 1 day, so a deleted photo leaves the cache within 1 day). To clear the cache:
  `rm -rf /var/cache/nginx/gt_photos/* && systemctl reload nginx`.
- Logs: `/var/log/greenthumb-*.log` and pm2 logs rotate weekly (8 kept) via `/etc/logrotate.d/greenthumb`.
