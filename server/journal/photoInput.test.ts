import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTION_MAX_CHARS, parsePhotoInput } from "./photoInput";

const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString("base64");
const NOW = new Date("2026-10-27T22:30:00Z");

test("valid photo without optional fields defaults taken_on to user-local today", () => {
  const r = parsePhotoInput({ photo: JPEG }, null, NOW);
  assert.ok(r.ok);
  assert.equal(r.data.taken_on, "2026-10-28"); // Moscow
  assert.equal(r.data.caption, null);
  assert.equal(r.data.photo.ext, "jpg");
  const r2 = parsePhotoInput({ photo: JPEG }, "Pacific/Pago_Pago", NOW);
  assert.ok(r2.ok);
  assert.equal(r2.data.taken_on, "2026-10-27");
});

test("explicit date and captions of 1 and 300 characters round-trip untruncated", () => {
  for (const caption of ["a", "x".repeat(CAPTION_MAX_CHARS), "🌿".repeat(CAPTION_MAX_CHARS)]) {
    const r = parsePhotoInput({ photo: PNG, caption, taken_on: "2026-01-05" }, null, NOW);
    assert.ok(r.ok, caption.slice(0, 5));
    assert.equal(r.data.caption, caption);
    assert.equal(r.data.taken_on, "2026-01-05");
    assert.equal(r.data.photo.ext, "png");
  }
});

test("empty or null caption is stored as no caption", () => {
  for (const caption of ["", null]) {
    const r = parsePhotoInput({ photo: JPEG, caption }, null, NOW);
    assert.ok(r.ok);
    assert.equal(r.data.caption, null);
  }
});

test("captions over 300 characters are rejected, not truncated", () => {
  assert.equal(CAPTION_MAX_CHARS, 300);
  const r = parsePhotoInput({ photo: JPEG, caption: "x".repeat(301) }, null, NOW);
  assert.equal(r.ok, false);
  const r2 = parsePhotoInput({ photo: JPEG, caption: "🌿".repeat(301) }, null, NOW);
  assert.equal(r2.ok, false);
});

test("invalid photos are rejected as Invalid photo", () => {
  const cases: unknown[] = [
    undefined,
    "",
    "https://greenthumb.xmpp.site/photos/3f0c8a52-7b1e-4c2d-9a6f-1e2d3c4b5a69.jpg",
    "data:image/jpeg;base64,!!!notbase64",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "data:image/png;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"),
    "data:image/jpeg;base64," + Buffer.alloc(5 * 1024 * 1024 + 3, 0xff).toString("base64"),
    42,
  ];
  for (const photo of cases) {
    const r = parsePhotoInput({ photo }, null, NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "Invalid photo");
  }
});

test("bad types and dates are rejected", () => {
  assert.equal(parsePhotoInput(null, null, NOW).ok, false);
  assert.equal(parsePhotoInput([JPEG], null, NOW).ok, false);
  assert.equal(parsePhotoInput({ photo: JPEG, caption: 5 }, null, NOW).ok, false);
  assert.equal(parsePhotoInput({ photo: JPEG, taken_on: "yesterday" }, null, NOW).ok, false);
  assert.equal(parsePhotoInput({ photo: JPEG, taken_on: "2026-02-30" }, null, NOW).ok, false);
  assert.equal(parsePhotoInput({ photo: JPEG, taken_on: 20260101 }, null, NOW).ok, false);
});

test("an ISO datetime taken_on becomes the user-local date", () => {
  const r = parsePhotoInput({ photo: JPEG, taken_on: "2026-10-27T22:30:00Z" }, "Europe/Moscow", NOW);
  assert.ok(r.ok);
  assert.equal(r.data.taken_on, "2026-10-28");
});
