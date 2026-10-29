import type { Express, Request, RequestHandler, Response } from "express";
import type { SeasonMode } from "@shared/season/rule";
import { createLoginRecoveryHandler, normalizeRecoveryKey, type LoginRecoveryStore } from "./loginRecovery";
import { parseSeasonModeBody } from "./seasonMode";
import { toPublicUser, type PublicUser } from "./publicUser";
import { generateRecoveryKey, hashRecoveryKey } from "./recoveryKey";
import { logError } from "../logError";

export interface UserRoutesStore extends LoginRecoveryStore {
  /** Stores only the hash of the key just issued. */
  createAnonymousUser(name: string | undefined, keyHash: string): Promise<PublicUser>;
  getUserById(id: number): Promise<PublicUser | null>;
  /** Writes only the pending hash; the current key and the sessions stay. */
  setPendingRecoveryKey(userId: number, pendingHash: string): Promise<PublicUser | null>;
  updateUserTimezone(userId: number, timezone: string): Promise<PublicUser | null>;
  updateUserNotificationTime(userId: number, notificationTime: string): Promise<PublicUser | null>;
  updateUserSeasonMode(userId: number, seasonMode: SeasonMode): Promise<PublicUser | null>;
}

export type UserRoutesDeps = { store: UserRoutesStore; requireAuth: RequestHandler; log?: (line: string) => void };

/** Create's response: the key just issued, in user.recovery_key, never stored by a cache (nor by the database). */
function sendNewKey(res: Response, user: PublicUser, key: string) {
  res.set("Cache-Control", "no-store").json({ user: { ...toPublicUser(user), recovery_key: key } });
}

function keyRouteError(res: Response, label: string, error: unknown) {
  logError(label, error);
  res.status(500).set("Cache-Control", "no-store").json({ error: "Internal server error" });
}

/**
 * The account routes that answer with a user object. Every answer is toPublicUser(...).
 * Only two answers carry a key, both generated here in Node: create in user.recovery_key,
 * regenerate in pending_recovery_key (outside user: it is not the current key yet). The store
 * gets the hash only; after either answer the plaintext key exists nowhere on the server.
 */
export function registerUserRoutes(app: Express, deps: UserRoutesDeps): void {
  const requireAuth = deps.requireAuth;
  // Auth routes - anonymous UUID-based authentication
  app.post("/api/auth/create-anonymous", async (req: Request, res) => {
    try {
      const { name } = req.body;
      const recoveryKey = generateRecoveryKey();

      const user = await deps.store.createAnonymousUser(name, recoveryKey.hash);

      req.session.userId = user.id;

      sendNewKey(res, user, recoveryKey.key);
    } catch (error) {
      keyRouteError(res, "Create anonymous user error", error);
    }
  });

  app.get("/api/auth/me", async (req: Request, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const user = await deps.store.getUserById(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      res.json({ user: toPublicUser(user) });
    } catch (error) {
      // A store failure is not "signed out": 401 here would send the client to the login screen.
      logError("Get current user error", error);
      res.status(503).json({ error: "Service unavailable" });
    }
  });

  // Login with recovery key
  app.post("/api/auth/login-recovery", createLoginRecoveryHandler({ store: deps.store, log: deps.log }));

  // Two-phase key rotation, step 1: issue a pending key. The current key and every session keep
  // working until the pending key is confirmed (or used to sign in). A repeat overwrites the pending key.
  app.post("/api/auth/regenerate-recovery-key", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const recoveryKey = generateRecoveryKey();

      const user = await deps.store.setPendingRecoveryKey(userId, recoveryKey.hash);
      if (!user) {
        return res.status(404).set("Cache-Control", "no-store").json({ error: "User not found" });
      }

      res.set("Cache-Control", "no-store").json({ user: toPublicUser(user), pending_recovery_key: recoveryKey.key });
    } catch (error) {
      keyRouteError(res, "Regenerate recovery key error", error);
    }
  });

  // Step 2: the client saved the pending key; promote it. 200 committed (other sessions deleted) /
  // 200 already_current (no side effects) / 409 not_pending (nothing changed). Never 401 for a key
  // mismatch: 401 means only "no session", and a 401 makes the KMP app erase its stored key.
  app.post("/api/auth/confirm-recovery-key", requireAuth, async (req: Request, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const raw = req.body?.recoveryKey;
      const key = typeof raw === "string" ? normalizeRecoveryKey(raw) : null;
      if (!key) {
        return res.status(400).json({ error: "Invalid recovery key" });
      }

      const result = await deps.store.commitPendingRecoveryKey(req.session.userId!, hashRecoveryKey(key), req.sessionID);
      switch (result.status) {
        case "committed":
        case "already_current":
          return res.json({ user: toPublicUser(result.user), status: result.status });
        case "not_pending":
          return res.status(409).json({ code: "not_pending" });
        case "not_found":
          return res.status(404).json({ error: "User not found" });
      }
    } catch (error) {
      logError("Confirm recovery key error", error);
      res.status(503).json({ error: "Service unavailable" });
    }
  });

  app.patch("/api/auth/update-timezone", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const { timezone } = req.body;

      if (!timezone || typeof timezone !== 'string' || timezone.length > 64) {
        return res.status(400).json({ error: "Invalid timezone" });
      }

      // Validate the IANA tz string by trying to format with it.
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      } catch {
        return res.status(400).json({ error: "Unknown IANA timezone" });
      }

      const user = await deps.store.updateUserTimezone(userId, timezone);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user: toPublicUser(user) });
    } catch (error: any) {
      logError("Error updating timezone", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/auth/update-notification-time", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const { notification_time } = req.body;

      if (!notification_time || typeof notification_time !== 'string') {
        return res.status(400).json({ error: "Invalid notification time" });
      }

      // Validate time format HH:MM
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(notification_time)) {
        return res.status(400).json({ error: "Invalid time format. Use HH:MM (e.g., 09:00)" });
      }

      // Reminders are whole-hour only: the cron runs hourly (see
      // isInNotificationWindow) so a sub-hour time would silently fire on the
      // next hour boundary anyway. Normalize minutes to :00 here so even a
      // legacy client that still sends HH:MM stores a clean whole-hour value.
      const normalizedTime = `${notification_time.slice(0, 2)}:00`;

      const user = await deps.store.updateUserNotificationTime(userId, normalizedTime);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user: toPublicUser(user) });
    } catch (error: any) {
      logError("Error updating notification time", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/auth/update-season-mode", requireAuth, async (req: Request, res) => {
    try {
      const parsed = parseSeasonModeBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const user = await deps.store.updateUserSeasonMode(req.session.userId!, parsed.mode);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      logError("Error updating season mode", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
