import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { plants, users, pushSubscriptions, expoPushSubscriptions, fcmPushSubscriptions, type Plant, type User, type InsertUser, type PushSubscription, type InsertPushSubscription, type ExpoPushSubscription, type FcmPushSubscription } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PlantCreate, PlantPatch } from "./plants/plantInput";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export interface IStorage {
  // User methods
  createAnonymousUser(name?: string): Promise<User>;
  getUserById(id: number): Promise<User | null>;
  getUserByRecoveryKey(recoveryKey: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  updateUserNotificationTime(userId: number, notificationTime: string): Promise<User | null>;
  updateUserTimezone(userId: number, timezone: string): Promise<User | null>;
  markUserNotified(userId: number, date: string): Promise<void>;
  regenerateRecoveryKey(userId: number): Promise<User | null>;
  
  // Plant methods
  addPlant(plant: PlantCreate & { user_id: string }): Promise<Plant>;
  getPlantsByUserId(userId: string): Promise<Plant[]>;
  getPlantForUser(id: string, userId: number): Promise<Plant | null>;
  updatePlantForUser(id: string, userId: number, patch: PlantPatch): Promise<Plant | null>;
  /** Returns the deleted row's photo_url, or null when nothing was deleted. */
  deletePlantForUser(id: string, userId: number): Promise<{ photo_url: string } | null>;
  setLastWateredForUser(ids: string[], userId: number, date: string): Promise<number>;
  getAllPlants(): Promise<Plant[]>;
  // Same as getAllPlants() but excludes photo_url (base64 blob, ~50-200 KB per
  // row). Used by the check-plants cron in routes.ts where the photo isn't
  // needed — pulling it every 5 minutes blew through Neon's 5 GB/mo
  // data-transfer quota in late April 2026.
  getAllPlantsForCron(): Promise<Omit<Plant, 'photo_url' | 'notes' | 'created_at'>[]>;
  
  // Push subscription methods (web push)
  savePushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getPushSubscriptionByUserId(userId: number): Promise<PushSubscription | null>;
  deletePushSubscription(userId: number): Promise<void>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;

  // Expo push subscription methods (mobile)
  saveExpoPushSubscription(userId: number, token: string, language?: string): Promise<ExpoPushSubscription>;
  getExpoPushSubscriptionByUserId(userId: number): Promise<string | null>;
  deleteExpoPushSubscription(userId: number): Promise<void>;
  getAllExpoPushSubscriptions(): Promise<{ user_id: number; expo_push_token: string; language: string }[]>;

  // FCM push subscription methods (KMP app)
  saveFcmPushSubscription(userId: number, token: string, platform?: string, language?: string): Promise<FcmPushSubscription>;
  getFcmPushSubscriptionByUserId(userId: number): Promise<FcmPushSubscription | null>;
  deleteFcmPushSubscription(userId: number): Promise<void>;
  getAllFcmPushSubscriptions(): Promise<{ user_id: number; fcm_token: string; platform: string; language: string }[]>;

  // Account deletion (KMP app, Google Play requirement): removes every row
  // that belongs to the user in one transaction, then the user row itself.
  // Returns the photo_url values of the deleted plants so the caller can
  // remove their objects from photo storage after the commit.
  deleteAccountCascade(userId: number): Promise<string[]>;

  ping(): Promise<void>;
}

export class DbStorage implements IStorage {
  // User methods
  async createAnonymousUser(name?: string): Promise<User> {
    const [result] = await db
      .insert(users)
      .values({ name: name || null })
      .returning();
    return result;
  }

  async getUserById(id: number): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id));
    return user || null;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserNotificationTime(userId: number, notificationTime: string): Promise<User | null> {
    const [result] = await db
      .update(users)
      .set({ notification_time: notificationTime })
      .where(eq(users.id, userId))
      .returning();
    return result || null;
  }

  async updateUserTimezone(userId: number, timezone: string): Promise<User | null> {
    const [result] = await db
      .update(users)
      .set({ timezone })
      .where(eq(users.id, userId))
      .returning();
    return result || null;
  }

  async markUserNotified(userId: number, date: string): Promise<void> {
    await db
      .update(users)
      .set({ last_notified_date: date })
      .where(eq(users.id, userId));
  }

  async getUserByRecoveryKey(recoveryKey: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.recovery_key, recoveryKey));
    return user || null;
  }

  async regenerateRecoveryKey(userId: number): Promise<User | null> {
    const [result] = await db
      .update(users)
      .set({ recovery_key: crypto.randomUUID() })
      .where(eq(users.id, userId))
      .returning();
    return result || null;
  }

  // Plant methods
  async addPlant(plant: PlantCreate & { user_id: string }): Promise<Plant> {
    const [result] = await db.insert(plants).values(plant).returning();
    return result;
  }

  async getPlantsByUserId(userId: string): Promise<Plant[]> {
    return await db
      .select()
      .from(plants)
      .where(eq(plants.user_id, userId));
  }

  // Every per-plant read and write carries user_id in the WHERE clause, so a
  // route that forgets the ownership check still cannot touch another user's row.
  async getPlantForUser(id: string, userId: number): Promise<Plant | null> {
    const [plant] = await db
      .select()
      .from(plants)
      .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))));
    return plant || null;
  }

  async updatePlantForUser(id: string, userId: number, patch: PlantPatch): Promise<Plant | null> {
    const [result] = await db
      .update(plants)
      .set(patch)
      .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))))
      .returning();
    return result || null;
  }

  async deletePlantForUser(id: string, userId: number): Promise<{ photo_url: string } | null> {
    const [deleted] = await db
      .delete(plants)
      .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))))
      .returning({ photo_url: plants.photo_url });
    return deleted ?? null;
  }

  async setLastWateredForUser(ids: string[], userId: number, date: string): Promise<number> {
    if (ids.length === 0) return 0;
    const updated = await db
      .update(plants)
      .set({ last_watered_date: date })
      .where(and(inArray(plants.id, ids), eq(plants.user_id, String(userId))))
      .returning({ id: plants.id });
    return updated.length;
  }

  async getAllPlants(): Promise<Plant[]> {
    return await db.select().from(plants);
  }

  async getAllPlantsForCron(): Promise<Omit<Plant, 'photo_url' | 'notes' | 'created_at'>[]> {
    // Explicit column list — never include photo_url here. The cron handler
    // doesn't need the photo, only dates and frequencies for due-date math
    // and the plant name for the notification body.
    return await db
      .select({
        id: plants.id,
        user_id: plants.user_id,
        name: plants.name,
        location: plants.location,
        water_frequency_days: plants.water_frequency_days,
        last_watered_date: plants.last_watered_date,
        fertilize_frequency_days: plants.fertilize_frequency_days,
        last_fertilized_date: plants.last_fertilized_date,
        repot_frequency_months: plants.repot_frequency_months,
        last_repotted_date: plants.last_repotted_date,
        prune_frequency_months: plants.prune_frequency_months,
        last_pruned_date: plants.last_pruned_date,
      })
      .from(plants);
  }

  // Push subscription methods
  async savePushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    // Delete existing subscription for this user first
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, subscription.user_id));
    
    const [result] = await db
      .insert(pushSubscriptions)
      .values(subscription)
      .returning();
    return result;
  }

  async getPushSubscriptionByUserId(userId: number): Promise<PushSubscription | null> {
    const [subscription] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.user_id, userId));
    return subscription || null;
  }

  async deletePushSubscription(userId: number): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, userId));
  }

  async getAllPushSubscriptions(): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions);
  }

  // Expo push subscription methods (mobile)
  async saveExpoPushSubscription(userId: number, token: string, language: string = 'ru'): Promise<ExpoPushSubscription> {
    // Delete existing token for this user first (upsert pattern)
    await db.delete(expoPushSubscriptions).where(eq(expoPushSubscriptions.user_id, userId));
    const [result] = await db
      .insert(expoPushSubscriptions)
      .values({ user_id: userId, expo_push_token: token, language })
      .returning();
    return result;
  }

  async getExpoPushSubscriptionByUserId(userId: number): Promise<string | null> {
    const [sub] = await db
      .select()
      .from(expoPushSubscriptions)
      .where(eq(expoPushSubscriptions.user_id, userId));
    return sub?.expo_push_token ?? null;
  }

  async deleteExpoPushSubscription(userId: number): Promise<void> {
    await db.delete(expoPushSubscriptions).where(eq(expoPushSubscriptions.user_id, userId));
  }

  async getAllExpoPushSubscriptions(): Promise<{ user_id: number; expo_push_token: string; language: string }[]> {
    const rows = await db.select().from(expoPushSubscriptions);
    // Fix: previously dropped `language` here, so the cron always fell back to
    // 'ru' regardless of what the mobile client sent at subscribe time.
    return rows.map((r) => ({
      user_id: r.user_id,
      expo_push_token: r.expo_push_token,
      language: r.language,
    }));
  }

  // FCM push subscription methods (KMP app)
  async saveFcmPushSubscription(userId: number, token: string, platform: string = 'android', language: string = 'ru'): Promise<FcmPushSubscription> {
    // Delete existing token for this user first (upsert pattern, mirrors
    // saveExpoPushSubscription) — one row per user, so a re-subscribe can
    // never duplicate.
    await db.delete(fcmPushSubscriptions).where(eq(fcmPushSubscriptions.user_id, userId));
    const [result] = await db
      .insert(fcmPushSubscriptions)
      .values({ user_id: userId, fcm_token: token, platform, language })
      .returning();
    return result;
  }

  async getFcmPushSubscriptionByUserId(userId: number): Promise<FcmPushSubscription | null> {
    const [sub] = await db
      .select()
      .from(fcmPushSubscriptions)
      .where(eq(fcmPushSubscriptions.user_id, userId));
    return sub || null;
  }

  async deleteFcmPushSubscription(userId: number): Promise<void> {
    await db.delete(fcmPushSubscriptions).where(eq(fcmPushSubscriptions.user_id, userId));
  }

  async getAllFcmPushSubscriptions(): Promise<{ user_id: number; fcm_token: string; platform: string; language: string }[]> {
    const rows = await db.select().from(fcmPushSubscriptions);
    return rows.map((r) => ({
      user_id: r.user_id,
      fcm_token: r.fcm_token,
      platform: r.platform,
      language: r.language,
    }));
  }

  async deleteAccountCascade(userId: number): Promise<string[]> {
    return await db.transaction(async (tx) => {
      const deletedPlants = await tx
        .delete(plants)
        .where(eq(plants.user_id, String(userId)))
        .returning({ photo_url: plants.photo_url });
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, userId));
      await tx.delete(expoPushSubscriptions).where(eq(expoPushSubscriptions.user_id, userId));
      await tx.delete(fcmPushSubscriptions).where(eq(fcmPushSubscriptions.user_id, userId));
      // connect-pg-simple's `session` table is not in the drizzle schema
      // (drizzle-kit push would offer to drop it), so it is addressed with raw
      // SQL. Every session of the user goes, not only the caller's cookie.
      await tx.execute(sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)}`);
      await tx.delete(users).where(eq(users.id, userId));
      return deletedPlants.map((p) => p.photo_url);
    });
  }

  async ping(): Promise<void> {
    await client`select 1`;
  }
}

export const storage = new DbStorage();
