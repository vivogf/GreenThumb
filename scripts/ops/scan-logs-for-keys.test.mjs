import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { extractRecoveryKeys, normalizeRecoveryKey, scanLogFiles } from './lib/recovery-key-hash.mjs';
// npm test runs with --import tsx, so the app's TypeScript function is importable here.
import { normalizeRecoveryKey as appNormalize } from '../../server/auth/loginRecovery.ts';

const K = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('the ops normalizer is the app normalizer', () => {
  const inputs = [K, K.toUpperCase(), ` ${K} `, `{${K}}`, K.replace(/-/g, ''), 'not-a-key', '', `${K}0`];
  for (let i = 0; i < 50; i++) inputs.push(randomUUID().toUpperCase());
  for (const x of inputs) assert.equal(normalizeRecoveryKey(x), appNormalize(x), x);
});

test('extractRecoveryKeys finds every hyphenated UUID in any case and canonicalizes it', () => {
  const line = `GET /api/auth/me 200 :: {"user":{"id":7,"recovery_key":"${K.toUpperCase()}"}} again ${K} ` +
    `plant=${randomUUID().replace(/-/g, '')} short=0a1b2c3d-4e5f-4a6b-8c7d broken=x${K}y`;
  const keys = extractRecoveryKeys(line);
  assert.deepEqual(keys, [K, K, K], 'two spellings plus one inside other text; no-hyphen and short forms are not keys');
  assert.deepEqual(extractRecoveryKeys('nothing here'), []);
  assert.deepEqual(extractRecoveryKeys(`a${K}0`), [], 'a longer hex run is not a UUID');
});

test('scanLogFiles reads plain and .gz files and returns the distinct canonical keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-logs-'));
  try {
    const k2 = randomUUID();
    const k3 = randomUUID();
    writeFileSync(join(dir, 'greenthumb-out.log'), `line ${K.toUpperCase()}\r\nline ${k2}\n`);
    writeFileSync(join(dir, 'greenthumb-out.log.1.gz'), gzipSync(`old ${K}\nold ${k3.toUpperCase()}\n`));
    writeFileSync(join(dir, 'access.log'), 'no keys\n');
    const r = await scanLogFiles([join(dir, '*.log*'), join(dir, 'access.log')]);
    assert.equal(r.files, 3, 'a file named twice is scanned once');
    assert.deepEqual([...r.keys].sort(), [K, k2, k3].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanLogFiles refuses a missing path instead of reporting zero keys', async () => {
  await assert.rejects(scanLogFiles([join(tmpdir(), `no-such-${randomUUID()}.log`)]));
});
