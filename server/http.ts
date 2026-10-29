import express, { type NextFunction, type Request, type Response } from "express";
import { logError } from "./logError";

export const JSON_BODY_LIMIT = "12mb";
export const JSON_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

export const jsonBodyParser = express.json({
  limit: JSON_BODY_LIMIT,
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

export const urlencodedBodyParser = express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT });

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function jsonErrorHandler(err: any, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = Number(err?.status || err?.statusCode) || 500;

  if (err?.type === "entity.too.large" || status === 413) {
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: err?.expose && err?.message ? err.message : "Bad request" });
    return;
  }

  logError("Unhandled error", err);
  res.status(500).json({ error: "Internal Server Error" });
}
