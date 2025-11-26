import { z } from "zod";
import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  photo_url: text("photo_url").notNull(),
  water_frequency_days: integer("water_frequency_days").notNull(),
  last_watered_date: text("last_watered_date").notNull(),
  notes: text("notes").default(""),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type Plant = typeof plants.$inferSelect;

// Schema for frontend form (without user_id - added by backend)
export const insertPlantSchema = createInsertSchema(plants)
  .omit({ id: true, created_at: true, user_id: true })
  .extend({
    last_watered_date: z.string(),
    notes: z.string().optional().default(""),
  });

export type InsertPlant = z.infer<typeof insertPlantSchema>;

// Full schema for backend (with user_id)
export const insertPlantWithUserSchema = insertPlantSchema.extend({
  user_id: z.string(),
});
