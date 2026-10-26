#!/usr/bin/env node
// Applies pending server/migrations/NNN_name.sql files. Before the first pending file it takes a pre-migration
// backup (greenthumb-backups/pre-migration/); each file runs in its own transaction together with its
// schema_migrations row. Nothing pending -> no backup, no change. Never use drizzle-kit push.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { APP_ROOT, loadEnvFile, log, requireEnv } from './lib/env.mjs';
import { runBackup } from './lib/backup-job.mjs';

const MIGRATIONS_DIR = join(APP_ROOT, 'server', 'migrations');
const NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

async function main() {
  loadEnvFile();
  requireEnv('DATABASE_URL');
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const badNames = files.filter((f) => !NAME.test(f));
  if (badNames.length) throw new Error(`bad migration file names: ${badNames.join(', ')}`);

  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
    const unknown = [...applied].filter((n) => !files.includes(n));
    if (unknown.length) log(`warning: applied migrations without a file: ${unknown.join(', ')}`);
    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) {
      log(`migrate: nothing pending (${applied.size} applied)`);
      return;
    }
    log(`migrate: pending ${pending.join(', ')}`);
    const backup = await runBackup({ tag: 'pre-migration' });
    log(`migrate: pre-migration backup ${backup.key} bytes=${backup.bytes}`);
    for (const file of pending) {
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      log(`migrate: applied ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (err) {
  log(`migrate FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
}
