#!/usr/bin/env node
// Daily orphan sweep of R2 photo objects (cron 40 3 * * *).
//   node scripts/ops/sweep-photos.mjs [--dry-run] [--min-age-hours N]   (default 24)
// Deletes `p/<uuid>.<ext>` objects older than N hours that no DB row references (plants.photo_url, and
// plant_photos once that table exists). Logs counts and keys only.
import postgres from 'postgres';
import { loadEnvFile, log, requireEnv } from './lib/env.mjs';
import { deleteKeys, listObjects, r2Client } from './lib/r2.mjs';
import { PHOTO_KEY_PREFIX } from './lib/photo-keys.mjs';
import { loadReferenceRows, parseSweepArgs, referencedKeySet, selectOrphans } from './lib/sweep.mjs';

async function main() {
  const { dryRun, minAgeHours } = parseSweepArgs(process.argv.slice(2));
  loadEnvFile();
  requireEnv('DATABASE_URL', 'R2_BUCKET_PHOTOS', 'PHOTO_PUBLIC_BASE_URL');
  const bucket = process.env.R2_BUCKET_PHOTOS;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const client = r2Client();
  try {
    log(`sweep start${dryRun ? ' (dry run)' : ''} min_age_hours=${minAgeHours}`);
    // List first, then read references: an upload that commits in between is referenced, never an orphan.
    const objects = await listObjects(client, bucket, PHOTO_KEY_PREFIX);
    const referenced = referencedKeySet(await loadReferenceRows(sql), process.env.PHOTO_PUBLIC_BASE_URL);
    const orphans = selectOrphans(objects, referenced, { now: new Date(), minAgeHours });
    log(`objects=${objects.length} referenced=${referenced.size} candidates=${orphans.length}${orphans.length ? ` keys=${orphans.join(',')}` : ''}`);
    if (dryRun) {
      log('dry run: nothing deleted');
      return;
    }
    await deleteKeys(client, bucket, orphans);
    log(`sweep done deleted=${orphans.length}`);
  } finally {
    client.destroy();
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (err) {
  log(`sweep FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
}
