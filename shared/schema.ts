import { z } from "zod";
import { pgTable, text, integer, timestamp, uuid, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Users table for email authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, created_at: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

// Login schema for validation
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// Register schema
export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().optional(),
});

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

// Push subscriptions table for web push notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions)
  .omit({ id: true, created_at: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
