import type { Response } from "express";
import type { UsageCounter } from "../species/usage";
import { DIAGNOSIS_ATTEMPT_KIND, type DiagnosisLimitScope } from "./limits";
import { readDiagnosisOutput } from "./result";
import { DiagnosisNotApplicableError, DiagnosisUnavailableError, type DiagnosisProvider, type DiagnosisRequest } from "./types";

/** One deadline across all retries (architecture §8.7). */
export const DIAGNOSIS_DEADLINE_MS = 60_000;

export const DIAGNOSIS_UNAVAILABLE = { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" } as const;
export const DAILY_LIMIT = { error: "Daily diagnosis limit reached", code: "daily_limit" } as const;

/**
 * 422 for a photo with no plant (or nothing to diagnose) in it. Not an outage: the client asks for another
 * photo, and the attempt is not counted against the user's daily limit because only a shown result is recorded.
 */
export const DIAGNOSIS_NOT_A_PLANT = { error: "No plant or disease signs recognised", code: "no_plant" } as const;

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

/**
 * Counts one paid provider call against the day's global cap. It runs before the provider is entered, so every
 * call counts — a «no plant» answer, a refusal, a malformed answer, and a call that dies at the deadline or when
 * the client hangs up, all of which are billed. Only a shown result also counts toward the user's own limit, so a
 * user is never charged for a call that showed nothing.
 *
 * A failed write is logged and the call proceeds: the same database serves the limit checks, so a store that
 * cannot write here has already failed the check that let the call through.
 */
async function countAttempt(
  input: { store: Pick<UsageCounter, "recordUsage">; day: string; usageUser: string },
  log: (line: string) => void,
): Promise<void> {
  try {
    await input.store.recordUsage(input.day, input.usageUser, DIAGNOSIS_ATTEMPT_KIND);
  } catch (error) {
    log(`diagnosis: attempt record failed (${errorLabel(error)})`);
  }
}

/**
 * Attempt (every call is paid from the moment the provider is entered) → provider call → output validation →
 * usage (only after a validated result) → 200 with causes and summary.
 */
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
  // Before the call: from here on the provider is paid whatever happens to the answer or the connection.
  await countAttempt(input, log);
  try {
    raw = await diagnoseWithDeadline(input.provider, input.request, input.deadlineMs, res);
  } catch (error) {
    // The provider declining to analyse the photo is not a verdict about it: a refusal can come from the photo's
    // content (a person in the frame) or from the provider itself, so the client is told to try later, not to
    // take another photo. A photo with no plant is answered by the model itself (an empty causes list, below).
    if (error instanceof DiagnosisNotApplicableError) {
      log(`diagnosis: provider declined (${error.reason}) after ${Date.now() - started} ms`);
      if (!res.headersSent) res.status(503).json(DIAGNOSIS_UNAVAILABLE);
      return;
    }
    const reason = error instanceof DiagnosisUnavailableError
      ? `${error.reason}${error.status ? ` ${error.status}` : ""}`
      : `unexpected ${errorLabel(error)}`;
    log(`diagnosis: provider unavailable (${reason}) after ${Date.now() - started} ms`);
    if (!res.headersSent) res.status(503).json(DIAGNOSIS_UNAVAILABLE);
    return;
  }
  const reading = readDiagnosisOutput(raw);
  if (reading.kind !== "ok") {
    if (reading.kind === "no_plant") {
      log("diagnosis: the photo shows no plant (empty causes)");
      res.status(422).json(DIAGNOSIS_NOT_A_PLANT);
      return;
    }
    log("diagnosis: provider output failed validation");
    res.status(503).json(DIAGNOSIS_UNAVAILABLE);
    return;
  }
  try {
    await input.store.recordUsage(input.day, input.usageUser, "diagnosis");
  } catch (error) {
    log(`diagnosis: usage record failed (${errorLabel(error)})`);
  }
  res.json(reading.result);
}
