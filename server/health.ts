import { readFile } from "node:fs/promises";
import type { Request, Response } from "express";

export const DEFAULT_REVISION_FILE = "/var/www/greenthumb/REVISION";
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface HealthBody {
  ok: true;
  db: boolean;
  revision: string;
}

export interface HealthDeps {
  pingDb: () => Promise<unknown>;
  readRevision: () => Promise<string>;
  timeoutMs?: number;
}

// Only a hex SHA is ever returned, so a wrong file can never leak its content.
export async function readRevision(
  file: string,
  read: (path: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<string> {
  try {
    const value = (await read(file)).trim();
    return SHA_PATTERN.test(value) ? value : "dev";
  } catch {
    return "dev";
  }
}

async function dbReachable(ping: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([ping().then(() => true as const), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(deps: HealthDeps): Promise<{ status: number; body: HealthBody }> {
  const [db, revision] = await Promise.all([
    dbReachable(deps.pingDb, deps.timeoutMs ?? 3000),
    deps.readRevision(),
  ]);
  return { status: db ? 200 : 503, body: { ok: true, db, revision } };
}

export function createHealthHandler(deps: HealthDeps) {
  return async (_req: Request, res: Response) => {
    const { status, body } = await getHealth(deps);
    res.set("Cache-Control", "no-store");
    res.status(status).json(body);
  };
}
