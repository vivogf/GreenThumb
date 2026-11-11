import { z } from "zod";
import { LIKELIHOODS, type DiagnosisResult } from "./types";

export const MAX_CAUSES = 3;

const text = z.string().trim().min(1);

// Unknown keys are stripped, so an extra numeric field (e.g. `confidence`) never reaches the client.
const causeSchema = z.object({
  title: text,
  likelihood: z.enum(LIKELIHOODS),
  explanation: text,
  advice: text,
});

const resultSchema = z.object({
  causes: z.array(z.unknown()),
  summary: text,
});

// A likelihood stated as a number ("70% likely", "вероятность 60%", "confidence 0.8"). A plain percentage in
// advice ("reduce watering by 20%") has no probability word next to it and is allowed (architecture §8.7).
const PROBABILITY_WORD = "(?:probab|likel|confiden|chance|odds|вероятн|уверенн|шанс)";
const NUMERIC_PROBABILITY = [
  new RegExp(`\\d+(?:[.,]\\d+)?\\s*%\\s*${PROBABILITY_WORD}`, "iu"),
  new RegExp(`${PROBABILITY_WORD}[^.!?\\n\\d]{0,20}(?:\\d{1,3}(?:[.,]\\d+)?\\s*%|0[.,]\\d+)`, "iu"),
];

function statesNumericProbability(value: string): boolean {
  return NUMERIC_PROBABILITY.some((re) => re.test(value));
}

/**
 * What a provider answer means: a result to show, a verdict that there is no plant (or nothing to diagnose)
 * in the photo, or a broken answer. `no_plant` needs a readable summary — an empty list with a blank or
 * missing summary, or any broken cause, stays `invalid` (→ 503).
 */
export type DiagnosisReading =
  | { kind: "ok"; result: DiagnosisResult }
  | { kind: "no_plant" }
  | { kind: "invalid" };

/**
 * Validates provider output (architecture §8.7): more than 3 causes keep the first 3 in provider order;
 * an empty causes list with a summary is the model's "no plant visible" verdict; an unknown likelihood,
 * a missing/blank field or a numeric probability give `invalid`.
 */
export function readDiagnosisOutput(raw: unknown): DiagnosisReading {
  const top = resultSchema.safeParse(raw);
  if (!top.success) return { kind: "invalid" };
  if (top.data.causes.length === 0) return { kind: "no_plant" };
  const causes = [];
  for (const item of top.data.causes.slice(0, MAX_CAUSES)) {
    const cause = causeSchema.safeParse(item);
    if (!cause.success) return { kind: "invalid" };
    causes.push(cause.data);
  }
  const result: DiagnosisResult = { causes, summary: top.data.summary };
  const texts = [result.summary, ...causes.flatMap((c) => [c.title, c.explanation, c.advice])];
  if (texts.some(statesNumericProbability)) return { kind: "invalid" };
  return { kind: "ok", result };
}
