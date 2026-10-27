export const DEFAULT_PLANTNET_DAILY_LIMIT = 450;
export const DEFAULT_PLANTNET_USER_DAILY_LIMIT = 20;
export const DELETED_USAGE_USER = "__deleted__";

export type ApiUsageKind = "identify" | "diagnosis";

export interface UsageReservation {
  day: string;
  userId: string;
  kind: ApiUsageKind;
  userLimit: number;
  globalLimit: number;
}

export type ReserveResult =
  | { ok: true; userCount: number; globalCount: number }
  | { ok: false };

/**
 * Persistent api_usage counters. `reserve` must be atomic: it increments the
 * (day, user, kind) count only when the user's count and the day's total for
 * the kind (all users, `__deleted__` included) both stay within their limits.
 */
export interface UsageStore {
  reserve(input: UsageReservation): Promise<ReserveResult>;
}

/**
 * Count-after-success counters (diagnosis: only successful results count, architecture §8.7). The limit check
 * reads the count before the provider call; the increment happens after a validated result.
 */
export interface UsageCounter {
  usageCount(day: string, userId: string, kind: ApiUsageKind): Promise<number>;
  recordUsage(day: string, userId: string, kind: ApiUsageKind): Promise<void>;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function plantNetLimits(env: NodeJS.ProcessEnv = process.env): { globalLimit: number; userLimit: number } {
  return {
    globalLimit: positiveInt(env.PLANTNET_DAILY_LIMIT, DEFAULT_PLANTNET_DAILY_LIMIT),
    userLimit: positiveInt(env.PLANTNET_USER_DAILY_LIMIT, DEFAULT_PLANTNET_USER_DAILY_LIMIT),
  };
}

/** Pl@ntNet's quota resets at 00:00 UTC, so counters use the UTC day. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function remainingAfter(result: { userCount: number; globalCount: number }, limits: { userLimit: number; globalLimit: number }): number {
  return Math.max(0, Math.min(limits.userLimit - result.userCount, limits.globalLimit - result.globalCount));
}

/** In-memory UsageStore with the same semantics as the database one. */
export class MemoryUsageStore implements UsageStore, UsageCounter {
  readonly rows = new Map<string, number>();

  private key(day: string, userId: string, kind: string) {
    return `${day}|${userId}|${kind}`;
  }

  count(day: string, userId: string, kind: ApiUsageKind): number {
    return this.rows.get(this.key(day, userId, kind)) ?? 0;
  }

  total(day: string, kind: ApiUsageKind): number {
    let sum = 0;
    for (const [k, v] of Array.from(this.rows.entries())) {
      const [d, , kd] = k.split("|");
      if (d === day && kd === kind) sum += v;
    }
    return sum;
  }

  async reserve(input: UsageReservation): Promise<ReserveResult> {
    const userCount = this.count(input.day, input.userId, input.kind);
    const globalCount = this.total(input.day, input.kind);
    if (userCount >= input.userLimit || globalCount >= input.globalLimit) return { ok: false };
    this.rows.set(this.key(input.day, input.userId, input.kind), userCount + 1);
    return { ok: true, userCount: userCount + 1, globalCount: globalCount + 1 };
  }

  async usageCount(day: string, userId: string, kind: ApiUsageKind): Promise<number> {
    return this.count(day, userId, kind);
  }

  async recordUsage(day: string, userId: string, kind: ApiUsageKind): Promise<void> {
    this.rows.set(this.key(day, userId, kind), this.count(day, userId, kind) + 1);
  }

  /** Mirrors account deletion: the user's rows fold into `__deleted__`. */
  foldUser(userId: string): void {
    for (const [k, v] of Array.from(this.rows.entries())) {
      const [day, u, kind] = k.split("|");
      if (u !== userId) continue;
      const target = this.key(day, DELETED_USAGE_USER, kind);
      this.rows.set(target, (this.rows.get(target) ?? 0) + v);
      this.rows.delete(k);
    }
  }
}
