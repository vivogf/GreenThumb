import { DEFAULT_DIAGNOSIS_MODEL, createOpenAIDiagnosisProvider } from "./openai";
import type { DiagnosisProvider } from "./types";

/**
 * DIAGNOSIS_PROVIDER=openai with a non-empty OPENAI_API_KEY enables the OpenAI adapter (model DIAGNOSIS_MODEL,
 * default gpt-6-luna). Anything else, including unset, means disabled: the route answers 503 without a call.
 */
export function createDiagnosisProvider(env: NodeJS.ProcessEnv, opts: { fetch?: typeof fetch } = {}): DiagnosisProvider | null {
  const kind = (env.DIAGNOSIS_PROVIDER ?? "").trim().toLowerCase();
  if (kind !== "openai") return null;
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return createOpenAIDiagnosisProvider({
    apiKey,
    model: (env.DIAGNOSIS_MODEL ?? "").trim() || DEFAULT_DIAGNOSIS_MODEL,
    fetch: opts.fetch,
  });
}
