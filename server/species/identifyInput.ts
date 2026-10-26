import { z } from "zod";

/** Pl@ntNet organs accepted by POST /api/species/identify (architecture §2.7). */
export const ORGANS = ["auto", "leaf", "flower", "fruit", "bark"] as const;
export type Organ = (typeof ORGANS)[number];
export type IdentifyLang = "ru" | "en";

export const MAX_IDENTIFY_PHOTOS = 3;
/** 2.5 MiB decoded per photo. */
export const MAX_IDENTIFY_PHOTO_BYTES = 2_621_440;

export interface IdentifyImage {
  mime: "image/jpeg" | "image/png";
  bytes: Buffer;
  organ: Organ;
}

export interface IdentifyRequest {
  images: IdentifyImage[];
  lang: IdentifyLang;
}

export type IdentifyParse = { ok: true; data: IdentifyRequest } | { ok: false; error: string };

const DATA_URL = /^data:image\/(jpeg|jpg|png);base64,/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64_CHARS = Math.ceil(MAX_IDENTIFY_PHOTO_BYTES / 3) * 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniff(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  return null;
}

/** Decodes one JPEG/PNG data URL; null when prefix, base64, signature or size is wrong. */
export function parseIdentifyPhoto(value: unknown): { mime: "image/jpeg" | "image/png"; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const declared = match[1] === "png" ? "image/png" : "image/jpeg";
  const payload = value.slice(match[0].length).replace(/[\r\n]/g, "");
  if (payload.length === 0 || payload.length % 4 !== 0 || payload.length > MAX_BASE64_CHARS) return null;
  if (!BASE64.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IDENTIFY_PHOTO_BYTES) return null;
  if (sniff(bytes) !== declared) return null;
  return { mime: declared, bytes };
}

const bodySchema = z.object({
  photos: z.array(z.unknown()).min(1).max(MAX_IDENTIFY_PHOTOS),
  organs: z.array(z.enum(ORGANS)).max(MAX_IDENTIFY_PHOTOS).optional(),
  lang: z.enum(["ru", "en"]).optional(),
});

/**
 * Validates the identify body. Error strings never echo the photo payload.
 * An unsupported `lang` is rejected (400) rather than silently sent as `en`.
 */
export function parseIdentifyBody(body: unknown): IdentifyParse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "lang") return { ok: false, error: "lang: expected ru or en" };
    if (field === "organs") return { ok: false, error: `organs: expected up to one of ${ORGANS.join(", ")} per photo` };
    return { ok: false, error: `photos: expected 1 to ${MAX_IDENTIFY_PHOTOS} JPEG or PNG data URLs` };
  }
  const { photos, organs = [], lang = "en" } = parsed.data;
  if (organs.length > photos.length) {
    return { ok: false, error: "organs: more organs than photos" };
  }
  const images: IdentifyImage[] = [];
  for (let index = 0; index < photos.length; index++) {
    const photo = parseIdentifyPhoto(photos[index]);
    if (!photo) {
      return { ok: false, error: `photos[${index}]: expected a JPEG or PNG data URL of at most 2.5 MiB` };
    }
    images.push({ ...photo, organ: organs[index] ?? "auto" });
  }
  return { ok: true, data: { images, lang } };
}
