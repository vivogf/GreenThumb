import type { Request, Response } from "express";
import type { Plant } from "@shared/schema";
import type { PhotoChange } from "../photos/photoChange";
import { parsePlantCreate, type PlantCreate } from "./plantInput";

/**
 * POST /api/plants with an optional per-user idempotency key.
 *
 * The KMP offline queue resends a queued "add plant" when the first answer never arrived. The client sends
 * the same `Idempotency-Key` on every attempt; a key this user already used returns the plant it created
 * (200, same shape) instead of a second row. Requests without the header behave exactly as before.
 */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type IdempotencyKey = { ok: true; key: string | null } | { ok: false; error: string };

export function parseIdempotencyKey(raw: unknown): IdempotencyKey {
  if (raw === undefined) return { ok: true, key: null };
  if (typeof raw !== "string" || !KEY_PATTERN.test(raw)) return { ok: false, error: "Invalid Idempotency-Key" };
  return { ok: true, key: raw };
}

/** Postgres unique_violation, also when a driver or ORM wraps it in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type NewPlant = PlantCreate & { user_id: string; client_request_id?: string | null };

export interface PlantCreateStore {
  addPlant(plant: NewPlant): Promise<Plant>;
  getPlantByClientRequestId(userId: number, key: string): Promise<Plant | null>;
}

export type PlantCreateDeps = {
  store: PlantCreateStore;
  userTimezone(userId: number): Promise<string | null>;
  preparePhoto(incoming: string | null | undefined): Promise<PhotoChange>;
  removePhotos(keys: Array<string | null | undefined>): Promise<void>;
  onError(res: Response, label: string, error: unknown): void;
};

export function createPlantCreateHandler(deps: PlantCreateDeps) {
  return async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const idempotency = parseIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
      if (!idempotency.ok) {
        return res.status(400).json({ error: idempotency.error });
      }
      const key = idempotency.key;
      if (key !== null) {
        const existing = await deps.store.getPlantByClientRequestId(userId, key);
        if (existing) return res.json(existing);
      }
      const parsed = parsePlantCreate(req.body, await deps.userTimezone(userId));
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const change = await deps.preparePhoto(parsed.data.photo_url);
      if (!change.ok) {
        return res.status(change.status).json({ error: change.error });
      }
      let result: Plant;
      try {
        result = await deps.store.addPlant({
          ...parsed.data,
          photo_url: change.photoUrl ?? "",
          user_id: String(userId),
          ...(key !== null ? { client_request_id: key } : {}),
        });
      } catch (error) {
        await deps.removePhotos([change.uploadedKey]);
        // Two attempts with one key raced past the lookup; the one that committed first wins.
        if (key !== null && isUniqueViolation(error)) {
          const winner = await deps.store.getPlantByClientRequestId(userId, key);
          if (winner) return res.json(winner);
          // The winner was deleted in between: the key was used, but there is no plant to return.
          return res.status(409).json({ error: "Plant for this Idempotency-Key was deleted" });
        }
        throw error;
      }
      res.json(result);
    } catch (error) {
      deps.onError(res, "Error adding plant", error);
    }
  };
}
