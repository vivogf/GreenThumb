import type { Request, Response } from "express";
import type { SeasonUser } from "@shared/season/forUser";
import { PLANT_NOT_FOUND, requireOwnedPlant } from "../plants/ownership";
import { utcDay, type UsageCounter } from "../species/usage";
import { parseDiagnoseBody } from "./input";
import { CONTEXT_EVENT_LIMIT, buildDiagnosisContext, type PromptEvent, type PromptPlant } from "./prompt";
import { validateDiagnosisOutput } from "./result";
import { DiagnosisUnavailableError, type DiagnosisProvider, type DiagnosisRequest } from "./types";

export const DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT = 10;
/** One deadline across all retries (architecture §8.7). */
export const DIAGNOSIS_DEADLINE_MS = 60_000;

export const DIAGNOSIS_UNAVAILABLE = { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" } as const;
export const DAILY_LIMIT = { error: "Daily diagnosis limit reached", code: "daily_limit" } as const;

export interface DiagnoseStore extends UsageCounter {
  getPlantForUser(id: string, userId: number): Promise<PromptPlant | null>;
  getUserById(id: number): Promise<SeasonUser>;
  /** Newest first. */
  listEvents(plantId: string, limit: number, before: null): Promise<PromptEvent[]>;
}

export interface DiagnoseDeps {
  store: DiagnoseStore;
  provider: () => DiagnosisProvider | null;
  env?: () => NodeJS.ProcessEnv;
  now?: () => Date;
  deadlineMs?: () => number;
  log?: (line: string) => void;
}

export function diagnosisUserDailyLimit(env: NodeJS.ProcessEnv): number {
  const raw = env.DIAGNOSIS_USER_DAILY_LIMIT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT;
}

function errorLabel(error: unknown): string {
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
 * POST /api/plants/:id/diagnose (architecture §2.10, §8.7). Order: session (401), plant ownership (404),
 * body (400), provider configured (503), daily limit (429), provider call. Only a validated 200 counts
 * toward the per-user UTC-day limit. The photo and the key are never logged or stored.
 */
export function createDiagnoseHandler(deps: DiagnoseDeps) {
  const env = deps.env ?? (() => process.env);
  const now = deps.now ?? (() => new Date());
  const deadlineMs = deps.deadlineMs ?? (() => DIAGNOSIS_DEADLINE_MS);
  const log = deps.log ?? ((line: string) => console.warn(line));

  return async function diagnoseHandler(req: Request, res: Response) {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    let plant: PromptPlant | null;
    try {
      plant = await requireOwnedPlant(deps.store.getPlantForUser.bind(deps.store), req.params.id, userId);
    } catch (error) {
      log(`diagnosis: plant lookup failed (${errorLabel(error)})`);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    if (!plant) {
      res.status(404).json(PLANT_NOT_FOUND);
      return;
    }
    const parsed = parseDiagnoseBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const provider = deps.provider();
    if (!provider) {
      log("diagnosis: provider disabled (DIAGNOSIS_PROVIDER/OPENAI_API_KEY)");
      res.status(503).json(DIAGNOSIS_UNAVAILABLE);
      return;
    }

    const day = utcDay(now());
    const usageUser = String(userId);
    let context: string;
    try {
      const used = await deps.store.usageCount(day, usageUser, "diagnosis");
      if (used >= diagnosisUserDailyLimit(env())) {
        res.status(429).json(DAILY_LIMIT);
        return;
      }
      const [user, events] = await Promise.all([
        deps.store.getUserById(userId),
        deps.store.listEvents(plant.id, CONTEXT_EVENT_LIMIT, null),
      ]);
      context = buildDiagnosisContext({ plant, user, events, note: parsed.data.note });
    } catch (error) {
      log(`diagnosis: store failed (${errorLabel(error)})`);
      res.status(503).json(DIAGNOSIS_UNAVAILABLE);
      return;
    }

    let raw: unknown;
    const started = Date.now();
    try {
      raw = await diagnoseWithDeadline(
        provider,
        { photoDataUrl: parsed.data.photoDataUrl, language: parsed.data.language, context },
        deadlineMs(),
        res,
      );
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
      await deps.store.recordUsage(day, usageUser, "diagnosis");
    } catch (error) {
      log(`diagnosis: usage record failed (${errorLabel(error)})`);
    }
    res.json(result);
  };
}
