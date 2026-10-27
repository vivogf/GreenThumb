import { z } from "zod";
import { SEASON_MODES, type SeasonMode } from "@shared/season/rule";

const bodySchema = z.object({ season_mode: z.enum(SEASON_MODES) });

export type SeasonModeParse = { ok: true; mode: SeasonMode } | { ok: false; error: string };

/** Body of PATCH /api/auth/update-season-mode: exactly one of the four lowercase modes. */
export function parseSeasonModeBody(body: unknown): SeasonModeParse {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: `season_mode must be one of ${SEASON_MODES.join(", ")}` };
  }
  return { ok: true, mode: parsed.data.season_mode };
}
