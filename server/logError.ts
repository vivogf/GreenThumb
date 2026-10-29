/**
 * Error logging without values. A PostgresError's message and its enumerable
 * detail/where/hint/constraint fields can carry row values (recovery keys among
 * them), so a log line gets only a fixed context string plus the error's name
 * and code.
 */
const SAFE = /^[A-Za-z0-9_./-]{1,64}$/;

function safe(value: unknown): string | null {
  const s = typeof value === "number" ? String(value) : value;
  return typeof s === "string" && SAFE.test(s) ? s : null;
}

/** "PostgresError 23505", "WebPushError 410", "TypeError"; never the message. */
export function errorLabel(error: unknown): string {
  if (error === null) return "null";
  if (typeof error !== "object") return typeof error;
  const e = error as { name?: unknown; code?: unknown; statusCode?: unknown; errorInfo?: { code?: unknown } };
  const name = error instanceof Error ? safe(e.name) ?? "Error" : null;
  const code = safe(e.code) ?? safe(e.statusCode) ?? safe(e.errorInfo?.code);
  return [name, code].filter(Boolean).join(" ") || "object";
}

/** console.error(`${context}: ${errorLabel(error)}`). Keep `context` a fixed string with no user data. */
export function logError(context: string, error: unknown): void {
  console.error(`${context}: ${errorLabel(error)}`);
}
