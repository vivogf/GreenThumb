import { users, type User } from "@shared/schema";

/**
 * The users columns that may leave the database layer. An allow-list on purpose:
 * a column added later stays private until someone adds it here. Neither
 * recovery_key nor recovery_key_hash is in it; create and regenerate add the new
 * plaintext key to their own response.
 */
export const PUBLIC_USER_FIELDS = [
  "id",
  "name",
  "notification_time",
  "timezone",
  "last_notified_date",
  "season_mode",
  "created_at",
] as const;

export type PublicUserField = (typeof PUBLIC_USER_FIELDS)[number];
export type PublicUser = Pick<User, PublicUserField>;

/** Use in every db.select(...).from(users) and .returning(...) on users. */
export const publicUserColumns = {
  id: users.id,
  name: users.name,
  notification_time: users.notification_time,
  timezone: users.timezone,
  last_notified_date: users.last_notified_date,
  season_mode: users.season_mode,
  created_at: users.created_at,
} satisfies { [K in PublicUserField]: (typeof users)[K] };

/** A pick, not an omit: only the allow-listed fields are copied, whatever else the row carries. */
export function toPublicUser(row: PublicUser): PublicUser {
  const out = {} as Record<PublicUserField, unknown>;
  for (const field of PUBLIC_USER_FIELDS) out[field] = row[field];
  return out as PublicUser;
}
