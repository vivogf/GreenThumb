import type { Request, Response } from "express";
import { utcDay, type UsageCounter } from "../species/usage";
import { parseDiagnoseBody } from "./input";
import { diagnosisLimitScope, diagnosisLimits } from "./limits";
import { buildStandaloneContext } from "./prompt";
import { DIAGNOSIS_DEADLINE_MS, DIAGNOSIS_UNAVAILABLE, limitReachedBody, errorLabel, respondWithDiagnosis } from "./run";
import type { DiagnosisProvider } from "./types";

export interface StandaloneDiagnoseDeps {
  /** Only the usage counter: this route never reads plants, users or journal events. */
  store: UsageCounter;
  provider: () => DiagnosisProvider | null;
  env?: () => NodeJS.ProcessEnv;
  now?: () => Date;
  deadlineMs?: () => number;
  log?: (line: string) => void;
}

/**
 * POST /api/diagnose: diagnosis of a photo without a plant (architecture §9.1). Order: session (401), body (400),
 * provider configured (503), daily limits shared with the plant route (429, scope user|global), provider call.
 * Nothing is stored except the usage count after a validated result.
 */
export function createStandaloneDiagnoseHandler(deps: StandaloneDiagnoseDeps) {
  const env = deps.env ?? (() => process.env);
  const now = deps.now ?? (() => new Date());
  const deadlineMs = deps.deadlineMs ?? (() => DIAGNOSIS_DEADLINE_MS);
  const log = deps.log ?? ((line: string) => console.warn(line));

  return async function standaloneDiagnoseHandler(req: Request, res: Response) {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
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
    try {
      const scope = await diagnosisLimitScope(deps.store, day, usageUser, diagnosisLimits(env()));
      if (scope) {
        res.status(429).json(limitReachedBody(scope));
        return;
      }
    } catch (error) {
      log(`diagnosis: store failed (${errorLabel(error)})`);
      res.status(503).json(DIAGNOSIS_UNAVAILABLE);
      return;
    }

    await respondWithDiagnosis({
      res,
      provider,
      request: {
        photoDataUrl: parsed.data.photoDataUrl,
        language: parsed.data.language,
        context: buildStandaloneContext({ note: parsed.data.note }),
        subject: "unknown",
      },
      deadlineMs: deadlineMs(),
      store: deps.store,
      day,
      usageUser,
      log,
    });
  };
}
