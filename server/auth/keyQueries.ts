import { and, desc, eq, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { users } from "@shared/schema";
import { publicUserColumns } from "./publicUser";

/**
 * The recovery-key statements on users, as builders over `db` or a transaction, so
 * keyQueries.test.ts can render the exact SQL with drizzle.mock(). They take and write
 * hashes only, and none selects or returns a key column: the only key-derived output is a boolean.
 */
type Db = PgDatabase<PgQueryResultHKT, any, any>;

/** true when `hash` is the row's current hash. A comparison, so the hash itself never leaves the database. */
const hashIsCurrent = (hash: string) => sql<boolean>`(${users.recovery_key_hash} = ${hash})`;

/** Login: ONE query by the current OR the pending hash; a current match wins (`current` = false: pending hit). */
export function currentOrPendingHashQuery(db: Db, hash: string) {
  return db
    .select({ ...publicUserColumns, current: hashIsCurrent(hash) })
    .from(users)
    .where(or(eq(users.recovery_key_hash, hash), eq(users.pending_recovery_key_hash, hash)))
    .orderBy(desc(hashIsCurrent(hash)))
    .limit(1);
}

/** Create: the row gets the name and the hash of the key just issued. */
export function insertUserQuery(db: Db, name: string | null, hash: string) {
  return db
    .insert(users)
    .values({ name, recovery_key_hash: hash })
    .returning(publicUserColumns);
}

/**
 * Create, second statement, same transaction. While the database still has migration 008's trigger (before 009),
 * the INSERT fills the plaintext column from its DEFAULT and the trigger overwrites the hash with the hash of that
 * random value. This UPDATE does not name recovery_key, so the trigger does not fire and the issued hash stays.
 * After 009 it rewrites the same value.
 */
export function pinKeyHashQuery(db: Db, userId: number, hash: string) {
  return db
    .update(users)
    .set({ recovery_key_hash: hash })
    .where(eq(users.id, userId));
}

/** Regenerate: writes only the pending hash; the current key and the sessions stay. */
export function setPendingKeyQuery(db: Db, userId: number, hash: string) {
  return db
    .update(users)
    .set({ pending_recovery_key_hash: hash })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
}

/** Commit: promotes the pending key only if it is still `hash`. */
export function commitPendingKeyQuery(db: Db, userId: number, hash: string) {
  return db
    .update(users)
    .set({ recovery_key_hash: hash, pending_recovery_key_hash: null })
    .where(and(eq(users.id, userId), eq(users.pending_recovery_key_hash, hash)))
    .returning(publicUserColumns);
}

/** After a commit that matched no row: does the user exist, and is `hash` already the current key? */
export function userWithCurrentFlagQuery(db: Db, userId: number, hash: string) {
  return db
    .select({ ...publicUserColumns, current: hashIsCurrent(hash) })
    .from(users)
    .where(eq(users.id, userId));
}
