import type { Request, Response } from "express";
import { PLANT_NOT_FOUND, requireOwnedPlant } from "../plants/ownership";
import { encodeCursor, isEventId, parseEventsQuery, parseNoteInput, type CareEventType, type CursorKey } from "./careEvents";

export const EVENT_NOT_FOUND = Object.freeze({ error: "Event not found" });

/** API shape of a care_events row; created_at keeps microseconds so cursors are exact. */
export type CareEventRow = {
  id: string;
  plant_id: string;
  user_id: string;
  type: CareEventType;
  occurred_on: string;
  note: string | null;
  photo_id: string | null;
  created_at: string;
};

export type DeleteNoteResult = "deleted" | "not_note" | "missing";

export interface JournalStore {
  getPlantForUser(id: string, userId: number): Promise<{ id: string } | null>;
  /** Newest first, strictly after `before` in that order. */
  listEvents(plantId: string, limit: number, before: CursorKey | null): Promise<CareEventRow[]>;
  insertNote(plantId: string, userId: number, note: string, occurredOn: string): Promise<CareEventRow>;
  /** Matches the event by id, plant and user together. */
  deleteNoteEvent(plantId: string, userId: number, eventId: string): Promise<DeleteNoteResult>;
}

export type JournalDeps = {
  store: JournalStore;
  userTimezone(userId: number): Promise<string | null>;
  now?: () => Date;
};

function serverError(res: Response, label: string, error: unknown) {
  console.error(`${label}:`, error);
  res.status(500).json({ error: "Internal server error" });
}

export function createJournalHandlers(deps: JournalDeps) {
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
      const query = parseEventsQuery(req.query as Record<string, unknown>);
      if (!query.ok) return res.status(400).json({ error: query.error });
      const rows = await deps.store.listEvents(owned.plantId, query.data.limit + 1, query.data.before);
      const events = rows.slice(0, query.data.limit);
      const last = events[events.length - 1];
      const nextCursor = rows.length > query.data.limit && last ? encodeCursor(last) : null;
      res.json({ events, nextCursor });
    } catch (error) {
      serverError(res, "Error listing care events", error);
    }
  }

  async function createNote(req: Request, res: Response) {
    try {
      const owned = await ownedPlant(req, res);
      if (!owned) return;
      const parsed = parseNoteInput(req.body, await deps.userTimezone(owned.userId), now());
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const event = await deps.store.insertNote(owned.plantId, owned.userId, parsed.data.note, parsed.data.occurred_on);
      res.status(201).json(event);
    } catch (error) {
      serverError(res, "Error creating note", error);
    }
  }

  async function remove(req: Request, res: Response) {
    try {
      const owned = await ownedPlant(req, res);
      if (!owned) return;
      const eventId = req.params.eventId;
      if (!isEventId(eventId)) return res.status(404).json(EVENT_NOT_FOUND);
      const result = await deps.store.deleteNoteEvent(owned.plantId, owned.userId, eventId.toLowerCase());
      if (result === "missing") return res.status(404).json(EVENT_NOT_FOUND);
      if (result === "not_note") {
        return res.status(409).json({ error: "Only note events can be deleted" });
      }
      res.status(204).end();
    } catch (error) {
      serverError(res, "Error deleting care event", error);
    }
  }

  return { list, createNote, remove };
}
