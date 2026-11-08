import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { PLANT_NOT_FOUND, isPlantId, requireOwnedPlant } from "./plants/ownership";
import { parsePlantPatch } from "./plants/plantInput";
import { createPlantCreateHandler } from "./plants/createRoute";
import { createPushCheckGate } from "./push/checkGate";
import { getPhotoRuntime } from "./photos/store";
import { keyForPhotoUrl } from "./photos/keys";
import { preparePhotoChange, removePhotoObjects } from "./photos/photoChange";
import { createIdentifyHandler } from "./species/identifyRoute";
import { createJournalHandlers } from "./journal/eventsRoute";
import { createTimelineHandlers } from "./journal/photosRoute";
import { createDiagnoseHandler } from "./diagnosis/route";
import { createDiagnosisProvider } from "./diagnosis/provider";
import { createStandaloneDiagnoseHandler } from "./diagnosis/standaloneRoute";
import { createProgressHandler } from "./progress/route";
import { addDaysToDateString } from "@shared/care/userDate";
import { plantsDueForWatering, userToday } from "./care/schedule";
import { indexReminderData, reminderEligible, reminderFor } from "./push/reminders";
import { notifTitle, plantCountText } from "./push/text";
import { configureVapid } from "./push/vapid";
import { registerUserRoutes } from "./auth/userRoutes";
import webpush from "web-push";
import { Expo } from "expo-server-sdk";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { logError } from "./logError";

const expo = new Expo();

// FCM (firebase-admin) — used by the cron to deliver care reminders to the
// KMP app subscribers via FCM HTTP v1. Credentials come from a service
// account JSON stored in FIREBASE_SERVICE_ACCOUNT_JSON (single env var, no
// extra file on the VPS). If it is not configured the FCM cron branch is
// skipped with a log line — web push and Expo push keep working unchanged.
let fcmApp: App | null = null;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    fcmApp = getApps().find(a => a.name === "greenthumb-fcm") ?? initializeApp(
      { credential: cert(JSON.parse(serviceAccountJson)) },
      "greenthumb-fcm",
    );
  } else {
    console.log("FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM cron branch disabled");
  }
} catch (err) {
  // A malformed JSON env var must not take the whole server down.
  // A JSON.parse message quotes the input, i.e. a piece of the service-account key.
  logError("Failed to initialize firebase-admin (FCM disabled)", err);
  fcmApp = null;
}

function fcmMessaging(): Messaging | null {
  return fcmApp ? getMessaging(fcmApp) : null;
}

configureVapid(process.env, (subject, publicKey, privateKey) => webpush.setVapidDetails(subject, publicKey, privateKey));

