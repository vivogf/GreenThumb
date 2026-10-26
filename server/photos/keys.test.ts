import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeForFile, keyForFileName, keyForPhotoUrl, newPhotoLocation } from "./keys";

const BASE = "https://greenthumb.xmpp.site";
const UUID = "3f0c8a52-7b1e-4c2d-9a6f-1e2d3c4b5a69";

test("new locations use p/<uuid v4>.<ext> and the public /photos URL", () => {
  const loc = newPhotoLocation("jpg", BASE + "/");
  assert.match(loc.key, /^p\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/);
  assert.equal(loc.url, `${BASE}/photos/${loc.key.slice(2)}`);
  assert.notEqual(newPhotoLocation("jpg", BASE).key, loc.key);
});

test("file names map to keys only when strictly well-formed", () => {
  assert.equal(keyForFileName(`${UUID}.jpg`), `p/${UUID}.jpg`);
  assert.equal(keyForFileName(`${UUID}.png`), `p/${UUID}.png`);
  assert.equal(keyForFileName(`${UUID}.webp`), `p/${UUID}.webp`);
  for (const bad of [
    "", "abc.jpg", `${UUID}.gif`, UUID, `${UUID.toUpperCase()}.jpg`, `${UUID}.JPG`,
    "../../etc/passwd", `../${UUID}.jpg`, `${UUID}.jpg/x`, `${UUID}.jpg.png`,
  ]) {
    assert.equal(keyForFileName(bad), null, bad);
  }
});

test("only our own https photo URLs map back to keys", () => {
  assert.equal(keyForPhotoUrl(`${BASE}/photos/${UUID}.jpg`, BASE), `p/${UUID}.jpg`);
  assert.equal(keyForPhotoUrl(`${BASE}/photos/${UUID}.jpg`, BASE + "/"), `p/${UUID}.jpg`);
  for (const other of [
    `http://greenthumb.xmpp.site/photos/${UUID}.jpg`,
    `https://example.com/photos/${UUID}.jpg`,
    `${BASE}/photos/${UUID}.jpg?x=1`,
    `${BASE}/photos/abc.jpg`,
    "data:image/jpeg;base64,/9j/",
    "",
    null,
    undefined,
  ]) {
    assert.equal(keyForPhotoUrl(other as any, BASE), null, String(other));
  }
  assert.equal(keyForPhotoUrl(`${BASE}/photos/${UUID}.jpg`, null), null);
});

test("content type follows the extension", () => {
  assert.equal(contentTypeForFile(`${UUID}.jpg`), "image/jpeg");
  assert.equal(contentTypeForFile(`${UUID}.png`), "image/png");
  assert.equal(contentTypeForFile(`${UUID}.webp`), "image/webp");
});
