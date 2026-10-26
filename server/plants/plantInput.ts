import { z } from "zod";
import { normalizeCareDate } from "../../shared/care/userDate";

const careDateText = z.string({ invalid_type_error: "must be a date string" });

const optionalInt = (max: number) => z.number().int().min(0).max(max).nullable();

// Whitelist of client-editable plant fields. z.object strips every other key,
// so id, user_id, created_at and unknown keys never reach storage.
const plantFields = {
  name: z.string().trim().min(1).max(200),
  location: z.string().max(200),
  photo_url: z.string().nullable().transform((v) => v ?? ""),
  water_frequency_days: z.number().int().min(1).max(365),
  last_watered_date: careDateText,
  fertilize_frequency_days: optionalInt(3650),
  last_fertilized_date: careDateText.nullable(),
  repot_frequency_months: optionalInt(120),
  last_repotted_date: careDateText.nullable(),
  prune_frequency_months: optionalInt(120),
  last_pruned_date: careDateText.nullable(),
  notes: z.string().max(10000).nullable(),
  // Catalog id and scientific name (architecture §2.7); the server does not know the catalog.
  species_id: z.string().trim().min(1).max(100).nullable(),
  species_name: z.string().trim().min(1).max(200).nullable(),
};

const patchSchema = z.object(plantFields).partial();

const createSchema = z.object({
  ...plantFields,
  location: plantFields.location.optional().default(""),
  photo_url: z.string().nullable().optional().transform((v) => v ?? ""),
  notes: z.string().max(10000).nullable().optional().transform((v) => v ?? ""),
  fertilize_frequency_days: plantFields.fertilize_frequency_days.optional(),
  last_fertilized_date: plantFields.last_fertilized_date.optional(),
  repot_frequency_months: plantFields.repot_frequency_months.optional(),
  last_repotted_date: plantFields.last_repotted_date.optional(),
  prune_frequency_months: plantFields.prune_frequency_months.optional(),
  last_pruned_date: plantFields.last_pruned_date.optional(),
  species_id: plantFields.species_id.optional(),
  species_name: plantFields.species_name.optional(),
});

export type PlantPatch = z.infer<typeof patchSchema>;
export type PlantCreate = z.infer<typeof createSchema>;
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

const CARE_DATE_FIELDS = [
  "last_watered_date",
  "last_fertilized_date",
  "last_repotted_date",
  "last_pruned_date",
] as const;

function describe(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

function normalizeDates<T extends Partial<Record<(typeof CARE_DATE_FIELDS)[number], string | null | undefined>>>(
  data: T,
  timezone: string | null | undefined,
): ParseResult<T> {
  const out: any = { ...data };
  for (const field of CARE_DATE_FIELDS) {
    const value = out[field];
    if (typeof value !== "string") continue;
    const normalized = normalizeCareDate(value, timezone);
    if (normalized === null) {
      return { ok: false, error: `${field}: expected YYYY-MM-DD or an ISO datetime` };
    }
    out[field] = normalized;
  }
  return { ok: true, data: out };
}

function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
  timezone: string | null | undefined,
): ParseResult<z.infer<S>> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: describe(parsed.error) };
  return normalizeDates(parsed.data, timezone);
}

/** Validates a PATCH body; care dates become calendar dates in `timezone` (NULL → Moscow). */
export function parsePlantPatch(body: unknown, timezone: string | null | undefined): ParseResult<PlantPatch> {
  return parseWith(patchSchema, body, timezone);
}

/** Validates a POST body; ownership fields in the body are dropped. */
export function parsePlantCreate(body: unknown, timezone: string | null | undefined): ParseResult<PlantCreate> {
  return parseWith(createSchema, body, timezone);
}
