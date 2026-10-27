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
  causes: z.array(z.unknown()).min(1),
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
 * Validates provider output (architecture §8.7): more than 3 causes keep the first 3 in provider order;
 * 0 causes, an unknown likelihood, a missing/blank field or a numeric probability give null (→ 503).
 */
export function validateDiagnosisOutput(raw: unknown): DiagnosisResult | null {
  const top = resultSchema.safeParse(raw);
  if (!top.success) return null;
  const causes = [];
  for (const item of top.data.causes.slice(0, MAX_CAUSES)) {
    const cause = causeSchema.safeParse(item);
    if (!cause.success) return null;
    causes.push(cause.data);
  }
  const result: DiagnosisResult = { causes, summary: top.data.summary };
  const texts = [result.summary, ...causes.flatMap((c) => [c.title, c.explanation, c.advice])];
  if (texts.some(statesNumericProbability)) return null;
  return result;
}
