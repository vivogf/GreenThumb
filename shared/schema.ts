import { z } from "zod";

export interface Plant {
  id: string;
  user_id: string;
  name: string;
  location: string;
  photo_url: string;
  water_frequency_days: number;
  last_watered_date: string;
  notes: string;
}

export const insertPlantSchema = z.object({
  name: z.string().min(1, "Plant name is required"),
  location: z.string().min(1, "Location is required"),
  photo_url: z.string().url("Please enter a valid URL"),
  water_frequency_days: z.number().min(1, "Frequency must be at least 1 day"),
  last_watered_date: z.string(),
  notes: z.string().optional().default(""),
});

export type InsertPlant = z.infer<typeof insertPlantSchema>;

export interface User {
  id: string;
  email: string;
  created_at: string;
}