// Resolve with `null` if `p` hasn't settled within `ms`. A rejection still
// surfaces (Promise.allSettled swallows it) — the cap only trims a hung
// promise so the cron tick never outlasts the next hourly one. firebase-admin
// has its own 15 s HTTP timeout on FCM sends, so this is belt-and-suspenders.
function withDeadlineCap(p: Promise<unknown>, ms: number): Promise<unknown | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Account routes that answer with a user: server/auth/userRoutes.ts.
  registerUserRoutes(app, { store: storage, requireAuth });

  app.post("/api/auth/logout", (req: Request, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ success: true });
    });
  });

  // Plant routes (protected). Per-plant routes answer the same 404 for a
  // foreign, missing or malformed id (architecture §1 invariant 2).
  const findOwnedPlant = (id: string, userId: number) => storage.getPlantForUser(id, userId);

  async function userTimezone(userId: number): Promise<string | null> {
    const user = await storage.getUserById(userId);
    return user?.timezone ?? null;
  }

  function plantRouteError(res: Response, label: string, error: unknown) {
    logError(label, error);
    res.status(500).json({ error: "Internal server error" });
  }

  function photoContext() {
    const runtime = getPhotoRuntime();
    return { store: runtime?.store ?? null, publicBaseUrl: runtime?.publicBaseUrl ?? null };
  }

  app.post("/api/plants", requireAuth, createPlantCreateHandler({
    store: storage,
    userTimezone,
    preparePhoto: (incoming) => preparePhotoChange(incoming, null, photoContext()),
    removePhotos: (keys) => removePhotoObjects(photoContext().store, keys),
    onError: plantRouteError,
  }));

  app.get("/api/plants", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const userPlants = await storage.getPlantsByUserId(String(userId));
      res.json(userPlants);
    } catch (error) {
      plantRouteError(res, "Error listing plants", error);
    }
  });

  app.patch("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      // Ownership first: a foreign id must not reveal anything through 400s.
      const owned = await requireOwnedPlant(findOwnedPlant, req.params.id, userId);
      if (!owned) {
        return res.status(404).json(PLANT_NOT_FOUND);
      }
      const parsed = parsePlantPatch(req.body, await userTimezone(userId));
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const photos = photoContext();
      const change = await preparePhotoChange(parsed.data.photo_url, owned.photo_url, photos);
      if (!change.ok) {
        return res.status(change.status).json({ error: change.error });
      }
      const patch = { ...parsed.data };
      if (change.photoUrl === undefined) delete patch.photo_url;
      else patch.photo_url = change.photoUrl;
      if (Object.keys(patch).length === 0) {
        return res.json(owned);
      }
      let plant;
      try {
        plant = await storage.updatePlantForUser(owned.id, userId, patch);
      } catch (error) {
        await removePhotoObjects(photos.store, [change.uploadedKey]);
        throw error;
      }
      if (!plant) {
        await removePhotoObjects(photos.store, [change.uploadedKey]);
        return res.status(404).json(PLANT_NOT_FOUND);
      }
      await removePhotoObjects(photos.store, [change.obsoleteKey]);
      res.json(plant);
    } catch (error) {
      plantRouteError(res, "Error updating plant", error);
    }
  });

  app.delete("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const id = req.params.id;
      const deleted = isPlantId(id) ? await storage.deletePlantForUser(id, userId) : null;
      if (!deleted) {
        return res.status(404).json(PLANT_NOT_FOUND);
      }
      const photos = photoContext();
      await removePhotoObjects(photos.store, [keyForPhotoUrl(deleted.photo_url, photos.publicBaseUrl), ...deleted.object_keys]);
      res.json({ success: true });
    } catch (error) {
      plantRouteError(res, "Error deleting plant", error);
    }
  });

  // Session is checked inside the handler, before any validation or provider call.
  app.post("/api/species/identify", createIdentifyHandler({ store: storage }));

  // Mass actions use the caller's local calendar date (users.timezone, NULL → Moscow).
  // Due selection is the seasonal rule in server/care/schedule.ts.
  async function setDuePlantsWatered(userId: number, dateFor: (today: string) => string, journal: boolean): Promise<number> {
    const user = await storage.getUserById(userId);
    const now = new Date();
    const userPlants = await storage.getPlantsByUserId(String(userId));
    const dueIds = plantsDueForWatering(userPlants, user, now).map((plant) => plant.id);
    return storage.setLastWateredForUser(dueIds, userId, dateFor(userToday(user, now)), journal);
  }

  app.post("/api/plants/water-all", requireAuth, async (req: Request, res) => {
    try {
      const count = await setDuePlantsWatered(req.session.userId!, (today) => today, true);
      res.json({ success: true, count });
    } catch (error) {
      plantRouteError(res, "Error watering all plants", error);
    }
  });

  app.post("/api/plants/postpone-all", requireAuth, async (req: Request, res) => {
    try {
      // Postpone = pretend the plant was watered yesterday (user-local). It is not care, so no journal event.
      const count = await setDuePlantsWatered(req.session.userId!, (today) => addDaysToDateString(today, -1), false);
      res.json({ success: true, count });
    } catch (error) {
      plantRouteError(res, "Error postponing all plants", error);
    }
  });

  // Care journal. Session and plant ownership are checked inside the handlers (404 for foreign plants).
  const journal = createJournalHandlers({ store: storage, userTimezone });
  app.get("/api/plants/:id/events", journal.list);
  app.post("/api/plants/:id/events", journal.createNote);
  app.delete("/api/plants/:id/events/:eventId", journal.remove);

  // Photo timeline. Same session/ownership rules as the journal; each photo carries one `photo` event.
  const timeline = createTimelineHandlers({ store: storage, userTimezone, photos: photoContext });
  app.get("/api/plants/:id/photos", timeline.list);
  app.post("/api/plants/:id/photos", timeline.create);
  app.delete("/api/plants/:id/photos/:photoId", timeline.remove);

  // AI diagnosis. Session, ownership, input, provider and daily limit are checked inside the handler, in that order.
  const diagnosisProvider = createDiagnosisProvider(process.env);
  console.log(diagnosisProvider ? `AI diagnosis: ${diagnosisProvider.name} (${diagnosisProvider.model})` : "AI diagnosis: disabled");
  app.post("/api/plants/:id/diagnose", createDiagnoseHandler({ store: storage, provider: () => diagnosisProvider }));
  // Plant-less diagnosis (smart camera): session, input, provider, shared daily limits; stores only the usage count.
  app.post("/api/diagnose", createStandaloneDiagnoseHandler({ store: storage, provider: () => diagnosisProvider }));

  // Streak and achievements of the session user; newly met achievements are stored once and never re-locked.
  app.get("/api/progress", createProgressHandler({ store: storage }));

  // Push notification routes
  app.post("/api/push/subscribe", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const { endpoint, keys, language } = req.body;

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }

      const lang = language === 'en' || language === 'ru' ? language : 'ru';

      const subscription = await storage.savePushSubscription({
        user_id: userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        language: lang,
      });

      res.json({ success: true, subscription });
    } catch (error: any) {
      console.error(`Push subscribe error for user ${req.session.userId}: ${error?.code ?? error?.name ?? "Error"}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/push/subscribe", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deletePushSubscription(userId);
      res.json({ success: true });
    } catch (error: any) {
      logError("Push unsubscribe error", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/push/subscription", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const subscription = await storage.getPushSubscriptionByUserId(userId);
      res.json({ subscribed: !!subscription });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Expo push subscription endpoints (mobile app)
  app.post("/api/push/subscribe-expo", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const { expo_push_token, language } = req.body;
      if (!expo_push_token || !Expo.isExpoPushToken(expo_push_token)) {
        return res.status(400).json({ error: "Invalid Expo push token" });
      }
      const lang = language === 'en' || language === 'ru' ? language : 'ru';
      await storage.saveExpoPushSubscription(userId, expo_push_token, lang);
      res.json({ ok: true });
    } catch (error: any) {
      console.error(`Expo subscribe error for user ${req.session.userId}: ${error?.code ?? error?.name ?? "Error"}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/push/subscribe-expo", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteExpoPushSubscription(userId);
      res.json({ ok: true });
    } catch (error: any) {
      logError("Expo unsubscribe error", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/push/expo-subscription", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const token = await storage.getExpoPushSubscriptionByUserId(userId);
      res.json({ subscribed: !!token });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // FCM push subscription endpoints (KMP app)
  app.post("/api/push/subscribe-fcm", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const { fcm_token, platform, language } = req.body;
      if (!fcm_token || typeof fcm_token !== 'string' || fcm_token.trim().length === 0) {
        return res.status(400).json({ error: "Invalid FCM token" });
      }
      if (platform !== undefined && platform !== 'android' && platform !== 'ios') {
        return res.status(400).json({ error: "Invalid platform" });
      }
      const lang = language === 'en' || language === 'ru' ? language : 'ru';
      await storage.saveFcmPushSubscription(userId, fcm_token.trim(), platform ?? 'android', lang);
      res.json({ ok: true });
    } catch (error: any) {
      console.error(`FCM subscribe error for user ${req.session.userId}: ${error?.code ?? error?.name ?? "Error"}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/push/subscribe-fcm", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteFcmPushSubscription(userId);
      res.json({ ok: true });
    } catch (error: any) {
      logError("FCM unsubscribe error", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/push/fcm-subscription", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const sub = await storage.getFcmPushSubscriptionByUserId(userId);
      res.json({ subscribed: !!sub });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete account (KMP app; Google Play requires in-app account deletion).
  // Wipes every row tied to the user (all of the user's sessions included),
  // then the user row itself. After a 200 every session is gone: the client's next
  // /api/auth/me with the old cookie gets 401, and login with the old
  // recovery key is impossible (the key was deleted with the row).
  app.delete("/api/auth/account", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const deleted = await storage.deleteAccountCascade(userId);
      const photos = photoContext();
      await removePhotoObjects(photos.store, [
        ...deleted.photo_urls.map((url) => keyForPhotoUrl(url, photos.publicBaseUrl)),
        ...deleted.object_keys,
      ]);
      req.session.destroy((err) => {
        if (err) {
          logError("Account deletion: session destroy failed", err);
          return res.status(500).json({ error: "Could not log out" });
        }
        res.json({ success: true });
      });
    } catch (error: any) {
      logError("Account deletion error", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/push/vapid-public-key", (req: Request, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  // Send test notification
  app.post("/api/push/test", requireAuth, async (req: Request, res) => {
    const userId = req.session.userId!;
    try {
      const subscription = await storage.getPushSubscriptionByUserId(userId);

      if (!subscription) {
        return res.status(400).json({ error: "no_subscription" });
      }

      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({
          title: "GreenThumb 💚",
          body: "Уведомления работают! 🌿",
        })
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error(`Test notification error for user ${userId}: ${error?.statusCode ?? error?.name ?? "Error"}`);
      // 410 Gone or 404 = subscription expired/invalid, 401/403 = VAPID mismatch
      if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 401 || error.statusCode === 403) {
        await storage.deletePushSubscription(userId);
        return res.status(400).json({ error: "subscription_expired" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // Check plants and send notifications (protected with API key for cron jobs)
  app.post("/api/push/check-plants", createPushCheckGate(), async (req: Request, res) => {
    try {
      // The slim variant (no photo_url): the cron needs only names and care dates.
      const plants = await storage.getAllPlantsForCron();
      const subscriptions = await storage.getAllPushSubscriptions();
      const users = await storage.getAllUsers();
      const expoSubs = await storage.getAllExpoPushSubscriptions();
      const expoUserIds = new Set(expoSubs.map(s => s.user_id));
      const fcmSubs = await storage.getAllFcmPushSubscriptions();
      const now = new Date();
      // Due plants for every channel come from server/care/schedule.ts through reminderFor.
      const reminderCtx = { ...indexReminderData(users, plants), now };
      const userById = reminderCtx.users;

      const notificationsSent: string[] = [];

      // Users we successfully pushed to in this run — at the end we persist
      // last_notified_date so the next hourly cron tick (and the rest of
      // today's ticks) skip them.
      const notifiedUserIds = new Set<number>();
      // FCM deliveries that succeeded in this tick. Kept separate until the
      // sends are awaited below, so a delivery failure never marks the user
      // (that would block the Expo fallback in the same tick).
      const fcmDoneUserIds = new Set<number>();
      // Promises of the fire-and-forget FCM sends, awaited (with a cap)
      // before the last_notified_date write below.
      const fcmSendPromises: Promise<void>[] = [];

      for (const subscription of subscriptions) {
        if (expoUserIds.has(subscription.user_id)) continue;
        const reminder = reminderFor(subscription, reminderCtx);
        if (!reminder) continue;

        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        };
        const body = plantCountText(reminder.count, reminder.lang);

        try {
          await webpush.sendNotification(
            pushSubscription,
            JSON.stringify({
              title: notifTitle(reminder.lang),
              body,
            }),
            {
              TTL: 86400,
              urgency: 'high',
              topic: 'plant-care',
            }
          );
          notificationsSent.push(`User ${subscription.user_id}: ${body}`);
          notifiedUserIds.add(subscription.user_id);
        } catch (err: any) {
          console.error(`Failed to send notification to user ${subscription.user_id}: ${err?.statusCode ?? err?.name ?? "Error"}`);
          // Remove invalid subscriptions
          if (err.statusCode === 410) {
            await storage.deletePushSubscription(subscription.user_id);
          }
        }
      }

      // Also send FCM push notifications to KMP app subscribers. Users with
      // BOTH an FCM and an Expo subscription get at most one reminder (FCM
      // wins, the Expo branch then skips them the same way the web branch does).
      const messaging = fcmMessaging();
      if (messaging) {
        const fcmSubsThisTick = fcmSubs.filter(sub => reminderEligible(userById.get(sub.user_id), now));

        // FCM tokens can be revoked (app uninstalled, token rotation, Play
        // Services cache reset). Stale tokens are cleaned up when FCM
        // reports them definitively dead (registration-token-not-registered
        // / invalid-registration-token / invalid-argument).
        for (const sub of fcmSubsThisTick) {
          try {
            const reminder = reminderFor(sub, reminderCtx);
            if (!reminder) continue;
            const body = plantCountText(reminder.count, reminder.lang);

            const fcmMessage = {
              token: sub.fcm_token,
              notification: {
                title: notifTitle(reminder.lang),
                body,
              },
              // Deep-link contract from the Expo app: tap → plant/{id}; the
              // KMP client reads data.plant_id the same way. The care
              // reminder is a dashboard-level nudge, so plant_id is
              // intentionally absent.
              android: {
                priority: 'high' as const,
              },
            };

            // Fire-and-forget per call (a hung HTTP call must not stall the
            // loop), but the promise is collected and awaited — with a cap —
            // before the last_notified_date write, so FCM-delivered users
            // actually get marked (dedup works) and the Expo branch below
            // can skip them in the same tick.
            fcmSendPromises.push(
              messaging
                .send(fcmMessage)
                .then(() => {
                  notificationsSent.push(`FCM user ${sub.user_id}: ${body}`);
                  notifiedUserIds.add(sub.user_id);
                  fcmDoneUserIds.add(sub.user_id);
                })
                .catch((err: any) => {
                  console.error(`FCM send error for user ${sub.user_id}: ${err?.errorInfo?.code || err?.code || err?.name || 'Error'}`);
                  const code = err?.errorInfo?.code || err?.code || '';
                  if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code === 'messaging/invalid-argument') {
                    storage.deleteFcmPushSubscription(sub.user_id).catch(e =>
                      logError(`Failed to delete stale FCM subscription for user ${sub.user_id}`, e)
                    );
                  }
                })
            );
          } catch (err: any) {
            // Body-building errors — log and move on to the next subscriber.
            logError(`FCM branch error for user ${sub.user_id}`, err);
          }
        }
        if (fcmSubsThisTick.length > 0) {
          notificationsSent.push(`FCM: ${fcmSubsThisTick.length} subscriber(s) queued`);
        }
        // Wait (capped) for the fire-and-forget sends above to settle, so the
        // delivered set is populated before the dedup write at the end of the
        // tick and before the Expo loop picks the skip-set up.
        await withDeadlineCap(Promise.allSettled(fcmSendPromises), 30000);
      }

      // Also send Expo push notifications to mobile subscribers.
      const expoMessages: Parameters<typeof expo.sendPushNotificationsAsync>[0] = [];
      // Parallel array so we can map send results back to user_ids for marking.
      const expoMessageUserIds: number[] = [];

      for (const sub of expoSubs) {
        if (!Expo.isExpoPushToken(sub.expo_push_token)) continue;
        if (fcmDoneUserIds.has(sub.user_id)) continue;
        const reminder = reminderFor(sub, reminderCtx);
        if (!reminder) continue;
        expoMessages.push({
          to: sub.expo_push_token,
          sound: 'default',
          title: notifTitle(reminder.lang),
          body: plantCountText(reminder.count, reminder.lang),
        });
        expoMessageUserIds.push(sub.user_id);
      }

      if (expoMessages.length > 0) {
        const chunks = expo.chunkPushNotifications(expoMessages);
        let cursor = 0;
        for (const chunk of chunks) {
          try {
            const tickets = await expo.sendPushNotificationsAsync(chunk);
            tickets.forEach((ticket, i) => {
              const userId = expoMessageUserIds[cursor + i];
              if (ticket.status === 'error') {
                console.error(`Expo push error for user ${userId}: ${ticket.details?.error ?? 'error'}`);
                if (ticket.details?.error === 'DeviceNotRegistered') {
                  // Token is invalid — clean up
                  const sub = expoSubs.find(s => s.expo_push_token === chunk[i].to);
                  if (sub) storage.deleteExpoPushSubscription(sub.user_id);
                }
              } else {
                notifiedUserIds.add(userId);
              }
            });
          } catch (err) {
            console.error(`Expo chunk send error: ${(err as any)?.code ?? (err as any)?.name ?? 'Error'}`);
            // Whole chunk failed — those users are NOT marked notified. With
            // the hourly window the next tick won't re-match them, so they
            // miss today's reminder (acceptable: transient Expo error).
          }
          cursor += chunk.length;
        }
        notificationsSent.push(`Expo: sent to ${expoMessages.length} mobile subscriber(s)`);
      }

      // Persist "notified today" flag in the *user's own* timezone so the
      // next hourly cron tick skips them for the rest of their local day.
      // Array.from avoids the TS2802 Set-iteration error under this tsconfig.
      for (const userId of Array.from(notifiedUserIds)) {
        try {
          await storage.markUserNotified(userId, userToday(userById.get(userId), now));
        } catch (err) {
          logError(`Failed to mark user ${userId} as notified`, err);
        }
      }

      if (fcmDoneUserIds.size > 0) {
        console.log(`FCM cron branch: ${fcmDoneUserIds.size} user(s) delivered this tick`);
      }

      res.json({ success: true, notificationsSent, marked: notifiedUserIds.size });
    } catch (error: any) {
      logError("Check plants error", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Catch-all for unknown /api/* — return 404 instead of letting Express fall
  // through to the SPA index.html. Without this, bot scanners hitting
  // /api/.env, /api/phpinfo.php etc. all see HTTP 200, which (a) wastes our
  // logs and (b) confuses sec-tooling about what's really exposed.
  app.all("/api/*", (req: Request, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
