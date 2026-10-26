#!/usr/bin/env node
// One-off: move legacy base64 photos (plants.photo_url `data:...`) to R2 `p/<uuid>.<ext>`.
//   node scripts/ops/migrate-photos.mjs --dry-run   counts only, changes nothing
//   node scripts/ops/migrate-photos.mjs             pre-migration DB backup, then upload + update each row
// A data URL that fails to decode or has a wrong type/size becomes "" and is reported by plant id.
// Rows that are not data URLs are skipped, so a rerun is a no-op. Output never contains photo data.
import postgres from 'postgres';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadEnvFile, log, requireEnv } from './lib/env.mjs';
import { r2Client } from './lib/r2.mjs';
import { runBackup } from './lib/backup-job.mjs';
import { plantsRepo, runPhotoMigration } from './lib/photo-migration.mjs';

const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--dry-run');
  if (unknown.length) throw new Error(`unknown argument: ${unknown.join(' ')}`);
  const dryRun = args.includes('--dry-run');

  loadEnvFile();
  requireEnv('DATABASE_URL', 'R2_BUCKET_PHOTOS', 'PHOTO_PUBLIC_BASE_URL');
  const bucket = process.env.R2_BUCKET_PHOTOS;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const client = dryRun ? null : r2Client();
  const store = client && {
    put: (key, bytes, mime) => client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: PHOTO_CACHE_CONTROL,
    })),
    delete: (key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  };
  try {
    log(`migrate-photos start${dryRun ? ' (dry run)' : ''}`);
    await runPhotoMigration({
      repo: plantsRepo(sql),
      store,
      publicBaseUrl: process.env.PHOTO_PUBLIC_BASE_URL,
      dryRun,
      log,
      beforeWrite: async () => {
        const b = await runBackup({ tag: 'pre-migration' });
        log(`pre-migration backup ${b.key} bytes=${b.bytes}`);
      },
    });
  } finally {
    client?.destroy();
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (err) {
  log(`migrate-photos FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
}
