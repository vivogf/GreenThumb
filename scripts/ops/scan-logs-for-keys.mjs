#!/usr/bin/env node
// Before old logs are deleted: finds every UUID-shaped string in the given log files (plain or .gz) and counts
// how many are live recovery keys in the DB. Prints counts only (never a key, a hash or an id). Read-only.
// Before 008 it matches users.recovery_key; after 008 users.recovery_key_hash, plus pending_recovery_key_hash.
// Exit 2 when any UUID matches a key (those accounts must rotate or be deleted first), 0 when none, 1 on error.
//   node --env-file=.env scripts/ops/scan-logs-for-keys.mjs '/root/.pm2/logs/*' '/var/log/nginx/*'
import postgres from 'postgres';
import { loadEnvFile, log, requireEnv } from './lib/env.mjs';
import { hashRecoveryKey, scanLogFiles } from './lib/recovery-key-hash.mjs';

const BATCH = 1000;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    log('usage: scan-logs-for-keys.mjs <file or glob>...');
    process.exitCode = 1;
    return;
  }
  loadEnvFile();
  requireEnv('DATABASE_URL');
  const { files, keys } = await scanLogFiles(args);
  const list = [...keys];
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const c = await sql.begin('read only', async (tx) => {
      const cols = new Set((await tx`select attname from pg_attribute where attrelid = 'users'::regclass
        and attname in ('recovery_key_hash', 'pending_recovery_key_hash') and not attisdropped`).map((r) => r.attname));
      const out = {
        by: cols.has('recovery_key_hash') ? 'hash' : 'plaintext',
        current: 0,
        pending: cols.has('pending_recovery_key_hash') ? 0 : null,
      };
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH);
        if (out.by === 'hash') {
          const hashes = tx.array(batch.map(hashRecoveryKey));
          out.current += Number((await tx`select count(*)::int as n from users where recovery_key_hash = any(${hashes}::text[])`)[0].n);
          if (out.pending !== null) {
            out.pending += Number((await tx`select count(*)::int as n from users where pending_recovery_key_hash = any(${hashes}::text[])`)[0].n);
          }
        } else {
          out.current += Number((await tx`select count(*)::int as n from users where recovery_key::text = any(${tx.array(batch)}::text[])`)[0].n);
        }
      }
      return out;
    });
    log(`scan-logs-for-keys: files=${files} uuids=${list.length} match_by=${c.by} matches_current=${c.current}` +
      (c.pending === null ? '' : ` matches_pending=${c.pending}`));
    process.exitCode = c.current + (c.pending ?? 0) > 0 ? 2 : 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (err) {
  // A postgres error message can quote values, and a path error names a file only; the code is enough to act on.
  log(`scan-logs-for-keys FAILED: ${err?.code ?? err?.name ?? 'Error'}`);
  process.exitCode = 1;
}
