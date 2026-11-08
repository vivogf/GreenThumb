import { z } from "zod";
import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uuid, serial, date, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Users table - anonymous UUID-based authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  notification_time: text("notification_time").default("09:00"),
  // IANA timezone identifier (e.g. "Europe/Moscow", "America/New_York").
  // Set by the mobile/web client via /api/auth/update-timezone. NULL → cron
  // falls back to Europe/Moscow (zero-regression for users created before
  // this column existed).
  timezone: text("timezone"),
  // YYYY-MM-DD (in user's local timezone) of the day we last sent this user a
  // care reminder push. The cron handler in routes.ts checks this to dedupe
  // within a day so the hourly cron + a 60-minute notification window never
  // sends two pushes to the same user on the same date.
  last_notified_date: text("last_notified_date"),
  // Seasonal watering (migration 006, check constraint there): auto | north | south | off.
  season_mode: text("season_mode").$type<"auto" | "north" | "south" | "off">().notNull().default("auto"),
  // hex SHA-256 of the canonical key (server/auth/recoveryKey.ts; migration 008: NOT NULL, unique, CHECK). The only
  // stored form of the key: migration 009 dropped the plaintext column. Never selected for a response;
  // server/auth/publicUser.ts holds the allow-list of columns that may be.
  recovery_key_hash: text("recovery_key_hash").notNull().unique(),
  // Two-phase rotation (migration 008): hash of the key issued by regenerate and not yet confirmed; NULL = none.
  pending_recovery_key_hash: text("pending_recovery_key_hash"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, created_at: true, recovery_key_hash: true, pending_recovery_key_hash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  photo_url: text("photo_url").notNull(),
  water_frequency_days: integer("water_frequency_days").notNull(),
  last_watered_date: text("last_watered_date").notNull(),
  fertilize_frequency_days: integer("fertilize_frequency_days"),
  last_fertilized_date: text("last_fertilized_date"),
  repot_frequency_months: integer("repot_frequency_months"),
  last_repotted_date: text("last_repotted_date"),
  prune_frequency_months: integer("prune_frequency_months"),
  last_pruned_date: text("last_pruned_date"),
  notes: text("notes").default(""),
  // Offline catalog id and scientific name (migration 003). The server never validates them against a catalog.
  species_id: text("species_id"),
  species_name: text("species_name"),
  // Idempotency-Key of the POST that created the row (migration 010); unique per user where set.
  client_request_id: text("client_request_id"),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("plants_user_client_request_id_key")
    .on(t.user_id, t.client_request_id)
    .where(sql`${t.client_request_id} IS NOT NULL`),
]);

export type Plant = typeof plants.$inferSelect;

// Schema for frontend form (without user_id - added by backend)
export const insertPlantSchema = createInsertSchema(plants)
  .omit({ id: true, created_at: true, user_id: true, client_request_id: true })
  .extend({
    last_watered_date: z.string(),
    notes: z.string().optional().default(""),
    fertilize_frequency_days: z.number().optional(),
    last_fertilized_date: z.string().optional(),
    repot_frequency_months: z.number().optional(),
    last_repotted_date: z.string().optional(),
    prune_frequency_months: z.number().optional(),
    last_pruned_date: z.string().optional(),
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
  // Two-letter language code for push body localization ("ru" | "en").
  // Default "ru" preserves behavior for existing rows.
  language: text("language").notNull().default("ru"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions)
  .omit({ id: true, created_at: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;

// Expo Push Subscriptions table for mobile (React Native) push notifications
export const expoPushSubscriptions = pgTable("expo_push_subscriptions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  expo_push_token: text("expo_push_token").notNull(),
  language: text("language").notNull().default("ru"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type ExpoPushSubscription = typeof expoPushSubscriptions.$inferSelect;

// FCM Push Subscriptions for the KMP (Kotlin Multiplatform) app — the
// Expo push pipeline can't serve it (no Expo token in a native build), so
// the client subscribes with a raw FCM registration token sent straight to
// the backend, which delivers via FCM HTTP v1 (firebase-admin).
// Mirrors expo_push_subscriptions; unique row per user (delete+insert).
export const fcmPushSubscriptions = pgTable("fcm_push_subscriptions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  fcm_token: text("fcm_token").notNull(),
  platform: text("platform").notNull().default("android"),
  language: text("language").notNull().default("ru"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type FcmPushSubscription = typeof fcmPushSubscriptions.$inferSelect;

// Daily counters for paid/limited providers (migration 003). user_id is the users.id as text, or
// '__deleted__' for counts folded in from deleted accounts so the day's total never drops.
export const apiUsage = pgTable("api_usage", {
  day: date("day", { mode: "string" }).notNull(),
  user_id: text("user_id").notNull(),
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.user_id, t.kind] })]);

export type ApiUsage = typeof apiUsage.$inferSelect;

// Care journal (migration 004). user_id is users.id as text, like plants.user_id.
export const careEvents = pgTable("care_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  plant_id: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull(),
  type: text("type").$type<"water" | "fertilize" | "repot" | "prune" | "note" | "photo">().notNull(),
  occurred_on: date("occurred_on", { mode: "string" }).notNull(),
  note: text("note"),
  photo_id: uuid("photo_id").references(() => plantPhotos.id, { onDelete: "cascade" }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CareEvent = typeof careEvents.$inferSelect;

// Photo timeline (migration 005). object_key is the R2 key `p/<uuid>.<ext>`; url is its public /photos/ URL.
export const plantPhotos = pgTable("plant_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  plant_id: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull(),
  object_key: text("object_key").notNull().unique(),
  url: text("url").notNull(),
  taken_on: date("taken_on", { mode: "string" }).notNull(),
  caption: text("caption"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PlantPhoto = typeof plantPhotos.$inferSelect;

// Achievements (migration 007). user_id is users.id as text; one row per unlocked achievement, never re-locked.
export const userAchievements = pgTable("user_achievements", {
  user_id: text("user_id").notNull(),
  achievement_id: text("achievement_id").notNull(),
  unlocked_at: timestamp("unlocked_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.user_id, t.achievement_id] })]);

export type UserAchievement = typeof userAchievements.$inferSelect;

// Written only by scripts/ops/migrate.mjs (one row per applied server/migrations/*.sql file).
export const schemaMigrations = pgTable("schema_migrations", {
  name: text("name").primaryKey(),
  applied_at: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});
