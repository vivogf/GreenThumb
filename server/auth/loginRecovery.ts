import type { Request, Response } from "express";
import { errorLabel } from "../logError";
import { toPublicUser, type PublicUser } from "./publicUser";
import { hashRecoveryKey, type RecoveryKeyPair } from "./recoveryKey";

/** A login lookup hit; `pending` = the hash matched the pending key of a rotation, not the current one. */
export type RecoveryKeyHit = { user: PublicUser; pending: boolean };

/**
 * Result of promoting a pending key (confirm, or a login with the pending key):
 * committed = promoted, the user's other sessions deleted; already_current = it is the
 * current key, nothing changed; not_pending = neither (overwritten, rotated, never issued).
 */
export type CommitResult =
  | { status: "committed" | "already_current"; user: PublicUser }
  | { status: "not_pending" | "not_found" };

export interface LoginRecoveryStore {
  /** ONE query: the user whose current or pending hash is `hash`; a current match wins. */
  getUserByCurrentOrPendingKeyHash(hash: string): Promise<RecoveryKeyHit | null>;
  /** Stage-1 fallback by the plaintext column (canonical key); goes away with the column in stage 2. */
  getUserByRecoveryKey(canonicalKey: string): Promise<PublicUser | null>;
  /** Sets the hash only while recovery_key is still `canonicalKey`: a rotation meanwhile must not be undone. */
  setRecoveryKeyHash(userId: number, hash: string, canonicalKey: string): Promise<void>;
  /** One transaction: conditional promote of the pending key, then (only if promoted) delete sessions but keepSid. */
  commitPendingRecoveryKey(userId: number, key: RecoveryKeyPair, keepSid: string): Promise<CommitResult>;
}

export type LoginRecoveryDeps = { store: LoginRecoveryStore; log?: (line: string) => void };

/**
 * Canonical lowercase UUID for exactly the spellings Postgres uuid input accepts
 * (any case, one optional pair of braces, a hyphen allowed after any group of four
 * digits), after trimming whitespace. Anything else is null: not a recovery key.
 */
export function normalizeRecoveryKey(raw: string): string | null {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  if (!/^[0-9a-f]{4}(-?[0-9a-f]{4}){7}$/i.test(inner)) return null;
  const hex = inner.replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * POST /api/auth/login-recovery { recoveryKey } → { user } (public fields only).
 * One lookup by the current OR the pending hash. A pending hit promotes the key (the
 * same commit as confirm, keeping this request's session). On a miss, the plaintext
 * column, and a hit there repairs the hash (a miss of the hash alone must never become a 401).
 * Client contract: 400 = malformed key, 401 = no account with this key (only 401
 * lets the KMP app erase a saved key), 503 = store failure. Logs carry an error code
 * or the user id, never the key or its hash.
 */
export function createLoginRecoveryHandler(deps: LoginRecoveryDeps) {
  const log = deps.log ?? ((line: string) => console.warn(line));
  return async function loginRecovery(req: Request, res: Response) {
    try {
      const { recoveryKey } = req.body;

      if (!recoveryKey || typeof recoveryKey !== 'string') {
        return res.status(400).json({ error: "Recovery key is required" });
      }

      const key = normalizeRecoveryKey(recoveryKey);
      if (!key) {
        log("login-recovery: rejected (invalid_format)");
        return res.status(400).json({ error: "Invalid recovery key" });
      }

      const hash = hashRecoveryKey(key);
      const hit = await deps.store.getUserByCurrentOrPendingKeyHash(hash);
      let user: PublicUser | null = hit?.user ?? null;
      if (hit?.pending) {
        const result = await deps.store.commitPendingRecoveryKey(hit.user.id, { key, hash }, req.sessionID);
        if (result.status === "committed" || result.status === "already_current") {
          user = result.user;
          log(`login-recovery: pending key ${result.status} user=${user.id}`);
        } else {
          // Overwritten or rotated between the lookup and the commit: the plaintext check below decides.
          user = null;
        }
      }
      if (!user) {
        user = await deps.store.getUserByRecoveryKey(key);
        if (user) {
          log(`login-recovery: hash_miss user=${user.id}`);
          try {
            await deps.store.setRecoveryKeyHash(user.id, hash, key);
          } catch (error) {
            // The key is right; a failed repair must not cost the sign-in. The next login retries it.
            log(`login-recovery: hash repair failed user=${user.id} (${errorLabel(error)})`);
          }
        }
      }
      if (!user) {
        log("login-recovery: rejected (unknown_key)");
        return res.status(401).json({ error: "Invalid recovery key" });
      }

      req.session.userId = user.id;

      res.json({ user: toPublicUser(user) });
    } catch (error: any) {
      // A store failure is not a verdict on the key: 400/401 would make the KMP app erase it.
      log(`login-recovery: failed (${errorLabel(error)})`);
      res.status(503).json({ error: "Service unavailable" });
    }
  };
}
