import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_NOTE_CHARS, parseDiagnoseBody } from "./input";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const url = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString("base64")}`;
const jpeg = url("image/jpeg", JPEG);

test("accepts JPEG, PNG and WebP photos with the request data URL kept", () => {
  for (const [mime, bytes] of [["image/jpeg", JPEG], ["image/png", PNG], ["image/webp", WEBP]] as const) {
    const r = parseDiagnoseBody({ photo: url(mime, bytes), language: "en" });
    assert.equal(r.ok, true, mime);
    if (r.ok) {
      assert.equal(r.data.photoDataUrl, url(mime, bytes));
      assert.equal(r.data.note, null);
      assert.equal(r.data.language, "en");
    }
  }
});

test("accepts a note of exactly 500 Cyrillic characters and an omitted note", () => {
  const note = "ж".repeat(MAX_NOTE_CHARS);
  const r = parseDiagnoseBody({ photo: jpeg, note, language: "ru" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.note, note);
  const omitted = parseDiagnoseBody({ photo: jpeg, language: "ru" });
  assert.equal(omitted.ok, true);
  if (omitted.ok) assert.equal(omitted.data.note, null);
});

test("a blank note counts as no note", () => {
  const r = parseDiagnoseBody({ photo: jpeg, note: "   ", language: "en" });
  assert.equal(r.ok && r.data.note, null);
});

test("rejects every invalid body with an error message", () => {
  const cases: Array<[string, unknown]> = [
    ["no body", undefined],
    ["array body", [jpeg]],
    ["missing photo", { language: "en" }],
    ["https photo", { photo: "https://example.com/a.jpg", language: "en" }],
    ["malformed base64", { photo: "data:image/jpeg;base64,@@@@", language: "en" }],
    ["mime mismatch", { photo: url("image/png", JPEG), language: "en" }],
    ["gif", { photo: url("image/gif", GIF), language: "en" }],
    ["501 Cyrillic note", { photo: jpeg, note: "ж".repeat(501), language: "ru" }],
    ["numeric note", { photo: jpeg, note: 5, language: "en" }],
    ["missing language", { photo: jpeg }],
    ["de", { photo: jpeg, language: "de" }],
    ["RU", { photo: jpeg, language: "RU" }],
    ["numeric language", { photo: jpeg, language: 123 }],
  ];
  for (const [name, body] of cases) {
    const r = parseDiagnoseBody(body);
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.ok(r.error.length > 0, name);
  }
});
