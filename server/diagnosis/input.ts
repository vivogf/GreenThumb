import { parsePhotoDataUrl, type ParsedPhoto } from "../photos/dataUrl";
import { DIAGNOSIS_LANGUAGES, type DiagnosisLanguage } from "./types";

export const MAX_NOTE_CHARS = 500;

export type DiagnoseInput = {
  photo: ParsedPhoto;
  /** Canonical data URL of the decoded photo; equal to the request value for well-formed input. */
  photoDataUrl: string;
  note: string | null;
  language: DiagnosisLanguage;
};

export type ParseResult = { ok: true; data: DiagnoseInput } | { ok: false; error: string };

function isLanguage(value: unknown): value is DiagnosisLanguage {
  return typeof value === "string" && (DIAGNOSIS_LANGUAGES as readonly string[]).includes(value);
}

/** Body of POST /api/plants/:id/diagnose: {photo, note?, language} (architecture §2.10, §8.7). */
export function parseDiagnoseBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request body" };
  const { photo, note, language } = body as Record<string, unknown>;
  const parsed = parsePhotoDataUrl(photo);
  if (!parsed) return { ok: false, error: "Invalid photo" };
  let cleanNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== "string") return { ok: false, error: "note must be a string" };
    if (Array.from(note).length > MAX_NOTE_CHARS) return { ok: false, error: `note must be at most ${MAX_NOTE_CHARS} characters` };
    cleanNote = note.trim() === "" ? null : note.trim();
  }
  if (!isLanguage(language)) return { ok: false, error: "language must be \"ru\" or \"en\"" };
  return {
    ok: true,
    data: {
      photo: parsed,
      photoDataUrl: `data:${parsed.mime};base64,${parsed.bytes.toString("base64")}`,
      note: cleanNote,
      language,
    },
  };
}
