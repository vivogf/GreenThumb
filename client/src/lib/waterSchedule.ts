import { useAuth } from '@/contexts/AuthContext';
import { userToday, waterScheduleForUser, type WaterPlant, type WaterSchedule } from '@shared/season/forUser';

/**
 * Watering status with the server's seasonal rule (shared/season): the user's stored timezone and
 * season_mode, and "today" as the user's date in that zone, so the web shows what the server schedules.
 */
export function useWaterSchedule(): { today: string; schedule: (plant: WaterPlant) => WaterSchedule | null } {
  const { user } = useAuth();
  return {
    today: userToday(user, new Date()),
    schedule: (plant) => waterScheduleForUser(plant, user),
  };
}
