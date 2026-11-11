import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { plants, users, apiUsage, careEvents, plantPhotos, userAchievements, pushSubscriptions, expoPushSubscriptions, fcmPushSubscriptions, type Plant, type PushSubscription, type InsertPushSubscription, type ExpoPushSubscription, type FcmPushSubscription } from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PlantPatch } from "./plants/plantInput";
import type { NewPlant, PlantCreateStore } from "./plants/createRoute";
import { publicUserColumns, type PublicUser } from "./auth/publicUser";
import { deleteOtherSessionsSql } from "./auth/sessions";
import type { CommitResult, RecoveryKeyHit } from "./auth/loginRecovery";
import { commitPendingKeyQuery, currentOrPendingHashQuery, insertUserQuery, pinKeyHashQuery, setPendingKeyQuery, userWithCurrentFlagQuery } from "./auth/keyQueries";
import type { SeasonMode } from "@shared/season/rule";
import { CARE_DATE_FIELDS, inferCareEvents, lastDateAfterDelete, needsJournalCorrection, planCareJournal, type CursorKey, type JournalEvent } from "./journal/careEvents";
import type { CareEventRow, DeleteEventResult, JournalStore } from "./journal/eventsRoute";
import type { NewTimelinePhoto, TimelinePhotoRow, TimelineStore } from "./journal/photosRoute";
import type { ProgressData, ProgressStore } from "./progress/route";
import type { AchievementId, StoredAchievement } from "./progress/achievements";
import { DELETED_USAGE_USER, type ApiUsageKind, type ReserveResult, type UsageCounter, type UsageReservation, type UsageStore } from "./species/usage";

export type CronPlant = Omit<Plant, 'photo_url' | 'notes' | 'created_at' | 'species_id' | 'species_name' | 'client_request_id'>;

