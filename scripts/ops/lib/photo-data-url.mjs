// Plain-JS mirror of server/photos/dataUrl.ts for ops scripts, which run with `node` (no tsx in production).
// photo-data-url.test.mjs checks that both parsers agree on the same inputs.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64_CHARS = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

const MIME_EXT = {
  'image/jpeg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/jpg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/png': { mime: 'image/png', ext: 'png' },
  'image/webp': { mime: 'image/webp', ext: 'webp' },
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function magicMatches(mime, b) {
  switch (mime) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE);
    case 'image/webp':
      return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

/** @returns {{mime: string, ext: string, bytes: Buffer} | null} */
export function parsePhotoDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const type = MIME_EXT[match[1]];
  const payload = value.slice(match[0].length).replace(/[\r\n]/g, '');
  if (payload.length === 0 || payload.length % 4 !== 0 || payload.length > MAX_BASE64_CHARS) return null;
  if (!BASE64.test(payload)) return null;
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (!magicMatches(type.mime, bytes)) return null;
  return { mime: type.mime, ext: type.ext, bytes };
}
