export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
export type PhotoExt = "jpg" | "png" | "webp";

export interface ParsedPhoto {
  mime: PhotoMime;
  ext: PhotoExt;
  bytes: Buffer;
}

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
// Upper bound for the encoded payload of MAX_PHOTO_BYTES, checked before decoding.
const MAX_BASE64_CHARS = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

const MIME_EXT: Record<string, { mime: PhotoMime; ext: PhotoExt }> = {
  "image/jpeg": { mime: "image/jpeg", ext: "jpg" },
  "image/jpg": { mime: "image/jpeg", ext: "jpg" },
  "image/png": { mime: "image/png", ext: "png" },
  "image/webp": { mime: "image/webp", ext: "webp" },
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function magicMatches(mime: PhotoMime, b: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE);
    case "image/webp":
      return b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
  }
}

/**
 * Decodes a `data:image/(jpeg|png|webp);base64,...` URL. Returns null when the
 * prefix, base64, magic bytes or the 5 MiB decoded size do not check out.
 */
export function parsePhotoDataUrl(value: unknown): ParsedPhoto | null {
  if (typeof value !== "string") return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const type = MIME_EXT[match[1]];
  // Some encoders wrap base64 at 76 columns.
  const payload = value.slice(match[0].length).replace(/[\r\n]/g, "");
  if (payload.length === 0 || payload.length % 4 !== 0 || payload.length > MAX_BASE64_CHARS) return null;
  if (!BASE64.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (!magicMatches(type.mime, bytes)) return null;
  return { mime: type.mime, ext: type.ext, bytes };
}
