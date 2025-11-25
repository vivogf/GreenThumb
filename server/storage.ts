import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { plants, type Plant, type InsertPlant } from "@shared/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export interface IStorage {
  addPlant(plant: InsertPlant & { user_id: string }): Promise<Plant>;
  getPlantsByUserId(userId: string): Promise<Plant[]>;
  updatePlant(id: string, plant: Partial<InsertPlant>): Promise<Plant>;
  deletePlant(id: string): Promise<void>;
}

export class DbStorage implements IStorage {
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
}

export const storage = new DbStorage();
