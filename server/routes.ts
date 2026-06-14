import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema } from "@shared/schema";
import webpush from "web-push";
import { Expo } from "expo-server-sdk";
import { addDays, isToday, isBefore, startOfDay } from "date-fns";

const expo = new Expo();

// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:greenthumb@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes - anonymous UUID-based authentication
  app.post("/api/auth/create-anonymous", async (req: Request, res) => {
    try {
      const { name } = req.body;

      const user = await storage.createAnonymousUser(name);

      req.session.userId = user.id;

      res.json({ user });
    } catch (error: any) {
      console.error("Create anonymous user error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", (req: Request, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({ user });
  });

  // Login with recovery key
  app.post("/api/auth/login-recovery", async (req: Request, res) => {
    try {
      const { recoveryKey } = req.body;

      if (!recoveryKey || typeof recoveryKey !== 'string') {
        return res.status(400).json({ error: "Recovery key is required" });
      }

      const user = await storage.getUserByRecoveryKey(recoveryKey.trim());
      if (!user) {
        return res.status(401).json({ error: "Invalid recovery key" });
      }

      req.session.userId = user.id;

      res.json({ user });
    } catch (error: any) {
      console.error("Recovery login error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Regenerate recovery key
  app.post("/api/auth/regenerate-recovery-key", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;

      const user = await storage.regenerateRecoveryKey(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error: any) {
      console.error("Regenerate recovery key error:", error);
      res.status(400).json({ error: error.message });
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

      const user = await storage.updateUserTimezone(userId, timezone);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error: any) {
      console.error("Error updating timezone:", error);
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

      const user = await storage.updateUserNotificationTime(userId, normalizedTime);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error: any) {
      console.error("Error updating notification time:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Plant routes (protected)
  app.post("/api/plants", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const plantData = insertPlantSchema.parse(req.body);
      const plantWithUser = { ...plantData, user_id: String(userId) };
      const result = await storage.addPlant(plantWithUser);
      res.json(result);
    } catch (error: any) {
      console.error("Error adding plant:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/plants", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const userPlants = await storage.getPlantsByUserId(String(userId));
      res.json(userPlants);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      const plant = await storage.updatePlant(req.params.id, req.body);
      res.json(plant);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      await storage.deletePlant(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Mass actions for plants
  app.post("/api/plants/water-all", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const userPlants = await storage.getPlantsByUserId(String(userId));
      const today = startOfDay(new Date());
      
      // Find plants that need watering (overdue or due today)
      const plantsNeedingWater = userPlants.filter((plant) => {
        const lastWatered = startOfDay(new Date(plant.last_watered_date));
        const nextWateringDate = addDays(lastWatered, plant.water_frequency_days);
        return nextWateringDate <= today;
      });
      
      // Water all plants that need it
      await Promise.all(
        plantsNeedingWater.map((plant) =>
          storage.updatePlant(plant.id, {
            last_watered_date: toDateString(new Date()),
          })
        )
      );
      
      res.json({ success: true, count: plantsNeedingWater.length });
    } catch (error: any) {
      console.error("Error watering all plants:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/plants/postpone-all", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const userPlants = await storage.getPlantsByUserId(String(userId));
      const today = startOfDay(new Date());
      
      // Find plants that need watering (overdue or due today)
      const plantsNeedingWater = userPlants.filter((plant) => {
        const lastWatered = startOfDay(new Date(plant.last_watered_date));
        const nextWateringDate = addDays(lastWatered, plant.water_frequency_days);
        return nextWateringDate <= today;
      });
      
      // Postpone by setting last_watered_date to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      await Promise.all(
        plantsNeedingWater.map((plant) =>
          storage.updatePlant(plant.id, {
            last_watered_date: toDateString(yesterday),
          })
        )
      );
      
      res.json({ success: true, count: plantsNeedingWater.length });
    } catch (error: any) {
      console.error("Error postponing all plants:", error);
      res.status(400).json({ error: error.message });
    }
  });

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
      console.error("Push subscribe error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/push/subscribe", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deletePushSubscription(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Push unsubscribe error:", error);
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
      console.error("Expo subscribe error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/push/subscribe-expo", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteExpoPushSubscription(userId);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Expo unsubscribe error:", error);
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
      console.error("Test notification error:", error);
      // 410 Gone or 404 = subscription expired/invalid, 401/403 = VAPID mismatch
      if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 401 || error.statusCode === 403) {
        await storage.deletePushSubscription(userId);
        return res.status(400).json({ error: "subscription_expired" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // Check plants and send notifications (protected with API key for cron jobs)
    /**
   * Format a notification body line for the count of plants needing care.
   * Russian uses 3-form pluralization; English uses singular/plural.
   */
  function plantCountText(count: number, lang: 'ru' | 'en' = 'ru'): string {
    if (lang === 'en') {
      return `${count} ${count === 1 ? 'plant' : 'plants'} need your attention 🌿`;
    }
    const mod10 = count % 10;
    const mod100 = count % 100;
    let word: string;
    if (mod10 === 1 && mod100 !== 11) word = 'растение';
    else if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) word = 'растения';
    else word = 'растений';
    return `${count} ${word} ждут вашего внимания 🌿`;
  }

  function notifTitle(lang: 'ru' | 'en' = 'ru'): string {
    return lang === 'en' ? 'Your plants need care 💚' : 'Ваши цветочки ждут заботы 💚';
  }
  /**
   * Compute current local hour/minute in the given IANA timezone.
   * Falls back to Moscow (UTC+3) on unknown tz so legacy users without a
   * `timezone` row keep the previous behavior.
   */
  function localNowInTz(timezone: string | null | undefined): { hour: number; minute: number } {
    const tz = timezone || 'Europe/Moscow';
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(now);
      return {
        hour: parseInt(parts.find(p => p.type === 'hour')!.value, 10),
        minute: parseInt(parts.find(p => p.type === 'minute')!.value, 10),
      };
    } catch {
      // Bad timezone string — pretend MSK.
      return {
        hour: (now.getUTCHours() + 3) % 24,
        minute: now.getUTCMinutes(),
      };
    }
  }

  /**
   * Check if user's notification_time (HH:MM in their local tz) falls within
   * the last `windowMinutes` before "now in their tz". Half-open window
   * (windowStart, now] — see Apr 28 changelog for why both-side-inclusive
   * caused the 09:00 + 09:05 duplicate-push bug.
   *
   * windowMinutes MUST equal the crontab interval. We run the check-plants
   * cron HOURLY ("0 * * * *"), not every 5 min, to keep Neon Free's compute
   * time under the 100 CU-hr/mo quota: a 5-minute cron never lets the compute
   * autosuspend (~180 CU-hr/mo), an hourly tick keeps it near ~15 CU-hr/mo.
   * With an hourly tick the 60-min half-open windows tile the day exactly, so
   * every user is matched once — at the first top-of-hour >= their
   * notification_time. Trade-off: reminders land on the hour (a 09:30 user is
   * notified at 10:00). If you ever change the crontab interval, change this
   * default to match it or users will be missed / double-notified.
   */
  function isInNotificationWindow(
    userTime: string | null | undefined,
    timezone: string | null | undefined,
    windowMinutes = 60,
  ): boolean {
    if (!userTime) return false;
    const match = userTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;
    const userMinutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);

    const { hour, minute } = localNowInTz(timezone);
    const localNowMinutes = (hour * 60 + minute) % 1440;
    const windowStart = localNowMinutes - windowMinutes;

    if (windowStart < 0) {
      // Window crosses midnight (e.g. now=00:02, window=(23:57, 00:02])
      return userMinutes > windowStart + 1440 || userMinutes <= localNowMinutes;
    }
    return userMinutes > windowStart && userMinutes <= localNowMinutes;
  }

  /**
   * "Today" date string YYYY-MM-DD in the user's local timezone.
   * Falls back to Moscow on unknown/missing tz. Used for per-user daily dedup.
   */
  function todayDateInTz(timezone: string | null | undefined): string {
    const tz = timezone || 'Europe/Moscow';
    try {
      // 'en-CA' formats dates as YYYY-MM-DD by default, no manual parsing.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      const now = new Date();
      const mskMs = now.getTime() + 3 * 60 * 60 * 1000;
      const msk = new Date(mskMs);
      const y = msk.getUTCFullYear();
      const m = String(msk.getUTCMonth() + 1).padStart(2, '0');
      const d = String(msk.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  app.post("/api/push/check-plants", async (req: Request, res) => {
    // Require either authentication or a secret API key
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.PUSH_CHECK_API_KEY || process.env.SESSION_SECRET;
    
    if (!req.session?.userId && apiKey !== expectedKey) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      // Use the slim variant (no photo_url) — the photo is base64 in the row
      // and pulling it every 5 minutes is what blew Neon's monthly transfer
      // quota in April 2026.
      const plants = await storage.getAllPlantsForCron();
      const subscriptions = await storage.getAllPushSubscriptions();
      const users = await storage.getAllUsers();
      const expoSubs = await storage.getAllExpoPushSubscriptions();
      const expoUserIds = new Set(expoSubs.map(s => s.user_id));
      const today = startOfDay(new Date());

      const notificationsSent: string[] = [];

      // Users we successfully pushed to in this run — at the end we persist
      // last_notified_date so the next hourly cron tick (and the rest of
      // today's ticks) skip them.
      const notifiedUserIds = new Set<number>();

      for (const subscription of subscriptions) {
        const user = users.find(u => u.id === subscription.user_id);
        if (!isInNotificationWindow(user?.notification_time, user?.timezone)) continue;
        if (expoUserIds.has(subscription.user_id)) continue;
        const userTodayStr = todayDateInTz(user?.timezone);
        if (user?.last_notified_date === userTodayStr) continue;
        const userPlants = plants.filter(p => p.user_id === String(subscription.user_id));
        
        const careNeeded: { water: string[]; fertilize: string[]; repot: string[]; prune: string[] } = {
          water: [],
          fertilize: [],
          repot: [],
          prune: [],
        };
        
        for (const plant of userPlants) {
          // Check watering
          const lastWatered = new Date(plant.last_watered_date);
          const nextWaterDate = addDays(lastWatered, plant.water_frequency_days);
          if (isToday(nextWaterDate) || isBefore(nextWaterDate, today)) {
            careNeeded.water.push(plant.name);
          }
          
          // Check fertilizing
          if (plant.fertilize_frequency_days && plant.last_fertilized_date) {
            const lastFertilized = new Date(plant.last_fertilized_date);
            const nextFertilizeDate = addDays(lastFertilized, plant.fertilize_frequency_days);
            if (isToday(nextFertilizeDate) || isBefore(nextFertilizeDate, today)) {
              careNeeded.fertilize.push(plant.name);
            }
          }
          
          // Check repotting (uses months)
          if (plant.repot_frequency_months && plant.last_repotted_date) {
            const lastRepotted = new Date(plant.last_repotted_date);
            const nextRepotDate = new Date(lastRepotted);
            nextRepotDate.setMonth(nextRepotDate.getMonth() + plant.repot_frequency_months);
            if (isToday(nextRepotDate) || isBefore(startOfDay(nextRepotDate), today)) {
              careNeeded.repot.push(plant.name);
            }
          }
          
          // Check pruning (uses months)
          if (plant.prune_frequency_months && plant.last_pruned_date) {
            const lastPruned = new Date(plant.last_pruned_date);
            const nextPruneDate = new Date(lastPruned);
            nextPruneDate.setMonth(nextPruneDate.getMonth() + plant.prune_frequency_months);
            if (isToday(nextPruneDate) || isBefore(startOfDay(nextPruneDate), today)) {
              careNeeded.prune.push(plant.name);
            }
          }
        }
        
        // Unique plant names that need any kind of care today.
        const plantsNeedingCare = new Set<string>([
          ...careNeeded.water,
          ...careNeeded.fertilize,
          ...careNeeded.repot,
          ...careNeeded.prune,
        ]);

        if (plantsNeedingCare.size > 0) {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          };

          // Localize title + body using the per-subscription language column.
          // Existing rows default to 'ru' (see schema), so this is zero-regression.
          const lang: 'ru' | 'en' = subscription.language === 'en' ? 'en' : 'ru';
          const body = plantCountText(plantsNeedingCare.size, lang);

          try {
            await webpush.sendNotification(
              pushSubscription,
              JSON.stringify({
                title: notifTitle(lang),
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
            console.error(`Failed to send notification to user ${subscription.user_id}:`, err);
            // Remove invalid subscriptions
            if (err.statusCode === 410) {
              await storage.deletePushSubscription(subscription.user_id);
            }
          }
        }
      }

      // Also send Expo push notifications to mobile subscribers.
      const expoMessages: Parameters<typeof expo.sendPushNotificationsAsync>[0] = [];
      // Parallel array so we can map send results back to user_ids for marking.
      const expoMessageUserIds: number[] = [];

      for (const sub of expoSubs) {
        if (!Expo.isExpoPushToken(sub.expo_push_token)) continue;

        const user = users.find(u => u.id === sub.user_id);
        if (!isInNotificationWindow(user?.notification_time, user?.timezone)) continue;
        const userTodayStr = todayDateInTz(user?.timezone);
        if (user?.last_notified_date === userTodayStr) continue;

        const userPlants = plants.filter(p => p.user_id === String(sub.user_id));
        const careParts: string[] = [];

        for (const plant of userPlants) {
          const lastWatered = new Date(plant.last_watered_date);
          const nextWaterDate = addDays(lastWatered, plant.water_frequency_days);
          if (isToday(nextWaterDate) || isBefore(nextWaterDate, today)) {
            careParts.push(`💧 ${plant.name}`);
          }
          if (plant.fertilize_frequency_days && plant.last_fertilized_date) {
            const nextDate = addDays(new Date(plant.last_fertilized_date), plant.fertilize_frequency_days);
            if (isToday(nextDate) || isBefore(nextDate, today)) careParts.push(`🌿 ${plant.name}`);
          }
          if (plant.repot_frequency_months && plant.last_repotted_date) {
            const nextDate = new Date(plant.last_repotted_date);
            nextDate.setMonth(nextDate.getMonth() + plant.repot_frequency_months);
            if (isToday(nextDate) || isBefore(startOfDay(nextDate), today)) careParts.push(`🪴 ${plant.name}`);
          }
          if (plant.prune_frequency_months && plant.last_pruned_date) {
            const nextDate = new Date(plant.last_pruned_date);
            nextDate.setMonth(nextDate.getMonth() + plant.prune_frequency_months);
            if (isToday(nextDate) || isBefore(startOfDay(nextDate), today)) careParts.push(`✂️ ${plant.name}`);
          }
        }

        if (careParts.length > 0) {
          const plantsNeedingCare = new Set(
            careParts.map(p => p.replace(/^[^\s]+\s+/, ''))
          );
          const lang: 'ru' | 'en' = sub.language === 'en' ? 'en' : 'ru';
          expoMessages.push({
            to: sub.expo_push_token,
            sound: 'default',
            title: notifTitle(lang),
            body: plantCountText(plantsNeedingCare.size, lang),
          });
          expoMessageUserIds.push(sub.user_id);
        }
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
                console.error(`Expo push error for token ${chunk[i].to}:`, ticket.message);
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
            console.error('Expo chunk send error:', err);
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
          const user = users.find(u => u.id === userId);
          await storage.markUserNotified(userId, todayDateInTz(user?.timezone));
        } catch (err) {
          console.error(`Failed to mark user ${userId} as notified:`, err);
        }
      }

      res.json({ success: true, notificationsSent, marked: notifiedUserIds.size });
    } catch (error: any) {
      console.error("Check plants error:", error);
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
