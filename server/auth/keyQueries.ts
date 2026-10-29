import { and, desc, eq, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { users } from "@shared/schema";
import { publicUserColumns } from "./publicUser";
import type { RecoveryKeyPair } from "./recoveryKey";

/**
 * The recovery-key statements on users, as builders over `db` or a transaction, so
 * keyQueries.test.ts can render the exact SQL with drizzle.mock(). None selects or
 * returns a key column: the only key-derived output is a boolean.
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

/** Stage-1 hash repair after a plaintext hit: only while recovery_key is still the key that was checked. */
export function repairKeyHashQuery(db: Db, userId: number, hash: string, canonicalKey: string) {
  return db
    .update(users)
    .set({ recovery_key_hash: hash })
    .where(and(eq(users.id, userId), eq(users.recovery_key, canonicalKey)));
}

/** Regenerate: writes only the pending hash; the current key and the sessions stay. */
export function setPendingKeyQuery(db: Db, userId: number, hash: string) {
  return db
    .update(users)
    .set({ pending_recovery_key_hash: hash })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
}

/**
 * Commit: promotes the pending key only if it is still `key.hash`. Stage 1 also writes the
 * plaintext column (the trigger recomputes the same hash and clears pending); stage 2 drops it.
 */
export function commitPendingKeyQuery(db: Db, userId: number, key: RecoveryKeyPair) {
  return db
    .update(users)
    .set({ recovery_key: key.key, recovery_key_hash: key.hash, pending_recovery_key_hash: null })
    .where(and(eq(users.id, userId), eq(users.pending_recovery_key_hash, key.hash)))
    .returning(publicUserColumns);
}

/** After a commit that matched no row: does the user exist, and is `hash` already the current key? */
export function userWithCurrentFlagQuery(db: Db, userId: number, hash: string) {
  return db
    .select({ ...publicUserColumns, current: hashIsCurrent(hash) })
    .from(users)
    .where(eq(users.id, userId));
}
