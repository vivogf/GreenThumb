import { localDateInTz, normalizeCareDate } from "../../shared/care/userDate";

export const CARE_EVENT_TYPES = ["water", "fertilize", "repot", "prune", "note", "photo"] as const;
export type CareEventType = (typeof CARE_EVENT_TYPES)[number];

export const NOTE_MAX_CHARS = 1000;
export const EVENTS_DEFAULT_LIMIT = 50;
export const EVENTS_MAX_LIMIT = 100;

const CARE_DATE_EVENT_TYPES = {
  last_watered_date: "water",
  last_fertilized_date: "fertilize",
  last_repotted_date: "repot",
  last_pruned_date: "prune",
} as const;

type CareDateField = keyof typeof CARE_DATE_EVENT_TYPES;
export type CareDates = { [K in CareDateField]?: string | null };
export type InferredEvent = { type: CareEventType; occurred_on: string };

/**
 * Events a plant update records: one per care date that moves forward (or is
 * set for the first time). Same-day, backward and cleared dates are
 * corrections, not care. `patch` values are already normalized YYYY-MM-DD.
 */
export function inferCareEvents(old: CareDates, patch: CareDates): InferredEvent[] {
  const events: InferredEvent[] = [];
  for (const field of Object.keys(CARE_DATE_EVENT_TYPES) as CareDateField[]) {
    if (!(field in patch)) continue;
    const next = patch[field];
    if (typeof next !== "string") continue;
    const prev = typeof old[field] === "string" ? (old[field] as string).slice(0, 10) : null;
    if (prev === null || next > prev) {
      events.push({ type: CARE_DATE_EVENT_TYPES[field], occurred_on: next });
    }
  }
  return events;
}

/** The plant column that holds the last date of each care type. */
export const CARE_DATE_FIELDS = {
  water: "last_watered_date",
  fertilize: "last_fertilized_date",
  repot: "last_repotted_date",
  prune: "last_pruned_date",
} as const;

/**
 * Types whose journal follows a date correction. Water is left out: Postpone moves last_watered_date
 * back without being care, so a backward water date says nothing about past waterings.
 */
const CORRECTED_TYPES: ReadonlySet<CareEventType> = new Set<CareEventType>(["fertilize", "repot", "prune"]);

export type JournalEvent = { id: string; type: CareEventType; occurred_on: string };
export type JournalPlan = {
  insert: InferredEvent[];
  remove: string[];
  move: { id: string; occurred_on: string }[];
};

/** True when a patch can change the fertilize/repot/prune journal beyond adding an event. */
export function needsJournalCorrection(patch: CareDates): boolean {
  return (["last_fertilized_date", "last_repotted_date", "last_pruned_date"] as const).some((f) => f in patch);
}

/**
 * Journal changes for a plant update. Forward moves add an event (inferCareEvents). For
 * fertilize/repot/prune a backward move to D is a correction: events after D go, except that the newest
 * one moves to D when no event is on D yet. A cleared date removes every event of the type.
 */
export function planCareJournal(old: CareDates, patch: CareDates, existing: JournalEvent[]): JournalPlan {
  const plan: JournalPlan = { insert: inferCareEvents(old, patch), remove: [], move: [] };
  for (const field of Object.keys(CARE_DATE_EVENT_TYPES) as CareDateField[]) {
    if (!(field in patch)) continue;
    const type = CARE_DATE_EVENT_TYPES[field];
    if (!CORRECTED_TYPES.has(type)) continue;
    const prev = typeof old[field] === "string" ? (old[field] as string).slice(0, 10) : null;
    const next = patch[field];
    if (prev === null) continue;
    const ofType = existing.filter((e) => e.type === type);
    if (next === null || next === undefined) {
      plan.remove.push(...ofType.map((e) => e.id));
      continue;
    }
    if (next >= prev) continue;
    const later = ofType.filter((e) => e.occurred_on > next).sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1));
    if (later.length === 0) continue;
    if (ofType.some((e) => e.occurred_on === next)) {
      plan.remove.push(...later.map((e) => e.id));
    } else {
      plan.move.push({ id: later[0].id, occurred_on: next });
      plan.remove.push(...later.slice(1).map((e) => e.id));
    }
  }
  return plan;
}

/**
 * The plant's last date after a care event is deleted: undefined = leave it. Only an event that holds
 * the current fertilize/repot/prune date moves it, to the newest remaining event of the type or null.
 * Water keeps its date (it is required and Postpone moves it without events).
 */
export function lastDateAfterDelete(
  type: CareEventType,
  deletedOn: string,
  currentDate: string | null,
  remaining: string[],
): string | null | undefined {
  if (!CORRECTED_TYPES.has(type)) return undefined;
  if (currentDate === null || currentDate.slice(0, 10) !== deletedOn) return undefined;
  return remaining.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Validates a POST /events body. Only notes are creatable; automatic types come from care actions. */
export function parseNoteInput(
  body: unknown,
  timezone: string | null | undefined,
  now: Date,
): ParseResult<{ note: string; occurred_on: string }> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const { type, note, occurred_on } = body as Record<string, unknown>;
  if (type !== "note") return { ok: false, error: 'type: only "note" events can be created' };
  if (typeof note !== "string") return { ok: false, error: "note: must be a string" };
  // Code points, to match Postgres char_length in the table's CHECK.
  const length = Array.from(note).length;
  if (note.trim().length === 0) return { ok: false, error: "note: must not be empty" };
  if (length > NOTE_MAX_CHARS) return { ok: false, error: `note: at most ${NOTE_MAX_CHARS} characters` };
  let date: string;
  if (occurred_on === undefined || occurred_on === null) {
    date = localDateInTz(now, timezone);
  } else if (typeof occurred_on === "string") {
    const normalized = normalizeCareDate(occurred_on, timezone);
    if (normalized === null) return { ok: false, error: "occurred_on: expected YYYY-MM-DD" };
    date = normalized;
  } else {
    return { ok: false, error: "occurred_on: expected YYYY-MM-DD" };
  }
  return { ok: true, data: { note, occurred_on: date } };
}

/** Sort key of an event: occurred_on desc, created_at desc (microseconds), id desc. */
export type CursorKey = { occurred_on: string; created_at: string; id: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isEventId(id: string): boolean {
  return UUID.test(id.toLowerCase());
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.occurred_on, key.created_at, key.id])).toString("base64url");
}

export function decodeCursor(cursor: string): CursorKey | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [occurred_on, created_at, id] = value;
    if (typeof occurred_on !== "string" || !DATE.test(occurred_on)) return null;
    if (typeof created_at !== "string" || !CREATED_AT.test(created_at)) return null;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    return { occurred_on, created_at, id };
  } catch {
    return null;
  }
}

export function parseEventsQuery(query: Record<string, unknown>): ParseResult<{ limit: number; before: CursorKey | null }> {
  let limit = EVENTS_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d{1,3}$/.test(query.limit)) {
      return { ok: false, error: `limit: integer 1..${EVENTS_MAX_LIMIT}` };
    }
    limit = Number(query.limit);
    if (limit < 1 || limit > EVENTS_MAX_LIMIT) return { ok: false, error: `limit: integer 1..${EVENTS_MAX_LIMIT}` };
  }
  let before: CursorKey | null = null;
  if (query.before !== undefined && query.before !== "") {
    before = typeof query.before === "string" ? decodeCursor(query.before) : null;
    if (!before) return { ok: false, error: "before: invalid cursor" };
  }
  return { ok: true, data: { limit, before } };
}
