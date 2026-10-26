import { parsePhotoDataUrl, type ParsedPhoto } from "./dataUrl";
import { keyForPhotoUrl, newPhotoLocation } from "./keys";

export const INVALID_PHOTO = "Invalid photo";

/** The part of the photo store a plant write needs. */
export interface PhotoObjectStore {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

export type PhotoDecision =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "upload"; photo: ParsedPhoto }
  | { kind: "reject" };

/**
 * Rules for an incoming `photo_url`: absent or equal to the stored URL → keep;
 * "" or null → clear; a valid image data URL → upload; anything else → reject.
 */
export function decidePhotoChange(incoming: string | null | undefined, current: string | null | undefined): PhotoDecision {
  if (incoming === undefined) return { kind: "keep" };
  if (incoming === null || incoming === "") return { kind: "clear" };
  if (current && incoming === current) return { kind: "keep" };
  if (incoming.startsWith("data:")) {
    const photo = parsePhotoDataUrl(incoming);
    return photo ? { kind: "upload", photo } : { kind: "reject" };
  }
  return { kind: "reject" };
}

export type PhotoChange =
  | { ok: false; status: 400 | 503; error: string }
  | {
      ok: true;
      /** Value to write to photo_url; undefined leaves the column untouched. */
      photoUrl: string | undefined;
      /** New object, to remove again if the DB write fails. */
      uploadedKey: string | null;
      /** Previous object, to remove after the DB write commits. */
      obsoleteKey: string | null;
    };

export async function preparePhotoChange(
  incoming: string | null | undefined,
  current: string | null | undefined,
  ctx: { store: PhotoObjectStore | null; publicBaseUrl: string | null },
): Promise<PhotoChange> {
  const decision = decidePhotoChange(incoming, current);
  switch (decision.kind) {
    case "reject":
      return { ok: false, status: 400, error: INVALID_PHOTO };
    case "keep":
      return { ok: true, photoUrl: undefined, uploadedKey: null, obsoleteKey: null };
    case "clear":
      return { ok: true, photoUrl: "", uploadedKey: null, obsoleteKey: keyForPhotoUrl(current, ctx.publicBaseUrl) };
    case "upload": {
      if (!ctx.store || !ctx.publicBaseUrl) {
        return { ok: false, status: 503, error: "Photo storage unavailable" };
      }
      const { key, url } = newPhotoLocation(decision.photo.ext, ctx.publicBaseUrl);
      await ctx.store.put(key, decision.photo.bytes, decision.photo.mime);
      return { ok: true, photoUrl: url, uploadedKey: key, obsoleteKey: keyForPhotoUrl(current, ctx.publicBaseUrl) };
    }
  }
}

/**
 * Best-effort object removal after the DB already changed. A failure only
 * leaves an orphan, which the daily sweep removes, so it is logged, not thrown.
 */
export async function removePhotoObjects(
  store: PhotoObjectStore | null | undefined,
  keys: Array<string | null | undefined>,
): Promise<void> {
  const unique = Array.from(new Set(keys.filter((k): k is string => !!k)));
  if (!store || unique.length === 0) return;
  try {
    await store.deleteMany(unique);
  } catch (err: any) {
    console.error(`Photo cleanup failed for ${unique.join(", ")}: ${err?.name ?? "Error"}`);
  }
}
