// Achievements (architecture §2.11, §8.8). Pure evaluation; the route persists newly met ids once and never
// removes a stored one, so an achievement stays unlocked with its first timestamp whatever happens to the data.
import type { StreakEvent } from "./streak";

export const ACHIEVEMENT_IDS = [
  "first_plant",
  "plants_5",
  "first_water",
  "waterings_25",
  "waterings_100",
  "streak_7",
  "streak_30",
  "first_note",
  "first_photo",
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export type AchievementFacts = {
  /** Plants that exist at evaluation time. */
  plantCount: number;
  waterEventCount: number;
  hasNote: boolean;
  /** Any non-empty cover photo_url or any timeline photo. */
  hasPhoto: boolean;
  bestStreak: number;
};

export type StoredAchievement = { achievement_id: string; unlocked_at: Date | string };
export type AchievementEntry = { id: AchievementId; unlocked: boolean; unlocked_at: string | null };

const RULES: Record<AchievementId, (f: AchievementFacts) => boolean> = {
  first_plant: (f) => f.plantCount >= 1,
  plants_5: (f) => f.plantCount >= 5,
  first_water: (f) => f.waterEventCount >= 1,
  waterings_25: (f) => f.waterEventCount >= 25,
  waterings_100: (f) => f.waterEventCount >= 100,
  streak_7: (f) => f.bestStreak >= 7,
  streak_30: (f) => f.bestStreak >= 30,
  first_note: (f) => f.hasNote,
  first_photo: (f) => f.hasPhoto,
};

export function metAchievements(facts: AchievementFacts): AchievementId[] {
  return ACHIEVEMENT_IDS.filter((id) => RULES[id](facts));
}

export type FactsInput = {
  plants: { id: string; has_cover_photo: boolean }[];
  events: Pick<StreakEvent, "type">[];
  timelinePhotoCount: number;
};

export function progressFacts(input: FactsInput, bestStreak: number): AchievementFacts {
  return {
    plantCount: input.plants.length,
    waterEventCount: input.events.filter((e) => e.type === "water").length,
    hasNote: input.events.some((e) => e.type === "note"),
    hasPhoto: input.timelinePhotoCount > 0 || input.plants.some((p) => p.has_cover_photo),
    bestStreak,
  };
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The 9 entries in the fixed order; ids that are not stored are locked. Unknown stored ids are ignored. */
export function achievementList(stored: StoredAchievement[]): AchievementEntry[] {
  const at = new Map(stored.map((s) => [s.achievement_id, s.unlocked_at]));
  return ACHIEVEMENT_IDS.map((id) => {
    const t = at.get(id);
    return t === undefined ? { id, unlocked: false, unlocked_at: null } : { id, unlocked: true, unlocked_at: isoOf(t) };
  });
}

export function evaluateAchievements(
  facts: AchievementFacts,
  stored: StoredAchievement[],
  now: Date,
): { achievements: AchievementEntry[]; newlyUnlocked: AchievementId[] } {
  const have = new Set(stored.map((s) => s.achievement_id));
  const newlyUnlocked = metAchievements(facts).filter((id) => !have.has(id));
  const merged = [...stored, ...newlyUnlocked.map((id) => ({ achievement_id: id, unlocked_at: now }))];
  return { achievements: achievementList(merged), newlyUnlocked };
}
