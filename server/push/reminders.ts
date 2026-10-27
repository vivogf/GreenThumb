// Which subscriber gets a care reminder this tick, shared by the web, FCM and Expo branches of
// POST /api/push/check-plants. Due plants come only from server/care/schedule.ts.
import { DEFAULT_TIMEZONE } from "@shared/care/userDate";
import { plantsNeedingCare, userToday, type SchedulePlant, type ScheduleUser } from "../care/schedule";

export type ReminderUser = ScheduleUser & {
  id: number;
  notification_time: string | null;
  last_notified_date: string | null;
};
export type ReminderPlant = SchedulePlant & { user_id: string };
export type ReminderSub = { user_id: number; language?: string | null };

export type Reminder = {
  userId: number;
  lang: "ru" | "en";
  plants: ReminderPlant[];
  /** Distinct plant names, the number shown in the message body. */
  count: number;
};

function localClock(timezone: string | null | undefined, now: Date): { hour: number; minute: number } {
  const read = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit" })
      .formatToParts(now);
    return {
      hour: parseInt(parts.find((p) => p.type === "hour")!.value, 10) % 24,
      minute: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
    };
  };
  try {
    return read(timezone || DEFAULT_TIMEZONE);
  } catch {
    return read(DEFAULT_TIMEZONE);
  }
}

/**
 * True when notification_time (HH:MM, user-local) falls in the half-open window (now − windowMinutes, now].
 * windowMinutes must equal the cron interval (hourly), so the windows tile the day and each user matches
 * once; an inclusive lower bound once sent 09:00 and 09:05 duplicates.
 */
export function isInNotificationWindow(
  userTime: string | null | undefined,
  timezone: string | null | undefined,
  now: Date,
  windowMinutes = 60,
): boolean {
  if (!userTime) return false;
  const match = userTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const userMinutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const { hour, minute } = localClock(timezone, now);
  const localNowMinutes = (hour * 60 + minute) % 1440;
  const windowStart = localNowMinutes - windowMinutes;
  if (windowStart < 0) {
    return userMinutes > windowStart + 1440 || userMinutes <= localNowMinutes;
  }
  return userMinutes > windowStart && userMinutes <= localNowMinutes;
}

/** Notification window open and no reminder yet on the user's current date. */
export function reminderEligible(user: ReminderUser | undefined, now: Date): boolean {
  if (!user) return false;
  if (!isInNotificationWindow(user.notification_time, user.timezone, now)) return false;
  return user.last_notified_date !== userToday(user, now);
}

export type ReminderContext = {
  users: Map<number, ReminderUser>;
  plantsByUser: Map<string, ReminderPlant[]>;
  now: Date;
  eligible?: (user: ReminderUser | undefined, now: Date) => boolean;
};

export function indexReminderData(users: ReminderUser[], plants: ReminderPlant[]) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const plantsByUser = new Map<string, ReminderPlant[]>();
  for (const p of plants) {
    const list = plantsByUser.get(p.user_id);
    if (list) list.push(p);
    else plantsByUser.set(p.user_id, [p]);
  }
  return { users: byId, plantsByUser };
}

/** The reminder for one subscription, or null when it is not eligible or nothing is due. */
export function reminderFor(sub: ReminderSub, ctx: ReminderContext): Reminder | null {
  const user = ctx.users.get(sub.user_id);
  if (!(ctx.eligible ?? reminderEligible)(user, ctx.now)) return null;
  const due = plantsNeedingCare(ctx.plantsByUser.get(String(sub.user_id)) ?? [], user, ctx.now);
  if (due.length === 0) return null;
  return {
    userId: sub.user_id,
    lang: sub.language === "en" ? "en" : "ru",
    plants: due,
    count: new Set(due.map((p) => p.name)).size,
  };
}
