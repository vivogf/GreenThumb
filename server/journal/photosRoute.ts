import type { Request, Response } from "express";
import { PLANT_NOT_FOUND, requireOwnedPlant } from "../plants/ownership";
import { newPhotoLocation } from "../photos/keys";
import { removePhotoObjects, type PhotoObjectStore } from "../photos/photoChange";
import { isEventId } from "./careEvents";
import type { CareEventRow } from "./eventsRoute";
import { parsePhotoInput } from "./photoInput";

export const PHOTO_NOT_FOUND = Object.freeze({ error: "Photo not found" });

/** API shape of a plant_photos row. */
export type TimelinePhotoRow = {
  id: string;
  url: string;
  taken_on: string;
  caption: string | null;
  created_at: string;
};

export type NewTimelinePhoto = { object_key: string; url: string; taken_on: string; caption: string | null };

export interface TimelineStore {
  getPlantForUser(id: string, userId: number): Promise<{ id: string } | null>;
  /** Newest first: taken_on desc, then created_at desc. */
  listPhotos(plantId: string): Promise<TimelinePhotoRow[]>;
  /** Inserts the photo row and its one `photo` care event in one transaction. */
  insertPhotoWithEvent(plantId: string, userId: number, photo: NewTimelinePhoto): Promise<{ photo: TimelinePhotoRow; event: CareEventRow }>;
  /** Matches by photo id, plant and user together; removes the row and its event. */
  deletePhotoForUser(plantId: string, userId: number, photoId: string): Promise<{ object_key: string } | null>;
}

export type TimelineDeps = {
  store: TimelineStore;
  userTimezone(userId: number): Promise<string | null>;
  photos(): { store: PhotoObjectStore | null; publicBaseUrl: string | null };
  now?: () => Date;
};

function serverError(res: Response, label: string, error: unknown) {
  console.error(`${label}:`, error);
  res.status(500).json({ error: "Internal server error" });
}

export function createTimelineHandlers(deps: TimelineDeps) {
  const now = deps.now ?? (() => new Date());

  // Session and ownership come before any validation, so a foreign plant never leaks through a 400.
  async function ownedPlant(req: Request, res: Response): Promise<{ userId: number; plantId: string } | null> {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    const plant = await requireOwnedPlant(deps.store.getPlantForUser.bind(deps.store), req.params.id, userId);
    if (!plant) {
      res.status(404).json(PLANT_NOT_FOUND);
      return null;
    }
    return { userId, plantId: plant.id };
  }

  async function list(req: Request, res: Response) {
    try {
      const owned = await ownedPlant(req, res);
      if (!owned) return;
      res.json({ photos: await deps.store.listPhotos(owned.plantId) });
    } catch (error) {
      serverError(res, "Error listing plant photos", error);
    }
  }

  async function create(req: Request, res: Response) {
    try {
      const owned = await ownedPlant(req, res);
      if (!owned) return;
      const parsed = parsePhotoInput(req.body, await deps.userTimezone(owned.userId), now());
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const objects = deps.photos();
      if (!objects.store || !objects.publicBaseUrl) {
        return res.status(503).json({ error: "Photo storage unavailable" });
      }
      const { photo, caption, taken_on } = parsed.data;
      const { key, url } = newPhotoLocation(photo.ext, objects.publicBaseUrl);
      await objects.store.put(key, photo.bytes, photo.mime);
      let created;
      try {
        created = await deps.store.insertPhotoWithEvent(owned.plantId, owned.userId, { object_key: key, url, taken_on, caption });
      } catch (error) {
        await removePhotoObjects(objects.store, [key]);
        throw error;
      }
      res.status(201).json({ ...created.photo, event: created.event });
    } catch (error) {
      serverError(res, "Error adding plant photo", error);
    }
  }

  async function remove(req: Request, res: Response) {
    try {
      const owned = await ownedPlant(req, res);
      if (!owned) return;
      const photoId = req.params.photoId;
      if (!isEventId(photoId)) return res.status(404).json(PHOTO_NOT_FOUND);
      const deleted = await deps.store.deletePhotoForUser(owned.plantId, owned.userId, photoId.toLowerCase());
      if (!deleted) return res.status(404).json(PHOTO_NOT_FOUND);
      // The object goes only after the DB commit; a failed delete leaves an orphan for the daily sweep.
      await removePhotoObjects(deps.photos().store, [deleted.object_key]);
      res.status(204).end();
    } catch (error) {
      serverError(res, "Error deleting plant photo", error);
    }
  }

  return { list, create, remove };
}
