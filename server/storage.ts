import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { plants, users, pushSubscriptions, expoPushSubscriptions, type Plant, type InsertPlant, type User, type InsertUser, type PushSubscription, type InsertPushSubscription, type ExpoPushSubscription } from "@shared/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export interface IStorage {
  // User methods
  createAnonymousUser(name?: string): Promise<User>;
  getUserById(id: number): Promise<User | null>;
  getUserByRecoveryKey(recoveryKey: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  updateUserNotificationTime(userId: number, notificationTime: string): Promise<User | null>;
  markUserNotified(userId: number, date: string): Promise<void>;
  regenerateRecoveryKey(userId: number): Promise<User | null>;
  
  // Plant methods
  addPlant(plant: InsertPlant & { user_id: string }): Promise<Plant>;
  getPlantsByUserId(userId: string): Promise<Plant[]>;
  updatePlant(id: string, plant: Partial<InsertPlant>): Promise<Plant>;
  deletePlant(id: string): Promise<void>;
  getAllPlants(): Promise<Plant[]>;
  // Same as getAllPlants() but excludes photo_url (base64 blob, ~50-200 KB per
  // row). Used by the */5 cron in routes.ts where the photo isn't needed —
  // pulling it every 5 minutes blew through Neon's 5 GB/mo data-transfer
  // quota in late April 2026.
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
  getAllExpoPushSubscriptions(): Promise<{ user_id: number; expo_push_token: string; language: string }[]>;}

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
  async addPlant(plant: InsertPlant & { user_id: string }): Promise<Plant> {
    const [result] = await db.insert(plants).values(plant).returning();
    return result;
  }

  async getPlantsByUserId(userId: string): Promise<Plant[]> {
    return await db
      .select()
      .from(plants)
      .where(eq(plants.user_id, userId));
  }

  async updatePlant(
    id: string,
    plant: Partial<InsertPlant>
  ): Promise<Plant> {
    const [result] = await db
      .update(plants)
      .set(plant)
      .where(eq(plants.id, id as any))
      .returning();
    return result;
  }

  async deletePlant(id: string): Promise<void> {
    await db.delete(plants).where(eq(plants.id, id as any));
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

  async getAllExpoPushSubscriptions(): Promise<{ user_id: number; expo_push_token: string }[]> {
    const rows = await db.select().from(expoPushSubscriptions);
    return rows.map((r) => ({ user_id: r.user_id, expo_push_token: r.expo_push_token }));
  }
}

export const storage = new DbStorage();
