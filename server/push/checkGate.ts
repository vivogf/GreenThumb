import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

export type PushCheckGateResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; body: { error: string } };

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Decides whether a check-plants request may run. Only the X-API-Key header
 * counts; a session cookie grants nothing. An empty or missing configured key
 * fails closed, so a misconfigured server never runs the cron for anyone.
 */
export function checkPushApiKey(
  configuredKey: string | undefined,
  headerValue: string | string[] | undefined,
): PushCheckGateResult {
  if (!configuredKey) {
    return { ok: false, status: 503, body: { error: "Push check is not configured" } };
  }
  const provided = typeof headerValue === "string" ? headerValue : "";
  // Comparing fixed-length digests keeps timingSafeEqual from throwing on a
  // length mismatch and hides the key length.
  if (!provided || !timingSafeEqual(digest(provided), digest(configuredKey))) {
    return { ok: false, status: 401, body: { error: "Invalid API key" } };
  }
  return { ok: true };
}

export function createPushCheckGate(
  readKey: () => string | undefined = () => process.env.PUSH_CHECK_API_KEY,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = checkPushApiKey(readKey(), req.headers["x-api-key"]);
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    next();
  };
}
