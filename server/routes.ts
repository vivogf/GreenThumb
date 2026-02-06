import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema } from "@shared/schema";
import webpush from "web-push";
import { addDays, isToday, isBefore, startOfDay } from "date-fns";

// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:greenthumb@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
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

      const user = await storage.updateUserNotificationTime(userId, notification_time);
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
            last_watered_date: new Date().toISOString(),
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
            last_watered_date: yesterday.toISOString(),
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
      const { endpoint, keys } = req.body;
      
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }
      
      const subscription = await storage.savePushSubscription({
        user_id: userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
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

  app.get("/api/push/vapid-public-key", (req: Request, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  // Send test notification
  app.post("/api/push/test", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const subscription = await storage.getPushSubscriptionByUserId(userId);
      
      if (!subscription) {
        return res.status(400).json({ error: "No subscription found" });
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
      res.status(400).json({ error: error.message });
    }
  });

  // Check plants and send notifications (protected with API key for cron jobs)
  app.post("/api/push/check-plants", async (req: Request, res) => {
    // Require either authentication or a secret API key
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.PUSH_CHECK_API_KEY || process.env.SESSION_SECRET;
    
    if (!req.session?.userId && apiKey !== expectedKey) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const plants = await storage.getAllPlants();
      const subscriptions = await storage.getAllPushSubscriptions();
      const users = await storage.getAllUsers();
      const today = startOfDay(new Date());
      
      const notificationsSent: string[] = [];
      
      for (const subscription of subscriptions) {
        const user = users.find(u => u.id === subscription.user_id);
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
        
        // Build notification message
        const messages: string[] = [];
        
        if (careNeeded.water.length > 0) {
          messages.push(careNeeded.water.length === 1
            ? `Water: ${careNeeded.water[0]}`
            : `Water ${careNeeded.water.length} plants`);
        }
        if (careNeeded.fertilize.length > 0) {
          messages.push(careNeeded.fertilize.length === 1
            ? `Fertilize: ${careNeeded.fertilize[0]}`
            : `Fertilize ${careNeeded.fertilize.length} plants`);
        }
        if (careNeeded.repot.length > 0) {
          messages.push(careNeeded.repot.length === 1
            ? `Repot: ${careNeeded.repot[0]}`
            : `Repot ${careNeeded.repot.length} plants`);
        }
        if (careNeeded.prune.length > 0) {
          messages.push(careNeeded.prune.length === 1
            ? `Prune: ${careNeeded.prune[0]}`
            : `Prune ${careNeeded.prune.length} plants`);
        }
        
        if (messages.length > 0) {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          };
          
          const message = messages.join(" | ");

          try {
            await webpush.sendNotification(pushSubscription, JSON.stringify({
              title: "Ваши цветочки ждут заботы 💚",
              body: message,
            }));
            notificationsSent.push(`User ${subscription.user_id}: ${message}`);
          } catch (err: any) {
            console.error(`Failed to send notification to user ${subscription.user_id}:`, err);
            // Remove invalid subscriptions
            if (err.statusCode === 410) {
              await storage.deletePushSubscription(subscription.user_id);
            }
          }
        }
      }
      
      res.json({ success: true, notificationsSent });
    } catch (error: any) {
      console.error("Check plants error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
