import type { Response } from "express";
import type { UsageCounter } from "../species/usage";
import type { DiagnosisLimitScope } from "./limits";
import { validateDiagnosisOutput } from "./result";
import { DiagnosisUnavailableError, type DiagnosisProvider, type DiagnosisRequest } from "./types";

/** One deadline across all retries (architecture §8.7). */
export const DIAGNOSIS_DEADLINE_MS = 60_000;

export const DIAGNOSIS_UNAVAILABLE = { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" } as const;
export const DAILY_LIMIT = { error: "Daily diagnosis limit reached", code: "daily_limit" } as const;

export function limitReachedBody(scope: DiagnosisLimitScope) {
  return { ...DAILY_LIMIT, scope };
}

export function errorLabel(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Runs the provider under one AbortSignal that fires at the deadline or when the client goes away.
 * Rejects with DiagnosisUnavailableError("deadline") at the deadline even if the provider ignores the signal.
 */
async function diagnoseWithDeadline(provider: DiagnosisProvider, request: DiagnosisRequest, ms: number, res: Response): Promise<unknown> {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DiagnosisUnavailableError("deadline"));
    }, ms);
  });
  const work = provider.diagnose(request, { signal: controller.signal });
  // After the deadline wins, the provider's own rejection must not become an unhandled rejection.
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
  }
}

/** Provider call → output validation → usage record (only after a validated result) → 200 with causes and summary. */
export async function respondWithDiagnosis(input: {
  res: Response;
  provider: DiagnosisProvider;
  request: DiagnosisRequest;
  deadlineMs: number;
  store: Pick<UsageCounter, "recordUsage">;
  day: string;
  usageUser: string;
  log: (line: string) => void;
}): Promise<void> {
  const { res, log } = input;
  let raw: unknown;
  const started = Date.now();
  try {
    raw = await diagnoseWithDeadline(input.provider, input.request, input.deadlineMs, res);
  } catch (error) {
    const reason = error instanceof DiagnosisUnavailableError
      ? `${error.reason}${error.status ? ` ${error.status}` : ""}`
      : `unexpected ${errorLabel(error)}`;
    log(`diagnosis: provider unavailable (${reason}) after ${Date.now() - started} ms`);
    if (!res.headersSent) res.status(503).json(DIAGNOSIS_UNAVAILABLE);
    return;
  }
  const result = validateDiagnosisOutput(raw);
  if (!result) {
    log("diagnosis: provider output failed validation");
    res.status(503).json(DIAGNOSIS_UNAVAILABLE);
    return;
  }
  try {
    await input.store.recordUsage(input.day, input.usageUser, "diagnosis");
  } catch (error) {
    log(`diagnosis: usage record failed (${errorLabel(error)})`);
  }
  res.json(result);
}
