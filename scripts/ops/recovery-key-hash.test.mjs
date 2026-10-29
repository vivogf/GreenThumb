import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { countRecoveryHashes, hashRecoveryKey } from './lib/recovery-key-hash.mjs';
// npm test runs with --import tsx, so the app's TypeScript function is importable here.
import { hashRecoveryKey as appHash } from '../../server/auth/recoveryKey.ts';

const GOLDEN = '00000000-0000-4000-8000-000000000000';

test('the ops hash is the app hash (golden and random keys)', () => {
  assert.equal(hashRecoveryKey(GOLDEN), 'db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98');
  for (let i = 0; i < 200; i++) {
    const key = randomUUID();
    assert.equal(hashRecoveryKey(key), appHash(key));
  }
});

test('countRecoveryHashes counts totals, mismatches and nulls and returns nothing else', () => {
  const ok = randomUUID();
  const wrong = randomUUID();
  const missing = randomUUID();
  const counts = countRecoveryHashes([
    { id: 1, recovery_key: ok, recovery_key_hash: appHash(ok) },
    { id: 2, recovery_key: wrong, recovery_key_hash: appHash(ok) },
    { id: 3, recovery_key: missing, recovery_key_hash: null },
  ]);
  assert.deepEqual(counts, { total: 3, mismatched: 1, null: 1, pending: 0, pending_malformed: 0, pending_is_current: 0 });
  assert.deepEqual(countRecoveryHashes([]), { total: 0, mismatched: 0, null: 0, pending: 0, pending_malformed: 0, pending_is_current: 0 });
});

test('countRecoveryHashes counts pending rotations (counts only, never a value)', () => {
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  const d = randomUUID();
  const counts = countRecoveryHashes([
    { recovery_key: a, recovery_key_hash: appHash(a), pending_recovery_key_hash: appHash(randomUUID()) },
    { recovery_key: b, recovery_key_hash: appHash(b), pending_recovery_key_hash: 'NOT-HEX' },
    { recovery_key: c, recovery_key_hash: appHash(c), pending_recovery_key_hash: appHash(c) },
    { recovery_key: d, recovery_key_hash: appHash(d), pending_recovery_key_hash: null },
  ]);
  assert.deepEqual(counts, { total: 4, mismatched: 0, null: 0, pending: 3, pending_malformed: 1, pending_is_current: 1 });
  for (const v of Object.values(counts)) assert.equal(typeof v, 'number');
});

test('after migration 009 (no plaintext column) mismatched is not computed; null and pending still are', () => {
  const a = randomUUID();
  const counts = countRecoveryHashes([
    { recovery_key_hash: appHash(a), pending_recovery_key_hash: null },
    { recovery_key_hash: appHash(randomUUID()), pending_recovery_key_hash: 'NOT-HEX' },
    { recovery_key_hash: null, pending_recovery_key_hash: null },
  ], { plaintext: false });
  assert.deepEqual(counts, { total: 3, mismatched: null, null: 1, pending: 1, pending_malformed: 1, pending_is_current: 0 });
});
