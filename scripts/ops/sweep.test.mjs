import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MIN_AGE_HOURS, parseSweepArgs, referencedKeySet, selectOrphans, REFERENCE_SOURCES } from './lib/sweep.mjs';

const BASE = 'https://greenthumb.xmpp.site';
const NOW = new Date(Date.UTC(2026, 9, 27, 3, 40));
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n, ext = 'jpg') => `p/${uuid(n)}.${ext}`;
const url = (n, ext = 'jpg') => `${BASE}/photos/${uuid(n)}.${ext}`;

test('only unreferenced keys older than the minimum age are selected', () => {
  const objects = [
    { key: key(1), lastModified: hoursAgo(48) }, // referenced, old
    { key: key(2), lastModified: hoursAgo(48) }, // orphan, old -> selected
    { key: key(3), lastModified: hoursAgo(2) }, // orphan, young
    { key: key(4, 'png'), lastModified: hoursAgo(24) }, // orphan, exactly 24 h -> selected
    { key: key(5, 'webp'), lastModified: hoursAgo(23.99) }, // orphan, just under 24 h
    { key: key(6), lastModified: hoursAgo(1) }, // referenced, young
  ];
  const referenced = referencedKeySet([{ kind: 'url', value: url(1) }, { kind: 'url', value: url(6) }], BASE);
  assert.deepEqual(selectOrphans(objects, referenced, { now: NOW }), [key(2), key(4, 'png')]);
});

test('min age 0 selects every unreferenced key but still no referenced one', () => {
  const objects = [1, 2, 3].map((n) => ({ key: key(n), lastModified: hoursAgo(0) }));
  const referenced = referencedKeySet([{ kind: 'url', value: url(2) }], BASE);
  assert.deepEqual(selectOrphans(objects, referenced, { now: NOW, minAgeHours: 0 }), [key(1), key(3)]);
});

test('default minimum age is 24 hours', () => {
  assert.equal(DEFAULT_MIN_AGE_HOURS, 24);
  const objects = [{ key: key(1), lastModified: hoursAgo(23) }, { key: key(2), lastModified: hoursAgo(25) }];
  assert.deepEqual(selectOrphans(objects, new Set(), { now: NOW }), [key(2)]);
});

test('keys outside the p/<uuid>.<ext> pattern are never selected', () => {
  const old = hoursAgo(1000);
  const objects = [
    { key: 'p/', lastModified: old },
    { key: 'p/not-a-uuid.jpg', lastModified: old },
    { key: `p/${uuid(1)}.gif`, lastModified: old },
    { key: `x/${uuid(1)}.jpg`, lastModified: old },
    { key: `${uuid(1)}.jpg`, lastModified: old },
    { key: 'p/ABCDEF00-0000-4000-8000-00000000000A.jpg', lastModified: old },
  ];
  assert.deepEqual(selectOrphans(objects, new Set(), { now: NOW, minAgeHours: 0 }), []);
});

test('objects without a usable LastModified are never selected', () => {
  const objects = [{ key: key(1) }, { key: key(2), lastModified: new Date('invalid') }, { key: key(3), lastModified: '2020-01-01' }];
  assert.deepEqual(selectOrphans(objects, new Set(), { now: NOW, minAgeHours: 0 }), []);
});

test('plant_photos references (object_key and url) protect objects', () => {
  assert.ok(REFERENCE_SOURCES.some((s) => s.table === 'plants' && s.column === 'photo_url'));
  assert.ok(REFERENCE_SOURCES.some((s) => s.table === 'plant_photos' && s.column === 'object_key'));
  const referenced = referencedKeySet([
    { kind: 'key', value: key(1) },
    { kind: 'url', value: url(2, 'png') },
    { kind: 'key', value: 'not a key' },
  ], BASE);
  assert.deepEqual([...referenced].sort(), [key(1), key(2, 'png')]);
  const objects = [1, 2, 3].map((n) => ({ key: n === 2 ? key(2, 'png') : key(n), lastModified: hoursAgo(100) }));
  assert.deepEqual(selectOrphans(objects, referenced, { now: NOW }), [key(3)]);
});

test('foreign, empty and data: URLs reference nothing; trailing slash on the base is ignored', () => {
  const refs = referencedKeySet([
    { kind: 'url', value: '' },
    { kind: 'url', value: 'data:image/jpeg;base64,AAAA' },
    { kind: 'url', value: `https://images.unsplash.com/photos/${uuid(1)}.jpg` },
    { kind: 'url', value: `${BASE}/photos/${uuid(2)}.jpg?x=1` },
    { kind: 'url', value: url(3) },
  ], `${BASE}/`);
  assert.deepEqual([...refs], [key(3)]);
});

test('output is sorted and stable regardless of input order', () => {
  const objects = [5, 1, 4, 2, 3].map((n) => ({ key: key(n), lastModified: hoursAgo(30) }));
  assert.deepEqual(selectOrphans(objects, new Set(), { now: NOW }), [1, 2, 3, 4, 5].map((n) => key(n)));
});

test('negative or non-numeric minimum age throws', () => {
  assert.throws(() => selectOrphans([], new Set(), { now: NOW, minAgeHours: -1 }));
  assert.throws(() => selectOrphans([], new Set(), { now: NOW, minAgeHours: NaN }));
});

test('argument parsing', () => {
  assert.deepEqual(parseSweepArgs([]), { dryRun: false, minAgeHours: 24 });
  assert.deepEqual(parseSweepArgs(['--dry-run', '--min-age-hours', '0']), { dryRun: true, minAgeHours: 0 });
  assert.deepEqual(parseSweepArgs(['--min-age-hours=1.5']), { dryRun: false, minAgeHours: 1.5 });
  assert.throws(() => parseSweepArgs(['--min-age-hours']));
  assert.throws(() => parseSweepArgs(['--min-age-hours', '-3']));
  assert.throws(() => parseSweepArgs(['--min-age-hours', 'abc']));
  assert.throws(() => parseSweepArgs(['--delete-everything']));
});
