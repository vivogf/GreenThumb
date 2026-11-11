import type { Request, Response } from "express";
import { parseIdentifyBody } from "./identifyInput";
import { identifyWithPlantNet, type IdentifyOutcome, type PlantNetOptions } from "./plantnet";
import { plantNetLimits, remainingAfter, utcDay, type UsageStore } from "./usage";
import type { IdentifyImage, IdentifyLang } from "./identifyInput";

export interface IdentifyDeps {
  store: UsageStore;
  apiKey?: () => string | undefined;
  identify?: (images: IdentifyImage[], lang: IdentifyLang, opts: PlantNetOptions) => Promise<IdentifyOutcome>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  env?: () => NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export const QUOTA_EXCEEDED = { error: "Daily identification limit reached", code: "quota_exceeded" } as const;
export const IDENTIFY_UNAVAILABLE = { error: "Identification is unavailable", code: "identify_unavailable" } as const;

/** POST /api/species/identify (architecture §2.7, §8.4). */
export function createIdentifyHandler(deps: IdentifyDeps) {
  const apiKey = deps.apiKey ?? (() => process.env.PLANTNET_API_KEY);
  const identify = deps.identify ?? identifyWithPlantNet;
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? (() => process.env);
  const log = deps.log ?? ((line: string) => console.warn(line));

  return async function identifyHandler(req: Request, res: Response) {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parsed = parseIdentifyBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const key = apiKey();
    if (!key) {
      log("species identify: PLANTNET_API_KEY is not set");
      res.status(503).json(IDENTIFY_UNAVAILABLE);
      return;
    }
    const limits = plantNetLimits(env());
    const day = utcDay(now());
    let reservation;
    try {
      reservation = await deps.store.reserve({ day, userId: String(userId), kind: "identify", ...limits });
    } catch (err: any) {
      log(`species identify: usage store failed (${err?.name ?? "Error"})`);
      res.status(503).json(IDENTIFY_UNAVAILABLE);
      return;
    }
    if (!reservation.ok) {
      res.status(429).json(QUOTA_EXCEEDED);
      return;
    }
    const outcome = await identify(parsed.data.images, parsed.data.lang, {
      apiKey: key,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs,
    });
    switch (outcome.kind) {
      case "ok": {
        if (outcome.results.length === 0) {
          // Pl@ntNet found no plant: a verdict about the photo, not a recognition. The reservation goes back,
          // so a photo of a wall does not spend one of the user's 20 identifications.
          try {
            await deps.store.release({ day, userId: String(userId), kind: "identify" });
          } catch (err: any) {
            log(`species identify: release failed (${err?.name ?? "Error"})`);
          }
          res.json({
            results: [],
            remainingToday: remainingAfter(
              { userCount: reservation.userCount - 1, globalCount: reservation.globalCount - 1 },
              limits,
            ),
          });
          return;
        }
        res.json({ results: outcome.results, remainingToday: remainingAfter(reservation, limits) });
        return;
      }
      case "quota":
        log("species identify: upstream quota exhausted (429)");
        res.status(429).json(QUOTA_EXCEEDED);
        return;
      case "unavailable":
        log(`species identify: upstream unavailable (${outcome.reason})`);
        res.status(503).json(IDENTIFY_UNAVAILABLE);
        return;
    }
  };
}
