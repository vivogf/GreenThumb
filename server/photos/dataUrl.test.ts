import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTO_BYTES, parsePhotoDataUrl } from "./dataUrl";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1");

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

test("accepts JPEG, PNG and WebP and returns the exact bytes", () => {
  for (const [mime, ext, bytes] of [
    ["image/jpeg", "jpg", JPEG],
    ["image/png", "png", PNG],
    ["image/webp", "webp", WEBP],
  ] as const) {
    const parsed = parsePhotoDataUrl(dataUrl(mime, bytes));
    assert.ok(parsed, mime);
    assert.equal(parsed.mime, mime);
    assert.equal(parsed.ext, ext);
    assert.deepEqual(parsed.bytes, bytes);
  }
});

test("image/jpg is treated as JPEG", () => {
  const parsed = parsePhotoDataUrl(dataUrl("image/jpg", JPEG));
  assert.equal(parsed?.mime, "image/jpeg");
  assert.equal(parsed?.ext, "jpg");
});

test("line breaks inside the base64 payload are tolerated", () => {
  const b64 = Buffer.concat([JPEG, JPEG, JPEG, JPEG, JPEG, JPEG]).toString("base64");
  const wrapped = b64.slice(0, 40) + "\n" + b64.slice(40);
  assert.ok(parsePhotoDataUrl(`data:image/jpeg;base64,${wrapped}`));
});

test("rejects bad base64, wrong types, magic mismatches and non-strings", () => {
  const cases: unknown[] = [
    "data:image/jpeg;base64,!!!notbase64",
    "data:text/plain;base64,aGVsbG8=",
    dataUrl("image/jpeg", PNG),
    dataUrl("image/png", JPEG),
    dataUrl("image/webp", Buffer.from("RIFF\x00\x00\x00\x00AVI LIST", "latin1")),
    dataUrl("image/gif", GIF),
    dataUrl("image/jpeg", Buffer.alloc(0)),
    "data:image/jpeg,rawnotbase64",
    "https://example.com/x.jpg",
    "",
    null,
    42,
  ];
  for (const value of cases) assert.equal(parsePhotoDataUrl(value), null, String(value).slice(0, 40));
});

test("rejects random bytes declared as JPEG", () => {
  const random = Buffer.alloc(2048, 0x5a);
  assert.equal(parsePhotoDataUrl(dataUrl("image/jpeg", random)), null);
});

test("size limit is 5 MiB of decoded bytes", () => {
  assert.equal(MAX_PHOTO_BYTES, 5 * 1024 * 1024);
  const atLimit = Buffer.alloc(MAX_PHOTO_BYTES);
  JPEG.copy(atLimit);
  assert.ok(parsePhotoDataUrl(dataUrl("image/jpeg", atLimit)));
  const over = Buffer.alloc(MAX_PHOTO_BYTES + 1);
  JPEG.copy(over);
  assert.equal(parsePhotoDataUrl(dataUrl("image/jpeg", over)), null);
  const big = Buffer.alloc(Math.round(5.5 * 1024 * 1024));
  JPEG.copy(big);
  assert.equal(parsePhotoDataUrl(dataUrl("image/jpeg", big)), null);
});
