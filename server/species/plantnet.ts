import type { IdentifyImage, IdentifyLang } from "./identifyInput";

export const PLANTNET_IDENTIFY_URL = "https://my-api.plantnet.org/v2/identify/all";
export const PLANTNET_TIMEOUT_MS = 15_000;
export const MAX_CANDIDATES = 3;

export interface SpeciesCandidate {
  scientificName: string;
  commonNames: string[];
  score: number;
  gbifId: string | null;
}

/**
 * `reason` is a fixed, secret-free label for logs (never an error message or
 * URL: both may contain the api-key query parameter).
 */
export type IdentifyOutcome =
  | { kind: "ok"; results: SpeciesCandidate[] }
  | { kind: "quota" }
  | { kind: "unavailable"; reason: string };

export interface PlantNetOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function buildForm(images: IdentifyImage[]): FormData {
  const form = new FormData();
  images.forEach((image, index) => {
    const ext = image.mime === "image/png" ? "png" : "jpg";
    form.append("images", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `${index}.${ext}`);
    form.append("organs", image.organ);
  });
  return form;
}

function mapCandidate(raw: any): SpeciesCandidate | null {
  const name = raw?.species?.scientificNameWithoutAuthor;
  if (typeof name !== "string" || name.trim() === "") return null;
  const score = raw?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const common = Array.isArray(raw?.species?.commonNames)
    ? raw.species.commonNames.filter((n: unknown): n is string => typeof n === "string" && n.trim() !== "")
    : [];
  const gbif = raw?.gbif?.id;
  const gbifId = typeof gbif === "string" && gbif !== "" ? gbif : typeof gbif === "number" ? String(gbif) : null;
  return { scientificName: name.trim(), commonNames: common, score: Math.min(1, Math.max(0, score)), gbifId };
}

/** Maps a Pl@ntNet 200 body to at most 3 candidates in provider order; null when malformed. */
export function mapPlantNetResults(payload: unknown): SpeciesCandidate[] | null {
  const results = (payload as any)?.results;
  if (!Array.isArray(results)) return null;
  const mapped: SpeciesCandidate[] = [];
  for (const raw of results) {
    const candidate = mapCandidate(raw);
    if (candidate) mapped.push(candidate);
    if (mapped.length === MAX_CANDIDATES) break;
  }
  if (results.length > 0 && mapped.length === 0) return null;
  return mapped;
}

async function callUpstream(
  images: IdentifyImage[],
  lang: IdentifyLang,
  opts: PlantNetOptions,
  signal: AbortSignal,
): Promise<IdentifyOutcome> {
  const url = new URL(PLANTNET_IDENTIFY_URL);
  url.searchParams.set("api-key", opts.apiKey);
  url.searchParams.set("lang", lang);
  url.searchParams.set("nb-results", String(MAX_CANDIDATES));
  url.searchParams.set("include-related-images", "false");
  const doFetch = opts.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, { method: "POST", body: buildForm(images), signal });
  } catch {
    return { kind: "unavailable", reason: signal.aborted ? "timeout" : "network error" };
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return { kind: "ok", results: [] };
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => {});
    return { kind: "quota" };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return { kind: "unavailable", reason: `status ${response.status}` };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "unavailable", reason: signal.aborted ? "timeout" : "invalid json" };
  }
  const results = mapPlantNetResults(payload);
  return results ? { kind: "ok", results } : { kind: "unavailable", reason: "malformed result" };
}

/**
 * One Pl@ntNet identify call (architecture §2.7). Never throws; the whole call,
 * body included, is bounded by `timeoutMs` (15 s) even if fetch ignores the signal.
 */
export async function identifyWithPlantNet(
  images: IdentifyImage[],
  lang: IdentifyLang,
  opts: PlantNetOptions,
): Promise<IdentifyOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IdentifyOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "unavailable", reason: "timeout" });
    }, opts.timeoutMs ?? PLANTNET_TIMEOUT_MS);
  });
  const work = callUpstream(images, lang, opts, controller.signal).catch(
    (): IdentifyOutcome => ({ kind: "unavailable", reason: "unexpected error" }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
