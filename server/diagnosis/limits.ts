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
 * Which limit blocks the next diagnosis, or null. Check-before-call, record-after-success: concurrent in-flight
 * requests can overshoot by a few, which is accepted, because the reserve() lock would make a failed provider call
 * use up quota. Both diagnosis routes share these counters.
 */
export async function diagnosisLimitScope(
  store: Pick<UsageCounter, "usageCount" | "usageTotal">,
  day: string,
  userId: string,
  limits: DiagnosisLimits,
): Promise<DiagnosisLimitScope | null> {
  const [used, total] = await Promise.all([store.usageCount(day, userId, KIND), store.usageTotal(day, KIND)]);
  if (used >= limits.userLimit) return "user";
  if (total >= limits.globalLimit) return "global";
  return null;
}
