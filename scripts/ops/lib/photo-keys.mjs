// Photo object keys and URLs; same rules as server/photos/keys.ts.
import { randomUUID } from 'node:crypto';

export const PHOTO_KEY_PREFIX = 'p/';
const PHOTO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const trimBase = (base) => base.replace(/\/+$/, '');

export function newPhotoLocation(ext, publicBaseUrl) {
  const file = `${randomUUID()}.${ext}`;
  return { key: PHOTO_KEY_PREFIX + file, url: `${trimBase(publicBaseUrl)}/photos/${file}` };
}

/** True only for keys this app writes: `p/<uuid>.<jpg|png|webp>`. */
export function isPhotoKey(key) {
  return typeof key === 'string' && key.startsWith(PHOTO_KEY_PREFIX) && PHOTO_FILE.test(key.slice(PHOTO_KEY_PREFIX.length));
}

/** R2 key of a photo URL this server issued; null for empty, data:, foreign or malformed URLs. */
export function keyForPhotoUrl(url, publicBaseUrl) {
  if (!url || !publicBaseUrl) return null;
  const prefix = `${trimBase(publicBaseUrl)}/photos/`;
  if (!url.startsWith(prefix)) return null;
  const file = url.slice(prefix.length);
  return PHOTO_FILE.test(file) ? PHOTO_KEY_PREFIX + file : null;
}
