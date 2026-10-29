import type { Request, Response } from "express";
import type { SeasonUser } from "@shared/season/forUser";
import { PLANT_NOT_FOUND, requireOwnedPlant } from "../plants/ownership";
import { utcDay, type UsageCounter } from "../species/usage";
import { parseDiagnoseBody } from "./input";
import { diagnosisLimitScope, diagnosisLimits } from "./limits";
import { CONTEXT_EVENT_LIMIT, buildDiagnosisContext, type PromptEvent, type PromptPlant } from "./prompt";
import { DIAGNOSIS_DEADLINE_MS, DIAGNOSIS_UNAVAILABLE, limitReachedBody, errorLabel, respondWithDiagnosis } from "./run";
import type { DiagnosisProvider } from "./types";

export { DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT } from "./limits";
export { DAILY_LIMIT, DIAGNOSIS_DEADLINE_MS, DIAGNOSIS_UNAVAILABLE } from "./run";

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
  return diagnosisLimits(env).userLimit;
}

/**
 * POST /api/plants/:id/diagnose (architecture §2.10, §8.7). Order: session (401), plant ownership (404),
 * body (400), provider configured (503), daily limits (429, scope user|global), provider call. Only a validated
 * 200 counts toward the UTC-day limits. The photo and the key are never logged or stored.
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
      const scope = await diagnosisLimitScope(deps.store, day, usageUser, diagnosisLimits(env()));
      if (scope) {
        res.status(429).json(limitReachedBody(scope));
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

    await respondWithDiagnosis({
      res,
      provider,
      request: { photoDataUrl: parsed.data.photoDataUrl, language: parsed.data.language, context, subject: "own" },
      deadlineMs: deadlineMs(),
      store: deps.store,
      day,
      usageUser,
      log,
    });
  };
}
