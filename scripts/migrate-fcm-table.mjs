#!/usr/bin/env node
/**
 * Idempotent DDL migration: creates the fcm_push_subscriptions table.
 *
 * Drizzle-kit push is FORBIDDEN on this project (it offers to drop the
 * connect-pg-simple `session` table, which is not in shared/schema.ts) — new
 * tables are always created with this kind of manual script. Run by the user
 * on the VPS after `git pull`, BEFORE `pm2 restart greenthumb`:
 *
 *   node scripts/migrate-fcm-table.mjs
 *
 * Reads DATABASE_URL from /var/www/greenthumb/.env (or the process env).
 * Safe to run multiple times (CREATE TABLE IF NOT EXISTS + DO-block index).
 * Touches NOTHING else: no data changes, no drops, no drizzle-kit.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const DB_URL_PREFIX = 'DATABASE_URL=';

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // PM2/production layout: .env next to the repo root.
  for (const p of ['.env', '/var/www/greenthumb/.env']) {
    try {
      const raw = readFileSync(p, 'utf8');
      const line = raw
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(DB_URL_PREFIX));
      if (line) return line.slice(DB_URL_PREFIX.length).trim();
    } catch {
      // No file at this path — try the next one.
    }
  }
  return null;
}

async function main() {
  const url = readDatabaseUrl();
  if (!url) {
    console.error('FAIL: DATABASE_URL not found (set it in the environment or in /var/www/greenthumb/.env)');
    process.exit(1);
  }

  const sql = postgres(url);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS fcm_push_subscriptions (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        fcm_token text NOT NULL,
        platform text NOT NULL DEFAULT 'android',
        language text NOT NULL DEFAULT 'ru',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;
    // Partial unique index: guarantees one subscription per user at the DB
    // level, matching the delete+insert upsert the endpoints use.
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'fcm_push_subscriptions'
            AND indexname = 'fcm_push_subscriptions_user_id_key'
        ) THEN
          CREATE UNIQUE INDEX fcm_push_subscriptions_user_id_key
            ON fcm_push_subscriptions (user_id)
            WHERE user_id IS NOT NULL;
        END IF;
      END
      $$
    `;
    console.log('OK migration: fcm_push_subscriptions is present');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
