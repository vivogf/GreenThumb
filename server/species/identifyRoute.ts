import type { Request, Response } from "express";
import { parseIdentifyBody } from "./identifyInput";
import { identifyWithPlantNet, type IdentifyOutcome, type PlantNetOptions } from "./plantnet";
import { plantNetLimits, remainingAfter, utcDay, type UsageCounter, type UsageStore } from "./usage";
import type { IdentifyImage, IdentifyLang } from "./identifyInput";

export interface IdentifyDeps {
  /** reserve/release plus the reads that report what is left after a refund. */
  store: UsageStore & Pick<UsageCounter, "usageCount" | "usageTotal">;
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
    const ref = { day, userId: String(userId), kind: "identify" as const };
    /**
     * Gives the reservation back: the call produced no recognition (no match, upstream quota, upstream failure).
     * Returns what is left for today, read from the counter after the refund — if the refund failed the
     * reservation stays charged, and promising a check the database still counts would be a lie.
     */
    const refund = async (): Promise<number> => {
      try {
        await deps.store.release(ref);
        const [userCount, globalCount] = await Promise.all([
          deps.store.usageCount(day, ref.userId, "identify"),
          deps.store.usageTotal(day, "identify"),
        ]);
        return remainingAfter({ userCount, globalCount }, limits);
      } catch (err: any) {
        log(`species identify: release failed (${err?.name ?? "Error"})`);
        return remainingAfter(reservation, limits);
      }
    };
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
          res.json({ results: [], remainingToday: await refund() });
          return;
        }
        res.json({ results: outcome.results, remainingToday: remainingAfter(reservation, limits) });
        return;
      }
      case "quota":
        // Pl@ntNet's own daily quota, not this user's: the reservation went back, so answering 429 «Daily
        // identification limit reached» would contradict the account's real state.
        log("species identify: upstream quota exhausted (429)");
        await refund();
        res.status(503).json(IDENTIFY_UNAVAILABLE);
        return;
      case "unavailable":
        log(`species identify: upstream unavailable (${outcome.reason})`);
        await refund();
        res.status(503).json(IDENTIFY_UNAVAILABLE);
        return;
    }
  };
}
