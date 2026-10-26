import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePhotoChange, preparePhotoChange, removePhotoObjects, type PhotoObjectStore } from "./photoChange";

const BASE = "https://greenthumb.xmpp.site";
const UUID = "3f0c8a52-7b1e-4c2d-9a6f-1e2d3c4b5a69";
const STORED = `${BASE}/photos/${UUID}.jpg`;
const JPEG_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]).toString("base64")}`;

function fakeStore() {
  const puts: { key: string; mime: string; size: number }[] = [];
  const deleted: string[] = [];
  const store: PhotoObjectStore = {
    async put(key, bytes, mime) { puts.push({ key, mime, size: bytes.length }); },
    async deleteMany(keys) { deleted.push(...keys); },
  };
  return { store, puts, deleted };
}

test("decide: absent keeps, same URL keeps, empty/null clears, data URL uploads, others reject", () => {
  assert.equal(decidePhotoChange(undefined, STORED).kind, "keep");
  assert.equal(decidePhotoChange(STORED, STORED).kind, "keep");
  assert.equal(decidePhotoChange("", STORED).kind, "clear");
  assert.equal(decidePhotoChange(null, STORED).kind, "clear");
  assert.equal(decidePhotoChange(JPEG_URL, STORED).kind, "upload");
  assert.equal(decidePhotoChange("https://example.com/x.jpg", STORED).kind, "reject");
  assert.equal(decidePhotoChange(STORED.replace("https:", "http:"), STORED).kind, "reject");
  assert.equal(decidePhotoChange(`${BASE}/photos/0b6f2a52-7b1e-4c2d-9a6f-1e2d3c4b5a69.jpg`, STORED).kind, "reject");
  assert.equal(decidePhotoChange("javascript:alert(1)", "").kind, "reject");
  assert.equal(decidePhotoChange("data:image/jpeg;base64,!!!", "").kind, "reject");
});

test("decide: on create (no current photo) a stored URL of any plant is rejected", () => {
  assert.equal(decidePhotoChange(STORED, null).kind, "reject");
  assert.equal(decidePhotoChange(STORED, "").kind, "reject");
});

test("prepare: upload stores the object and reports the old key for later removal", async () => {
  const { store, puts, deleted } = fakeStore();
  const change = await preparePhotoChange(JPEG_URL, STORED, { store, publicBaseUrl: BASE });
  assert.ok(change.ok);
  assert.match(change.photoUrl!, /^https:\/\/greenthumb\.xmpp\.site\/photos\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].mime, "image/jpeg");
  assert.equal(`${BASE}/photos/${puts[0].key.slice(2)}`, change.photoUrl);
  assert.equal(change.uploadedKey, puts[0].key);
  assert.equal(change.obsoleteKey, `p/${UUID}.jpg`);
  assert.deepEqual(deleted, [], "old object is deleted only after the DB commit");
});

test("prepare: clear stores an empty string and frees the old key", async () => {
  const { store, puts } = fakeStore();
  const change = await preparePhotoChange(null, STORED, { store, publicBaseUrl: BASE });
  assert.deepEqual(change, { ok: true, photoUrl: "", uploadedKey: null, obsoleteKey: `p/${UUID}.jpg` });
  assert.equal(puts.length, 0);
});

test("prepare: clearing a legacy data URL frees nothing", async () => {
  const { store } = fakeStore();
  const change = await preparePhotoChange("", JPEG_URL, { store, publicBaseUrl: BASE });
  assert.deepEqual(change, { ok: true, photoUrl: "", uploadedKey: null, obsoleteKey: null });
});

test("prepare: keep leaves photo_url out of the update", async () => {
  const { store, puts } = fakeStore();
  const change = await preparePhotoChange(STORED, STORED, { store, publicBaseUrl: BASE });
  assert.deepEqual(change, { ok: true, photoUrl: undefined, uploadedKey: null, obsoleteKey: null });
  assert.equal(puts.length, 0);
});

test("prepare: invalid or foreign input is 400 Invalid photo with nothing stored", async () => {
  const { store, puts } = fakeStore();
  for (const bad of ["https://example.com/x.jpg", "data:text/plain;base64,aGVsbG8="]) {
    const change = await preparePhotoChange(bad, "", { store, publicBaseUrl: BASE });
    assert.deepEqual(change, { ok: false, status: 400, error: "Invalid photo" });
  }
  assert.equal(puts.length, 0);
});

test("prepare: upload without configured storage is 503", async () => {
  const change = await preparePhotoChange(JPEG_URL, "", { store: null, publicBaseUrl: null });
  assert.deepEqual(change, { ok: false, status: 503, error: "Photo storage unavailable" });
});

test("removePhotoObjects skips nulls, dedupes and never throws", async () => {
  const { store, deleted } = fakeStore();
  await removePhotoObjects(store, [null, "p/a.jpg", "p/a.jpg", undefined, "p/b.png"]);
  assert.deepEqual(deleted, ["p/a.jpg", "p/b.png"]);

  const failing: PhotoObjectStore = {
    async put() {},
    async deleteMany() { throw new Error("boom"); },
  };
  const origError = console.error;
  console.error = () => {};
  try {
    await removePhotoObjects(failing, ["p/a.jpg"]);
  } finally {
    console.error = origError;
  }
  await removePhotoObjects(null, ["p/a.jpg"]);
});
