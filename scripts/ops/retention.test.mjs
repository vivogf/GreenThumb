import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectForDeletion, newestKey, keyTimestamp, RETENTION_LIMITS } from './lib/retention.mjs';

const pad = (n) => String(n).padStart(2, '0');
const hourlyKey = (i) => {
  const d = new Date(Date.UTC(2026, 9, 1) + i * 3600_000);
  return `hourly/greenthumb-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}1703Z.dump`;
};
const dailyKey = (i) => {
  const d = new Date(Date.UTC(2026, 8, 1) + i * 86400_000);
  return `daily/greenthumb-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.dump`;
};
const preKey = (i) => {
  const d = new Date(Date.UTC(2026, 9, 1) + i * 86400_000 + 37_000);
  return `pre-migration/greenthumb-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}0037Z.dump`;
};
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function shuffle(list, seed = 7) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('limits are 48 hourly, 14 daily, 10 pre-migration', () => {
  assert.deepEqual({ ...RETENTION_LIMITS }, { 'hourly/': 48, 'daily/': 14, 'pre-migration/': 10 });
});

test('50 hourly keys: the 2 oldest are deleted, newest 48 kept', () => {
  const keys = range(50, hourlyKey);
  assert.deepEqual(selectForDeletion(keys), [keys[0], keys[1]]);
});

test('15 daily keys: the oldest is deleted', () => {
  const keys = range(15, dailyKey);
  assert.deepEqual(selectForDeletion(keys), [keys[0]]);
});

test('12 pre-migration keys: the 2 oldest are deleted', () => {
  const keys = range(12, preKey);
  assert.deepEqual(selectForDeletion(keys), [keys[0], keys[1]]);
});

test('counts at or below the limit delete nothing', () => {
  const keys = [...range(48, hourlyKey), ...range(14, dailyKey), ...range(10, preKey)];
  assert.deepEqual(selectForDeletion(keys), []);
  assert.deepEqual(selectForDeletion([]), []);
  assert.deepEqual(selectForDeletion(range(3, hourlyKey)), []);
});

test('keys in one prefix never cause deletions in another prefix', () => {
  const hourly = range(60, hourlyKey);
  const daily = range(5, dailyKey);
  const pre = range(3, preKey);
  const doomed = selectForDeletion([...hourly, ...daily, ...pre, 'other/x.dump', 'stray.dump']);
  assert.equal(doomed.length, 12);
  assert.ok(doomed.every((k) => k.startsWith('hourly/')));
  assert.deepEqual(doomed, hourly.slice(0, 12));
});

test('shuffled input gives the same result as sorted input', () => {
  const keys = [...range(55, hourlyKey), ...range(20, dailyKey), ...range(13, preKey)];
  const expected = selectForDeletion(keys);
  assert.equal(expected.length, 7 + 6 + 3);
  for (const seed of [1, 7, 42, 1234]) {
    assert.deepEqual(selectForDeletion(shuffle(keys, seed)), expected);
    assert.deepEqual(selectForDeletion(shuffle(keys, seed).reverse()), expected);
  }
});

test('keys without a timestamp fall back to LastModified', () => {
  const objs = range(12, (i) => ({
    key: `pre-migration/manual-${String.fromCharCode(97 + ((i * 5) % 12))}.dump`,
    lastModified: new Date(Date.UTC(2026, 9, 1, i)),
  }));
  assert.deepEqual(selectForDeletion(shuffle(objs)), [objs[0].key, objs[1].key].sort());
});

test('neon-final dashed timestamps sort with compact ones', () => {
  const keys = [...range(10, preKey), 'pre-migration/neon-final-2026-09-01T10-00-00Z.dump'];
  assert.deepEqual(selectForDeletion(keys), ['pre-migration/neon-final-2026-09-01T10-00-00Z.dump']);
});

test('newestKey picks by timestamp, not input order', () => {
  const keys = shuffle(range(30, hourlyKey));
  assert.equal(newestKey(keys, 'hourly/'), hourlyKey(29));
  assert.equal(newestKey(keys, 'daily/'), null);
  assert.equal(keyTimestamp('daily/greenthumb-20261026.dump'), Date.UTC(2026, 9, 26));
  assert.equal(keyTimestamp('hourly/greenthumb-20261026T151703Z.dump'), Date.UTC(2026, 9, 26, 15, 17, 3));
});
