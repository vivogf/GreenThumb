import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_IDENTIFY_PHOTO_BYTES, parseIdentifyBody, parseIdentifyPhoto } from "./identifyInput";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpegUrl = (b: Buffer = JPEG) => `data:image/jpeg;base64,${b.toString("base64")}`;

function sized(n: number): Buffer {
  const b = Buffer.alloc(n, 7);
  JPEG.copy(b, 0, 0, 3);
  return b;
}

test("accepts one JPEG with defaults: organ auto, lang en", () => {
  const r = parseIdentifyBody({ photos: [jpegUrl()] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.lang, "en");
  assert.deepEqual(r.data.images.map((i) => [i.mime, i.organ]), [["image/jpeg", "auto"]]);
});

test("pairs organs with photos and pads missing ones with auto", () => {
  const r = parseIdentifyBody({ photos: [jpegUrl(), `data:image/png;base64,${PNG.toString("base64")}`, jpegUrl()], organs: ["leaf", "flower"], lang: "ru" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.lang, "ru");
  assert.deepEqual(r.data.images.map((i) => [i.mime, i.organ]), [["image/jpeg", "leaf"], ["image/png", "flower"], ["image/jpeg", "auto"]]);
});

test("rejects unsupported lang, unknown organs and too many organs", () => {
  assert.equal(parseIdentifyBody({ photos: [jpegUrl()], lang: "de" }).ok, false);
  assert.equal(parseIdentifyBody({ photos: [jpegUrl()], organs: ["stem"] }).ok, false);
  assert.equal(parseIdentifyBody({ photos: [jpegUrl()], organs: ["leaf", "leaf"] }).ok, false);
});

test("photo size limit is exactly 2.5 MiB decoded", () => {
  assert.ok(parseIdentifyPhoto(jpegUrl(sized(MAX_IDENTIFY_PHOTO_BYTES))));
  assert.equal(parseIdentifyPhoto(jpegUrl(sized(MAX_IDENTIFY_PHOTO_BYTES + 1))), null);
});

test("rejects declared/actual type mismatch and non-image bytes", () => {
  assert.equal(parseIdentifyPhoto(`data:image/png;base64,${JPEG.toString("base64")}`), null);
  assert.equal(parseIdentifyPhoto("data:image/jpeg;base64,AAAA"), null);
  assert.equal(parseIdentifyPhoto("data:image/jpeg;base64,!!!!"), null);
  assert.equal(parseIdentifyPhoto(42), null);
});

test("error text never echoes the photo", () => {
  const secretish = "data:image/jpeg;base64,QUJDREVGR0g=";
  const r = parseIdentifyBody({ photos: [secretish] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(!r.error.includes("QUJD"));
});
