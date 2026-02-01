import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { plants, users, pushSubscriptions, type Plant, type InsertPlant, type User, type InsertUser, type PushSubscription, type InsertPushSubscription } from "@shared/schema";
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
  regenerateRecoveryKey(userId: number): Promise<User | null>;
  
  // Plant methods
  addPlant(plant: InsertPlant & { user_id: string }): Promise<Plant>;
  getPlantsByUserId(userId: string): Promise<Plant[]>;
  updatePlant(id: string, plant: Partial<InsertPlant>): Promise<Plant>;
  deletePlant(id: string): Promise<void>;
  getAllPlants(): Promise<Plant[]>;
  
  // Push subscription methods
  savePushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getPushSubscriptionByUserId(userId: number): Promise<PushSubscription | null>;
  deletePushSubscription(userId: number): Promise<void>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;
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
}

export const storage = new DbStorage();
