import { localDateInTz, normalizeCareDate } from "../../shared/care/userDate";
import { parsePhotoDataUrl, type ParsedPhoto } from "../photos/dataUrl";
import { INVALID_PHOTO } from "../photos/photoChange";
import type { ParseResult } from "./careEvents";

export const CAPTION_MAX_CHARS = 300;

export type PhotoInput = { photo: ParsedPhoto; caption: string | null; taken_on: string };

/** Validates a POST /photos body. Nothing is uploaded or written before this passes. */
export function parsePhotoInput(body: unknown, timezone: string | null | undefined, now: Date): ParseResult<PhotoInput> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const { photo, caption, taken_on } = body as Record<string, unknown>;
  const parsed = parsePhotoDataUrl(photo);
  if (!parsed) return { ok: false, error: INVALID_PHOTO };

  let text: string | null = null;
  if (typeof caption === "string") {
    // Code points, to match Postgres char_length in the table's CHECK.
    if (Array.from(caption).length > CAPTION_MAX_CHARS) {
      return { ok: false, error: `caption: at most ${CAPTION_MAX_CHARS} characters` };
    }
    text = caption === "" ? null : caption;
  } else if (caption !== undefined && caption !== null) {
    return { ok: false, error: "caption: must be a string" };
  }

  let date: string;
  if (taken_on === undefined || taken_on === null) {
    date = localDateInTz(now, timezone);
  } else if (typeof taken_on === "string") {
    const normalized = normalizeCareDate(taken_on, timezone);
    if (normalized === null) return { ok: false, error: "taken_on: expected YYYY-MM-DD" };
    date = normalized;
  } else {
    return { ok: false, error: "taken_on: expected YYYY-MM-DD" };
  }
  return { ok: true, data: { photo: parsed, caption: text, taken_on: date } };
}
