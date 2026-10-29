import { sql } from "drizzle-orm";

/**
 * connect-pg-simple's `session` table is outside the drizzle schema. express-session
 * stores `req.session.userId` (a number) inside the `sess` JSON, so `->>` gives its
 * text form; `keepSid` is `req.sessionID`, the table's primary key.
 */
export function deleteOtherSessionsSql(userId: number, keepSid: string) {
  return sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)} AND sid <> ${keepSid}`;
}
