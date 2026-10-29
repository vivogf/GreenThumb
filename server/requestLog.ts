import type { NextFunction, Request, Response } from "express";

/**
 * Per-request log line for /api paths: method, path, status, duration — nothing else.
 * Response bodies carry account ids, names and recovery keys, and query strings may
 * carry secrets, so neither is logged (req.path has no query string).
 */
export function createRequestLogger(log: (line: string) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      if (path.startsWith("/api")) {
        log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
      }
    });

    next();
  };
}
