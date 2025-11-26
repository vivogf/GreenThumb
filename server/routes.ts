import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema, registerSchema, loginSchema } from "@shared/schema";
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
  // Auth routes
  app.post("/api/auth/register", async (req: Request, res) => {
    try {
      const data = registerSchema.parse(req.body);
      
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }
      
      const user = await storage.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        name: data.name || null,
      });
      
      req.session.userId = user.id;
      
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.validatePassword(data.email, data.password);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      
      req.session.userId = user.id;
      
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error: any) {
      console.error("Login error:", error);
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
    
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
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
      
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
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
          title: "GreenThumb Test",
          body: "Push notifications are working!",
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
      const today = startOfDay(new Date());
      
      const notificationsSent: string[] = [];
      
      for (const subscription of subscriptions) {
        const userPlants = plants.filter(p => p.user_id === String(subscription.user_id));
        const plantsNeedingWater: string[] = [];
        
        for (const plant of userPlants) {
          const lastWatered = new Date(plant.last_watered_date);
          const nextWaterDate = addDays(lastWatered, plant.water_frequency_days);
          
          if (isToday(nextWaterDate) || isBefore(nextWaterDate, today)) {
            plantsNeedingWater.push(plant.name);
          }
        }
        
        if (plantsNeedingWater.length > 0) {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          };
          
          const message = plantsNeedingWater.length === 1
            ? `Time to water ${plantsNeedingWater[0]}!`
            : `${plantsNeedingWater.length} plants need watering: ${plantsNeedingWater.join(", ")}`;
          
          try {
            await webpush.sendNotification(pushSubscription, message);
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
