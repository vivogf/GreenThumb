import { randomUUID } from "node:crypto";
import type { PhotoExt, PhotoMime } from "./dataUrl";

const PHOTO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
export const PHOTO_KEY_PREFIX = "p/";

const EXT_MIME: Record<PhotoExt, PhotoMime> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

export function newPhotoLocation(ext: PhotoExt, publicBaseUrl: string): { key: string; url: string } {
  const file = `${randomUUID()}.${ext}`;
  return { key: PHOTO_KEY_PREFIX + file, url: `${trimBase(publicBaseUrl)}/photos/${file}` };
}

/** `<uuid>.<ext>` from a /photos/ request → R2 key; anything else → null. */
export function keyForFileName(file: string): string | null {
  return PHOTO_FILE.test(file) ? PHOTO_KEY_PREFIX + file : null;
}

/** R2 key of a photo URL this server issued; null for empty, data:, foreign or malformed URLs. */
export function keyForPhotoUrl(url: string | null | undefined, publicBaseUrl: string | null | undefined): string | null {
  if (!url || !publicBaseUrl) return null;
  const prefix = `${trimBase(publicBaseUrl)}/photos/`;
  if (!url.startsWith(prefix)) return null;
  return keyForFileName(url.slice(prefix.length));
}

export function contentTypeForFile(file: string): PhotoMime {
  return EXT_MIME[file.slice(file.lastIndexOf(".") + 1) as PhotoExt];
}