// created_at as text with microseconds: a JS Date would drop them and make cursors skip rows.
const careEventColumns = {
  id: careEvents.id,
  plant_id: careEvents.plant_id,
  user_id: careEvents.user_id,
  type: careEvents.type,
  occurred_on: careEvents.occurred_on,
  note: careEvents.note,
  photo_id: careEvents.photo_id,
  created_at: sql<string>`to_char(${careEvents.created_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

const plantPhotoColumns = {
  id: plantPhotos.id,
  url: plantPhotos.url,
  taken_on: plantPhotos.taken_on,
  caption: plantPhotos.caption,
  created_at: sql<string>`to_char(${plantPhotos.created_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

/** What a plant deletion leaves to clean up in photo storage. */
export type DeletedPlant = { photo_url: string; object_keys: string[] };

/** What an account deletion leaves to clean up in photo storage. */
export type DeletedAccountPhotos = { photo_urls: string[]; object_keys: string[] };

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export interface IStorage extends UsageStore, UsageCounter, JournalStore, TimelineStore, ProgressStore, PlantCreateStore {
  // User methods. Every one selects and returns only publicUserColumns (server/auth/publicUser.ts),
  // and the key methods take hashes only (server/auth/keyQueries.ts).
  /** keyHash = generateRecoveryKey().hash; the key itself never reaches the database. */
  createAnonymousUser(name: string | undefined, keyHash: string): Promise<PublicUser>;
  getUserById(id: number): Promise<PublicUser | null>;
  /** One query by the current OR the pending hash (two-phase rotation); a current match wins. */
  getUserByCurrentOrPendingKeyHash(hash: string): Promise<RecoveryKeyHit | null>;
  getAllUsers(): Promise<PublicUser[]>;
  updateUserNotificationTime(userId: number, notificationTime: string): Promise<PublicUser | null>;
  updateUserTimezone(userId: number, timezone: string): Promise<PublicUser | null>;
  updateUserSeasonMode(userId: number, seasonMode: SeasonMode): Promise<PublicUser | null>;
  markUserNotified(userId: number, date: string): Promise<void>;
  /** Regenerate: writes only the pending hash; the current key and every session stay. */
  setPendingRecoveryKey(userId: number, pendingHash: string): Promise<PublicUser | null>;
  /** One transaction: promote the pending key if it is still `hash`, then delete sessions but keepSid. */
  commitPendingRecoveryKey(userId: number, hash: string, keepSid: string): Promise<CommitResult>;
  
  // Plant methods
  addPlant(plant: NewPlant): Promise<Plant>;
  getPlantByClientRequestId(userId: number, key: string): Promise<Plant | null>;
  getPlantsByUserId(userId: string): Promise<Plant[]>;
  getPlantForUser(id: string, userId: number): Promise<Plant | null>;
  /** Also journals every care date the patch moves forward (one event per field), in one transaction. */
  updatePlantForUser(id: string, userId: number, patch: PlantPatch): Promise<Plant | null>;
  /** Also deletes the plant's timeline rows; returns the cover URL and timeline object keys, or null when nothing was deleted. */
  deletePlantForUser(id: string, userId: number): Promise<DeletedPlant | null>;
  /** With journal=true a water event is recorded for each plant whose date moves forward. */
  setLastWateredForUser(ids: string[], userId: number, date: string, journal: boolean): Promise<number>;
  getAllPlants(): Promise<Plant[]>;
  // Same as getAllPlants() but excludes photo_url (base64 blob, ~50-200 KB per
  // row). Used by the check-plants cron in routes.ts where the photo isn't
  // needed — pulling it every 5 minutes blew through Neon's 5 GB/mo
  // data-transfer quota in late April 2026.
  getAllPlantsForCron(): Promise<CronPlant[]>;
  
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
  // Returns the cover photo_url values of the deleted plants and the timeline
  // object keys so the caller can remove those objects after the commit.
  deleteAccountCascade(userId: number): Promise<DeletedAccountPhotos>;

  ping(): Promise<void>;
}

export class DbStorage implements IStorage {
  // User methods
  async createAnonymousUser(name: string | undefined, keyHash: string): Promise<PublicUser> {
    return await db.transaction(async (tx) => {
      const [result] = await insertUserQuery(tx, name || null, keyHash);
      await pinKeyHashQuery(tx, result.id, keyHash);
      return result;
    });
  }

  async getUserById(id: number): Promise<PublicUser | null> {
    const [user] = await db
      .select(publicUserColumns)
      .from(users)
      .where(eq(users.id, id));
    return user || null;
  }

  async getAllUsers(): Promise<PublicUser[]> {
    return await db.select(publicUserColumns).from(users);
  }

  async updateUserNotificationTime(userId: number, notificationTime: string): Promise<PublicUser | null> {
    const [result] = await db
      .update(users)
      .set({ notification_time: notificationTime })
      .where(eq(users.id, userId))
      .returning(publicUserColumns);
    return result || null;
  }

  async updateUserTimezone(userId: number, timezone: string): Promise<PublicUser | null> {
    const [result] = await db
      .update(users)
      .set({ timezone })
      .where(eq(users.id, userId))
      .returning(publicUserColumns);
    return result || null;
  }

  async updateUserSeasonMode(userId: number, seasonMode: SeasonMode): Promise<PublicUser | null> {
    const [result] = await db
      .update(users)
      .set({ season_mode: seasonMode })
      .where(eq(users.id, userId))
      .returning(publicUserColumns);
    return result || null;
  }

  async markUserNotified(userId: number, date: string): Promise<void> {
    await db
      .update(users)
      .set({ last_notified_date: date })
      .where(eq(users.id, userId));
  }

  async getUserByCurrentOrPendingKeyHash(hash: string): Promise<RecoveryKeyHit | null> {
    const [row] = await currentOrPendingHashQuery(db, hash);
    if (!row) return null;
    const { current, ...user } = row;
    return { user, pending: !current };
  }

  async setPendingRecoveryKey(userId: number, pendingHash: string): Promise<PublicUser | null> {
    const [result] = await setPendingKeyQuery(db, userId, pendingHash);
    return result || null;
  }

  async commitPendingRecoveryKey(userId: number, hash: string, keepSid: string): Promise<CommitResult> {
    return await db.transaction(async (tx): Promise<CommitResult> => {
      const [promoted] = await commitPendingKeyQuery(tx, userId, hash);
      if (promoted) {
        // The old key is dead, so are the sessions it opened elsewhere; the caller's own session stays.
        await tx.execute(deleteOtherSessionsSql(userId, keepSid));
        return { status: "committed", user: promoted };
      }
      // No row: a concurrent commit of the same key (READ COMMITTED: this statement sees it) or not pending.
      const [row] = await userWithCurrentFlagQuery(tx, userId, hash);
      if (!row) return { status: "not_found" };
      const { current, ...user } = row;
      return current ? { status: "already_current", user } : { status: "not_pending" };
    });
  }

  // Plant methods
  async addPlant(plant: NewPlant): Promise<Plant> {
    const [result] = await db.insert(plants).values(plant).returning();
    return result;
  }

  async getPlantByClientRequestId(userId: number, key: string): Promise<Plant | null> {
    const [plant] = await db
      .select()
      .from(plants)
      .where(and(eq(plants.user_id, String(userId)), eq(plants.client_request_id, key)));
    return plant || null;
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
    // The row lock makes the old/new comparison and the journal insert one unit,
    // so two concurrent identical PATCHes record a single care event.
    return await db.transaction(async (tx) => {
      const [old] = await tx
        .select({
          last_watered_date: plants.last_watered_date,
          last_fertilized_date: plants.last_fertilized_date,
          last_repotted_date: plants.last_repotted_date,
          last_pruned_date: plants.last_pruned_date,
        })
        .from(plants)
        .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))))
        .for("update");
      if (!old) return null;
      const [result] = await tx
        .update(plants)
        .set(patch)
        .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))))
        .returning();
      if (!result) return null;
      const existing: JournalEvent[] = needsJournalCorrection(patch)
        ? await tx
            .select({ id: careEvents.id, type: careEvents.type, occurred_on: careEvents.occurred_on })
            .from(careEvents)
            .where(and(eq(careEvents.plant_id, id), inArray(careEvents.type, ["fertilize", "repot", "prune"])))
        : [];
      const plan = planCareJournal(old, patch, existing);
      if (plan.remove.length > 0) {
        await tx.delete(careEvents).where(and(eq(careEvents.plant_id, id), inArray(careEvents.id, plan.remove)));
      }
      for (const m of plan.move) {
        await tx.update(careEvents).set({ occurred_on: m.occurred_on }).where(and(eq(careEvents.plant_id, id), eq(careEvents.id, m.id)));
      }
      if (plan.insert.length > 0) {
        await tx.insert(careEvents).values(
          plan.insert.map((e) => ({ plant_id: id, user_id: String(userId), type: e.type, occurred_on: e.occurred_on })),
        );
      }
      return result;
    });
  }

  async deletePlantForUser(id: string, userId: number): Promise<DeletedPlant | null> {
    return await db.transaction(async (tx) => {
      // Timeline rows would also go by FK cascade; deleting them here returns their object keys.
      const photos = await tx
        .delete(plantPhotos)
        .where(and(eq(plantPhotos.plant_id, id), eq(plantPhotos.user_id, String(userId))))
        .returning({ object_key: plantPhotos.object_key });
      const [deleted] = await tx
        .delete(plants)
        .where(and(eq(plants.id, id), eq(plants.user_id, String(userId))))
        .returning({ photo_url: plants.photo_url });
      if (!deleted) return null;
      return { photo_url: deleted.photo_url, object_keys: photos.map((p) => p.object_key) };
    });
  }

  async setLastWateredForUser(ids: string[], userId: number, date: string, journal: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    return await db.transaction(async (tx) => {
      const owned = and(inArray(plants.id, ids), eq(plants.user_id, String(userId)));
      const before = await tx
        .select({ id: plants.id, last_watered_date: plants.last_watered_date })
        .from(plants)
        .where(owned)
        .for("update");
      const updated = await tx
        .update(plants)
        .set({ last_watered_date: date })
        .where(owned)
        .returning({ id: plants.id });
      if (journal) {
        const rows = before.flatMap((p) =>
          inferCareEvents(p, { last_watered_date: date }).map((e) => ({
            plant_id: p.id,
            user_id: String(userId),
            type: e.type,
            occurred_on: e.occurred_on,
          })),
        );
        if (rows.length > 0) await tx.insert(careEvents).values(rows);
      }
      return updated.length;
    });
  }

  // JournalStore: callers check plant ownership first; every query still carries the ids it relies on.
  async listEvents(plantId: string, limit: number, before: CursorKey | null): Promise<CareEventRow[]> {
    const after = before
      ? sql`(${careEvents.occurred_on}, ${careEvents.created_at}, ${careEvents.id}) < (${before.occurred_on}::date, ${before.created_at}::timestamptz, ${before.id}::uuid)`
      : undefined;
    return await db
      .select(careEventColumns)
      .from(careEvents)
      .where(and(eq(careEvents.plant_id, plantId), after))
      .orderBy(desc(careEvents.occurred_on), desc(careEvents.created_at), desc(careEvents.id))
      .limit(limit);
  }

  async insertNote(plantId: string, userId: number, note: string, occurredOn: string): Promise<CareEventRow> {
    const [row] = await db
      .insert(careEvents)
      .values({ plant_id: plantId, user_id: String(userId), type: "note", note, occurred_on: occurredOn })
      .returning(careEventColumns);
    return row;
  }

  async deleteEvent(plantId: string, userId: number, eventId: string): Promise<DeleteEventResult> {
    const uid = String(userId);
    return await db.transaction(async (tx) => {
      // Plant row first, like updatePlantForUser, so a concurrent PATCH and this delete see each other.
      const [plant] = await tx
        .select()
        .from(plants)
        .where(and(eq(plants.id, plantId), eq(plants.user_id, uid)))
        .for("update");
      if (!plant) return { status: "missing" } as const;
      const match = and(eq(careEvents.id, eventId), eq(careEvents.plant_id, plantId), eq(careEvents.user_id, uid));
      const [event] = await tx.select({ type: careEvents.type, occurred_on: careEvents.occurred_on }).from(careEvents).where(match);
      if (!event) return { status: "missing" } as const;
      if (event.type === "photo") return { status: "photo" } as const;
      await tx.delete(careEvents).where(match);
      if (event.type === "note") return { status: "deleted", plant: null } as const;
      const field = CARE_DATE_FIELDS[event.type];
      const remaining = await tx
        .select({ occurred_on: careEvents.occurred_on })
        .from(careEvents)
        .where(and(eq(careEvents.plant_id, plantId), eq(careEvents.type, event.type)));
      const next = lastDateAfterDelete(event.type, event.occurred_on, plant[field] ?? null, remaining.map((r) => r.occurred_on));
      if (next === undefined) return { status: "deleted", plant } as const;
      const [updated] = await tx
        .update(plants)
        .set({ [field]: next })
        .where(and(eq(plants.id, plantId), eq(plants.user_id, uid)))
        .returning();
      return { status: "deleted", plant: updated } as const;
    });
  }

  // TimelineStore: callers check plant ownership first; every query still carries the ids it relies on.
  async listPhotos(plantId: string): Promise<TimelinePhotoRow[]> {
    return await db
      .select(plantPhotoColumns)
      .from(plantPhotos)
      .where(eq(plantPhotos.plant_id, plantId))
      .orderBy(desc(plantPhotos.taken_on), desc(plantPhotos.created_at), desc(plantPhotos.id));
  }

  async insertPhotoWithEvent(
    plantId: string,
    userId: number,
    photo: NewTimelinePhoto,
  ): Promise<{ photo: TimelinePhotoRow; event: CareEventRow }> {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(plantPhotos)
        .values({ plant_id: plantId, user_id: String(userId), ...photo })
        .returning({ ...plantPhotoColumns });
      const [event] = await tx
        .insert(careEvents)
        .values({ plant_id: plantId, user_id: String(userId), type: "photo", occurred_on: photo.taken_on, photo_id: row.id })
        .returning(careEventColumns);
      return { photo: row, event };
    });
  }

  async deletePhotoForUser(plantId: string, userId: number, photoId: string): Promise<{ object_key: string } | null> {
    return await db.transaction(async (tx) => {
      await tx
        .delete(careEvents)
        .where(and(eq(careEvents.photo_id, photoId), eq(careEvents.plant_id, plantId), eq(careEvents.user_id, String(userId))));
      const [deleted] = await tx
        .delete(plantPhotos)
        .where(and(eq(plantPhotos.id, photoId), eq(plantPhotos.plant_id, plantId), eq(plantPhotos.user_id, String(userId))))
        .returning({ object_key: plantPhotos.object_key });
      return deleted ?? null;
    });
  }

  // ProgressStore. plants.created_at is a timestamp without zone written in the server's UTC session.
  async getProgressData(userId: number): Promise<ProgressData | null> {
    const uid = String(userId);
    const [userRows, plantRows, eventRows, photoRows, achievementRows] = await Promise.all([
      db.select({ timezone: users.timezone, season_mode: users.season_mode }).from(users).where(eq(users.id, userId)),
      db
        .select({
          id: plants.id,
          created_at: sql<string>`to_char(${plants.created_at}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          water_frequency_days: plants.water_frequency_days,
          last_watered_date: plants.last_watered_date,
          has_cover_photo: sql<boolean>`coalesce(${plants.photo_url}, '') <> ''`,
        })
        .from(plants)
        .where(eq(plants.user_id, uid)),
      db
        .select({ plant_id: careEvents.plant_id, type: careEvents.type, occurred_on: careEvents.occurred_on })
        .from(careEvents)
        .where(eq(careEvents.user_id, uid)),
      db.select({ count: sql<number>`count(*)::int` }).from(plantPhotos).where(eq(plantPhotos.user_id, uid)),
      db
        .select({ achievement_id: userAchievements.achievement_id, unlocked_at: userAchievements.unlocked_at })
        .from(userAchievements)
        .where(eq(userAchievements.user_id, uid)),
    ]);
    const [user] = userRows;
    if (!user) return null;
    return {
      user,
      plants: plantRows,
      events: eventRows,
      timelinePhotoCount: Number(photoRows[0]?.count ?? 0),
      achievements: achievementRows,
    };
  }

  async unlockAchievements(userId: number, ids: AchievementId[], at: Date): Promise<StoredAchievement[]> {
    const uid = String(userId);
    if (ids.length > 0) {
      await db
        .insert(userAchievements)
        .values(ids.map((id) => ({ user_id: uid, achievement_id: id, unlocked_at: at })))
        .onConflictDoNothing({ target: [userAchievements.user_id, userAchievements.achievement_id] });
    }
    return await db
      .select({ achievement_id: userAchievements.achievement_id, unlocked_at: userAchievements.unlocked_at })
      .from(userAchievements)
      .where(eq(userAchievements.user_id, uid));
  }

  async getAllPlants(): Promise<Plant[]> {
    return await db.select().from(plants);
  }

  async getAllPlantsForCron(): Promise<CronPlant[]> {
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

  async reserve(input: UsageReservation): Promise<ReserveResult> {
    return await db.transaction(async (tx) => {
      // One lock per (day, kind) serializes concurrent reservations, so the
      // global total cannot overshoot when several requests race at the cap.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`api_usage:${input.day}:${input.kind}`}::text))`);
      const [totals] = await tx
        .select({
          global: sql<number>`coalesce(sum(${apiUsage.count}), 0)::int`,
          user: sql<number>`coalesce(sum(${apiUsage.count}) filter (where ${apiUsage.user_id} = ${input.userId}), 0)::int`,
        })
        .from(apiUsage)
        .where(and(eq(apiUsage.day, input.day), eq(apiUsage.kind, input.kind)));
      const globalCount = Number(totals?.global ?? 0);
      const userCount = Number(totals?.user ?? 0);
      if (userCount >= input.userLimit || globalCount >= input.globalLimit) return { ok: false };
      await tx
        .insert(apiUsage)
        .values({ day: input.day, user_id: input.userId, kind: input.kind, count: 1 })
        .onConflictDoUpdate({
          target: [apiUsage.day, apiUsage.user_id, apiUsage.kind],
          set: { count: sql`${apiUsage.count} + 1` },
        });
      return { ok: true, userCount: userCount + 1, globalCount: globalCount + 1 };
    });
  }

  async usageCount(day: string, userId: string, kind: ApiUsageKind): Promise<number> {
    const [row] = await db
      .select({ count: apiUsage.count })
      .from(apiUsage)
      .where(and(eq(apiUsage.day, day), eq(apiUsage.user_id, userId), eq(apiUsage.kind, kind)));
    return Number(row?.count ?? 0);
  }

  async usageTotal(day: string, kind: ApiUsageKind): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${apiUsage.count}), 0)::int` })
      .from(apiUsage)
      .where(and(eq(apiUsage.day, day), eq(apiUsage.kind, kind)));
    return Number(row?.total ?? 0);
  }

  async recordUsage(day: string, userId: string, kind: ApiUsageKind): Promise<void> {
    await db
      .insert(apiUsage)
      .values({ day, user_id: userId, kind, count: 1 })
      .onConflictDoUpdate({
        target: [apiUsage.day, apiUsage.user_id, apiUsage.kind],
        set: { count: sql`${apiUsage.count} + 1` },
      });
  }

  async deleteAccountCascade(userId: number): Promise<DeletedAccountPhotos> {
    return await db.transaction(async (tx) => {
      // Fold the user's provider usage into '__deleted__' so daily limits never drop (architecture §2.12).
      await tx.execute(sql`
        INSERT INTO api_usage (day, user_id, kind, count)
        SELECT day, ${DELETED_USAGE_USER}::text, kind, count FROM api_usage WHERE user_id = ${String(userId)}::text
        ON CONFLICT (day, user_id, kind) DO UPDATE SET count = api_usage.count + EXCLUDED.count`);
      await tx.delete(apiUsage).where(eq(apiUsage.user_id, String(userId)));
      await tx.delete(careEvents).where(eq(careEvents.user_id, String(userId)));
      await tx.delete(userAchievements).where(eq(userAchievements.user_id, String(userId)));
      const timeline = await tx
        .delete(plantPhotos)
        .where(eq(plantPhotos.user_id, String(userId)))
        .returning({ object_key: plantPhotos.object_key });
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
      return { photo_urls: deletedPlants.map((p) => p.photo_url), object_keys: timeline.map((p) => p.object_key) };
    });
  }

  async ping(): Promise<void> {
    await client`select 1`;
  }
}

export const storage = new DbStorage();
