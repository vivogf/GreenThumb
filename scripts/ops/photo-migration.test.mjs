import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPhotoMigration } from './lib/photo-migration.mjs';

const BASE = 'https://greenthumb.xmpp.site';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;
const PHOTO_URL = /^https:\/\/greenthumb\.xmpp\.site\/photos\/[0-9a-f-]{36}\.(jpg|png)$/;

function fakeRepo(initial, { onReplace } = {}) {
  const rows = new Map(Object.entries(initial));
  const repo = {
    rows,
    async profile() {
      const v = [...rows.values()];
      return {
        total: v.length,
        data: v.filter((x) => x?.startsWith('data:')).length,
        r2: v.filter((x) => x?.startsWith(`${BASE}/photos/`)).length,
        empty: v.filter((x) => x === '').length,
        null: v.filter((x) => x === null).length,
        other: v.filter((x) => x && !x.startsWith('data:') && !x.startsWith(`${BASE}/photos/`)).length,
      };
    },
    async dataUrlIds() { return [...rows].filter(([, v]) => v?.startsWith('data:')).map(([k]) => k).sort(); },
    async photoUrl(id) { return rows.get(id); },
    async replace(id, oldValue, newValue) {
      onReplace?.(id, rows);
      if (rows.get(id) !== oldValue) return false;
      rows.set(id, newValue);
      return true;
    },
  };
  return repo;
}

function fakeStore() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, mime) { objects.set(key, { bytes, mime }); },
    async delete(key) { objects.delete(key); },
  };
}

const sample = () => ({
  a: dataUrl('image/jpeg', JPEG),
  b: dataUrl('image/png', PNG),
  c: 'data:image/jpeg;base64,!!!broken',
  d: dataUrl('image/png', JPEG), // declared PNG, JPEG bytes
  e: 'https://images.unsplash.com/photo-1',
  f: '',
  g: `${BASE}/photos/00000000-0000-4000-8000-000000000001.jpg`,
});

test('dry run reports counts and changes nothing', async () => {
  const repo = fakeRepo(sample());
  const store = fakeStore();
  const before = new Map(repo.rows);
  const lines = [];
  let backups = 0;
  const r = await runPhotoMigration({ repo, store, publicBaseUrl: BASE, dryRun: true, log: (l) => lines.push(l), beforeWrite: async () => { backups++; } });
  assert.equal(r.toMigrate, 2);
  assert.deepEqual(r.invalid, ['c', 'd']);
  assert.equal(r.skipped, 3);
  assert.deepEqual(repo.rows, before);
  assert.equal(store.objects.size, 0);
  assert.equal(backups, 0);
  assert.ok(lines.some((l) => l.includes('to_migrate=2') && l.includes('invalid_ids=c,d')));
  assert.ok(lines.every((l) => !l.includes('base64')), 'no photo data in output');
});

test('real run uploads valid photos, clears invalid ones, skips the rest', async () => {
  const repo = fakeRepo(sample());
  const store = fakeStore();
  const lines = [];
  let backups = 0;
  const r = await runPhotoMigration({ repo, store, publicBaseUrl: BASE, dryRun: false, log: (l) => lines.push(l), beforeWrite: async () => { backups++; } });
  assert.equal(backups, 1);
  assert.equal(r.migrated, 2);
  assert.deepEqual(r.invalid, ['c', 'd']);
  assert.match(repo.rows.get('a'), PHOTO_URL);
  assert.match(repo.rows.get('b'), PHOTO_URL);
  assert.equal(repo.rows.get('c'), '');
  assert.equal(repo.rows.get('d'), '');
  assert.equal(repo.rows.get('e'), 'https://images.unsplash.com/photo-1');
  assert.equal(repo.rows.get('g'), `${BASE}/photos/00000000-0000-4000-8000-000000000001.jpg`);
  assert.equal(store.objects.size, 2);
  const aKey = 'p/' + repo.rows.get('a').split('/photos/')[1];
  assert.deepEqual(store.objects.get(aKey), { bytes: JPEG, mime: 'image/jpeg' });
  assert.equal(r.after.data, 0);
  assert.equal(r.after.null, 0);
  assert.ok(lines.every((l) => !l.includes('base64')));
});

test('rerun is a no-op: no backup, no upload, no row change', async () => {
  const repo = fakeRepo(sample());
  const store = fakeStore();
  await runPhotoMigration({ repo, store, publicBaseUrl: BASE, dryRun: false, log: () => {}, beforeWrite: async () => {} });
  const rows = new Map(repo.rows);
  const objects = store.objects.size;
  let backups = 0;
  const r = await runPhotoMigration({ repo, store, publicBaseUrl: BASE, dryRun: false, log: () => {}, beforeWrite: async () => { backups++; } });
  assert.equal(r.migrated, 0);
  assert.equal(r.toMigrate, 0);
  assert.deepEqual(r.invalid, []);
  assert.equal(backups, 0);
  assert.deepEqual(repo.rows, rows);
  assert.equal(store.objects.size, objects);
});

test('a row edited during the run keeps the user value and the uploaded object is removed', async () => {
  const repo = fakeRepo({ a: dataUrl('image/jpeg', JPEG) }, {
    onReplace: (id, rows) => rows.set(id, ''),
  });
  const store = fakeStore();
  const r = await runPhotoMigration({ repo, store, publicBaseUrl: BASE, dryRun: false, log: () => {} });
  assert.equal(r.migrated, 0);
  assert.deepEqual(r.changedConcurrently, ['a']);
  assert.equal(repo.rows.get('a'), '');
  assert.equal(store.objects.size, 0);
});
