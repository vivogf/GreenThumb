import { test } from "node:test";
import assert from "node:assert/strict";
import { indexReminderData, isInNotificationWindow, reminderEligible, reminderFor, type ReminderPlant, type ReminderUser } from "./reminders";

const NOW = new Date("2026-01-20T10:00:00Z"); // Berlin 11:00, D = 2026-01-20

function user(season_mode: string): ReminderUser {
  return { id: 1, timezone: "Europe/Berlin", season_mode, notification_time: "11:00", last_notified_date: null };
}

function plant(id: string, over: Partial<ReminderPlant>): ReminderPlant {
  return {
    id,
    user_id: "1",
    name: id,
    water_frequency_days: 14,
    last_watered_date: "2026-01-19",
    fertilize_frequency_days: null,
    last_fertilized_date: null,
    repot_frequency_months: null,
    last_repotted_date: null,
    prune_frequency_months: null,
    last_pruned_date: null,
    ...over,
  };
}

// VAL-SEASON-013 fixtures.
const PLANTS = [
  plant("W1", { last_watered_date: "2026-01-06" }), // base nextDue D, seasonal Jan 27
  plant("W2", { last_watered_date: "2025-12-30" }), // E=21 → D
  plant("F", { fertilize_frequency_days: 30, last_fertilized_date: "2025-12-21" }),
  plant("R", { repot_frequency_months: 1, last_repotted_date: "2025-12-20" }),
  plant("Pr", { prune_frequency_months: 2, last_pruned_date: "2025-11-20" }),
  plant("Rlater", { repot_frequency_months: 1, last_repotted_date: "2025-12-21" }),
];

const CHANNELS = {
  web: { user_id: 1, endpoint: "https://push.example/x", p256dh: "k", auth: "a", language: "ru" },
  fcm: { user_id: 1, fcm_token: "changeme-fcm-token", platform: "android", language: "en" },
  expo: { user_id: 1, expo_push_token: "ExponentPushToken[changeme]", language: "ru" },
};

const EXPECTED: Record<string, string[]> = {
  off: ["W1", "W2", "F", "R", "Pr"],
  north: ["W2", "F", "R", "Pr"],
  auto: ["W2", "F", "R", "Pr"],
  south: ["W1", "W2", "F", "R", "Pr"],
};

for (const mode of Object.keys(EXPECTED)) {
  for (const [channel, sub] of Object.entries(CHANNELS)) {
    test(`${channel} reminder in mode ${mode} lists ${EXPECTED[mode].join(",")}`, () => {
      const ctx = { ...indexReminderData([user(mode)], PLANTS), now: NOW, eligible: () => true };
      const r = reminderFor(sub, ctx);
      assert.deepEqual(r?.plants.map((p) => p.id), EXPECTED[mode]);
      assert.equal(r?.count, EXPECTED[mode].length);
    });
  }
}

test("language: en only for 'en', otherwise ru", () => {
  const ctx = { ...indexReminderData([user("off")], PLANTS), now: NOW, eligible: () => true };
  assert.equal(reminderFor(CHANNELS.fcm, ctx)?.lang, "en");
  assert.equal(reminderFor({ user_id: 1, language: null }, ctx)?.lang, "ru");
});

test("nothing due → no reminder; unknown user → no reminder", () => {
  const ctx = { ...indexReminderData([user("off")], [plant("x", {})]), now: NOW, eligible: () => true };
  assert.equal(reminderFor(CHANNELS.web, ctx), null);
  assert.equal(reminderFor({ user_id: 99 }, { ...ctx, eligible: undefined }), null);
});

test("default eligibility: window open and not yet notified on the user's date", () => {
  assert.equal(reminderEligible(user("off"), NOW), true);
  assert.equal(reminderEligible({ ...user("off"), last_notified_date: "2026-01-20" }, NOW), false);
  assert.equal(reminderEligible({ ...user("off"), last_notified_date: "2026-01-19" }, NOW), true);
  assert.equal(reminderEligible({ ...user("off"), notification_time: "12:00" }, NOW), false);
  assert.equal(reminderEligible(undefined, NOW), false);
});

test("notification window is half-open (now − 60 min, now]", () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(isInNotificationWindow("09:00", "UTC", at("2026-01-20T09:00:00Z")), true);
  assert.equal(isInNotificationWindow("09:00", "UTC", at("2026-01-20T10:00:00Z")), false);
  assert.equal(isInNotificationWindow("23:30", "UTC", at("2026-01-20T00:00:00Z")), true);
  assert.equal(isInNotificationWindow("00:00", "UTC", at("2026-01-20T00:00:00Z")), true);
  assert.equal(isInNotificationWindow("09:00", null, at("2026-01-20T06:00:00Z")), true);
  assert.equal(isInNotificationWindow("09:00", "Not/AZone", at("2026-01-20T06:00:00Z")), true);
  assert.equal(isInNotificationWindow(null, "UTC", at("2026-01-20T09:00:00Z")), false);
});
