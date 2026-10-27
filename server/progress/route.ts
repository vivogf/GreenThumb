import type { Request, Response } from "express";
import type { SeasonUser } from "@shared/season/forUser";
import { computeStreak, type StreakEvent, type StreakPlant } from "./streak";
import {
  achievementList,
  evaluateAchievements,
  progressFacts,
  type AchievementId,
  type StoredAchievement,
} from "./achievements";

export type ProgressPlant = StreakPlant & { has_cover_photo: boolean };

export type ProgressData = {
  user: NonNullable<SeasonUser>;
  plants: ProgressPlant[];
  events: StreakEvent[];
  timelinePhotoCount: number;
  achievements: StoredAchievement[];
};

export interface ProgressStore {
  /** Everything the evaluation reads, for one user; null when the user row is gone. */
  getProgressData(userId: number): Promise<ProgressData | null>;
  /** Inserts the ids that are not stored yet (existing rows win) and returns all of the user's rows. */
  unlockAchievements(userId: number, ids: AchievementId[], at: Date): Promise<StoredAchievement[]>;
}

export type ProgressDeps = { store: ProgressStore; now?: () => Date };

export function createProgressHandler(deps: ProgressDeps) {
  const now = deps.now ?? (() => new Date());
  return async function progress(req: Request, res: Response) {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    try {
      const data = await deps.store.getProgressData(userId);
      if (!data) return res.status(401).json({ error: "Authentication required" });
      const at = now();
      const streak = computeStreak({ plants: data.plants, events: data.events, user: data.user, now: at });
      const evaluation = evaluateAchievements(progressFacts(data, streak.best), data.achievements, at);
      // Concurrent requests may both see an id as new; the stored row's timestamp is the one returned.
      const achievements =
        evaluation.newlyUnlocked.length > 0
          ? achievementList(await deps.store.unlockAchievements(userId, evaluation.newlyUnlocked, at))
          : evaluation.achievements;
      res.json({ streak, achievements });
    } catch (error) {
      console.error("Error computing progress:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
