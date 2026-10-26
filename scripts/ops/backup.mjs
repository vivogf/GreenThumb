#!/usr/bin/env node
// Hourly database backup to R2 (greenthumb-backups). Run from cron through `flock -n`:
//   node scripts/ops/backup.mjs                  -> hourly/greenthumb-<ts>.dump (+ daily/ copy, retention)
//   node scripts/ops/backup.mjs pre-migration    -> pre-migration/greenthumb-<ts>.dump (+ retention)
// Credentials: DATABASE_URL and R2_* from the environment or /var/www/greenthumb/.env; pg_dump gets libpq env vars.
import { loadEnvFile, log } from './lib/env.mjs';
import { runBackup } from './lib/backup-job.mjs';

const tag = process.argv[2] ?? 'hourly';
try {
  loadEnvFile();
  const r = await runBackup({ tag });
  log(`backup ok tag=${tag} key=${r.key} bytes=${r.bytes} seconds=${r.seconds}`);
} catch (err) {
  log(`backup FAILED tag=${tag}: ${err?.message ?? err}`);
  process.exitCode = 1;
}
