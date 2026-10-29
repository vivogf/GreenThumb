#!/usr/bin/env node
// Stage-1 check after migration 008, before the new build starts: recomputes every users.recovery_key_hash from
// users.recovery_key with the app's hash and prints counts only (never a key, a hash or an id). Read-only.
// Also counts pending rotations (users.pending_recovery_key_hash, also from 008); pending > 0 alone is normal.
// Exit code 1 when any row is mismatched or has no hash, a pending value is malformed or equals the current
// hash, or on any error.
//   node --env-file=.env scripts/ops/verify-recovery-hash.mjs
import postgres from 'postgres';
import { loadEnvFile, log, requireEnv } from './lib/env.mjs';
import { countRecoveryHashes } from './lib/recovery-key-hash.mjs';

async function main() {
  loadEnvFile();
  requireEnv('DATABASE_URL');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql.begin('read only', (tx) =>
      tx`select recovery_key::text as recovery_key, recovery_key_hash, pending_recovery_key_hash from users`);
    const c = countRecoveryHashes(rows);
    log(`verify-recovery-hash: total=${c.total} mismatched=${c.mismatched} null=${c.null} ` +
      `pending=${c.pending} pending_malformed=${c.pending_malformed} pending_is_current=${c.pending_is_current}`);
    if (c.mismatched > 0 || c.null > 0 || c.pending_malformed > 0 || c.pending_is_current > 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (err) {
  // A postgres error message can quote values; the code is enough to act on.
  log(`verify-recovery-hash FAILED: ${err?.code ?? err?.name ?? 'Error'}`);
  process.exitCode = 1;
}
