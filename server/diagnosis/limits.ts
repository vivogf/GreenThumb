import type { ApiUsageKind, UsageCounter } from "../species/usage";

export const DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT = 10;
export const DEFAULT_DIAGNOSIS_DAILY_LIMIT = 100;

export type DiagnosisLimits = { userLimit: number; globalLimit: number };
export type DiagnosisLimitScope = "user" | "global";

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** DIAGNOSIS_USER_DAILY_LIMIT (default 10) per user and DIAGNOSIS_DAILY_LIMIT (default 100) over all users, per UTC day. */
export function diagnosisLimits(env: NodeJS.ProcessEnv): DiagnosisLimits {
  return {
    userLimit: positiveInt(env.DIAGNOSIS_USER_DAILY_LIMIT, DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT),
    globalLimit: positiveInt(env.DIAGNOSIS_DAILY_LIMIT, DEFAULT_DIAGNOSIS_DAILY_LIMIT),
  };
}

const KIND: ApiUsageKind = "diagnosis";

/**
 * Every paid provider call of the day, over all users. A call that answers «no plant» or a refusal costs the
 * same as a shown result, and such answers are common (a leaf photo of a healthy plant), so the global cap has to
 * read attempts; the per-user cap keeps counting results only.
 */
export const DIAGNOSIS_ATTEMPT_KIND: ApiUsageKind = "diagnosis_attempt";

/**
 * Which limit blocks the next diagnosis, or null. Check-before-call, record-right-before-the-call: a parallel
 * burst all passes the check before any of it records, so the day's total can overshoot by the size of the burst.
 * Closing that would need a reservation like identify's, which costs a lock on every request; the caps stay a
 * spend guard, not an exact budget. Both diagnosis routes share these counters.
 */
export async function diagnosisLimitScope(
  store: Pick<UsageCounter, "usageCount" | "usageTotal">,
  day: string,
  userId: string,
  limits: DiagnosisLimits,
): Promise<DiagnosisLimitScope | null> {
  const [used, attempts] = await Promise.all([
    store.usageCount(day, userId, KIND),
    store.usageTotal(day, DIAGNOSIS_ATTEMPT_KIND),
  ]);
  if (used >= limits.userLimit) return "user";
  if (attempts >= limits.globalLimit) return "global";
  return null;
}
