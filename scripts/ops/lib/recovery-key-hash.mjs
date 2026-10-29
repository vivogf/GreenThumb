// Recovery-key hash for ops scripts; the same function as hashRecoveryKey in server/auth/recoveryKey.ts
// (scripts/ops/recovery-key-hash.test.mjs checks they agree). A copy because server/ is not uploaded to the
// VPS and tsx is a dev dependency, as with lib/photo-keys.mjs.
import { createHash } from 'node:crypto';
// fs.globSync is read at call time (Node 22+), so verify-recovery-hash.mjs still loads on an older Node.
import fs, { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

/** hex(SHA-256(UTF-8 bytes of the canonical lowercase key)). */
export function hashRecoveryKey(canonicalKey) {
  return createHash('sha256').update(canonicalKey, 'utf8').digest('hex');
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * Counts only: rows, rows whose stored hash differs from the recomputed one, rows without a hash;
 * rows with a pending rotation, pending values of the wrong shape, pending values equal to the row's
 * own current hash (a commit that did not clear pending).
 * plaintext: false = after migration 009 there is no key to recompute from, so mismatched is null.
 */
export function countRecoveryHashes(rows, { plaintext = true } = {}) {
  let total = 0;
  let mismatched = 0;
  let missing = 0;
  let pending = 0;
  let pendingMalformed = 0;
  let pendingIsCurrent = 0;
  for (const row of rows) {
    total += 1;
    if (row.recovery_key_hash == null) missing += 1;
    else if (plaintext && row.recovery_key_hash !== hashRecoveryKey(row.recovery_key)) mismatched += 1;
    const p = row.pending_recovery_key_hash;
    if (p != null) {
      pending += 1;
      if (!HASH.test(p)) pendingMalformed += 1;
      else if (p === row.recovery_key_hash) pendingIsCurrent += 1;
    }
  }
  return {
    total, mismatched: plaintext ? mismatched : null, null: missing,
    pending, pending_malformed: pendingMalformed, pending_is_current: pendingIsCurrent,
  };
}

/** Same as normalizeRecoveryKey in server/auth/loginRecovery.ts (the scan test checks they agree). */
export function normalizeRecoveryKey(raw) {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
  if (!/^[0-9a-f]{4}(-?[0-9a-f]{4}){7}$/i.test(inner)) return null;
  const hex = inner.replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_IN_TEXT = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

/** Every hyphenated UUID in the text (any case), canonical lowercase, in order, duplicates kept. */
export function extractRecoveryKeys(text) {
  return (text.match(UUID_IN_TEXT) ?? []).map((m) => normalizeRecoveryKey(m));
}

/**
 * Reads the given files (paths or globs; `.gz` is gunzipped) line by line as streams.
 * Returns { files, keys }: the number of distinct files read and the Set of distinct canonical keys.
 * A missing path or anything that is not a regular file rejects, so a typo never looks like "no keys".
 */
export async function scanLogFiles(args) {
  const paths = new Set();
  for (const arg of args) {
    const found = /[*?[]/.test(arg) ? fs.globSync(arg).sort() : [arg];
    for (const p of found) paths.add(resolve(p));
  }
  const keys = new Set();
  for (const p of paths) {
    if (!statSync(p).isFile()) throw new Error(`not a regular file: ${p}`);
    const raw = createReadStream(p);
    const input = p.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
    raw.on('error', (err) => input.destroy(err));
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      for (const k of extractRecoveryKeys(line)) keys.add(k);
    }
  }
  return { files: paths.size, keys };
}
