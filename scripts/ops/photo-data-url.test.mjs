import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoDataUrl } from './lib/photo-data-url.mjs';
import { keyForPhotoUrl, isPhotoKey, newPhotoLocation } from './lib/photo-keys.mjs';
import { parsePhotoDataUrl as serverParse, MAX_PHOTO_BYTES } from '../../server/photos/dataUrl.ts';
import { keyForPhotoUrl as serverKeyForPhotoUrl } from '../../server/photos/keys.ts';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;
const big = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);

const inputs = [
  dataUrl('image/jpeg', JPEG), dataUrl('image/jpg', JPEG), dataUrl('image/png', PNG), dataUrl('image/webp', WEBP),
  dataUrl('image/png', JPEG), dataUrl('image/gif', JPEG), dataUrl('image/jpeg', big),
  'data:image/jpeg;base64,', 'data:image/jpeg;base64,!!!x', 'data:image/jpeg;base64,abc',
  `data:image/jpeg;base64,${JPEG.toString('base64').slice(0, 8)}\n${JPEG.toString('base64').slice(8)}`,
  'https://example.com/x.jpg', '', null, undefined, 42,
];

test('ops parser agrees with the server parser on every input', () => {
  for (const input of inputs) {
    const ours = parsePhotoDataUrl(input);
    const theirs = serverParse(input);
    assert.deepEqual(ours, theirs, String(input).slice(0, 40));
  }
});

test('ops key helpers agree with the server', () => {
  const base = 'https://greenthumb.xmpp.site';
  const { key, url } = newPhotoLocation('png', base);
  assert.ok(isPhotoKey(key));
  for (const u of [url, `${base}/photos/nope.jpg`, 'data:x', '', null, 'https://other/photos/x.jpg']) {
    assert.equal(keyForPhotoUrl(u, base), serverKeyForPhotoUrl(u, base));
  }
  assert.equal(keyForPhotoUrl(url, base), key);
});
