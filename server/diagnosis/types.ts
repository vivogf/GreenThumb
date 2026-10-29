export const DIAGNOSIS_LANGUAGES = ["ru", "en"] as const;
export type DiagnosisLanguage = (typeof DIAGNOSIS_LANGUAGES)[number];

export const LIKELIHOODS = ["low", "medium", "high"] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export type DiagnosisCause = { title: string; likelihood: Likelihood; explanation: string; advice: string };
export type DiagnosisResult = { causes: DiagnosisCause[]; summary: string };

/** "own": a plant from the user's collection; "unknown": a plant-less check (any plant, maybe outdoors). */
export type DiagnosisSubject = "own" | "unknown";

/** What a provider sends upstream: the photo as the request data URL, the context and the answer language. */
export type DiagnosisRequest = { photoDataUrl: string; language: DiagnosisLanguage; context: string; subject?: DiagnosisSubject };

/**
 * A diagnosis backend (architecture §2.10). `diagnose` resolves with the provider's parsed JSON output,
 * which the route validates (server/diagnosis/result.ts) before anything reaches the client. It rejects
 * with DiagnosisUnavailableError when the provider cannot answer.
 */
export interface DiagnosisProvider {
  readonly name: string;
  readonly model: string;
  diagnose(input: DiagnosisRequest, opts: { signal: AbortSignal }): Promise<unknown>;
}

/**
 * `reason` is a fixed, secret-free label for logs. Provider error messages are never copied into it:
 * they may echo request details.
 */
export class DiagnosisUnavailableError extends Error {
  constructor(readonly reason: string, readonly status?: number) {
    super(`diagnosis unavailable: ${reason}`);
    this.name = "DiagnosisUnavailableError";
  }
}
