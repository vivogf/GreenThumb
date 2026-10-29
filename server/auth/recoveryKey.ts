import { createHash, randomUUID } from "node:crypto";

/** Shape of users.recovery_key_hash (migration 008 has the same CHECK). */
export const RECOVERY_KEY_HASH = /^[0-9a-f]{64}$/;

/**
 * hex(SHA-256(UTF-8 bytes of the canonical key)). Pass the output of
 * normalizeRecoveryKey (lowercase 8-4-4-4-12), never raw input: another spelling
 * gives another hash. Migration 008 computes the same value in SQL with
 * encode(sha256(convert_to(key, 'UTF8')), 'hex'). No salt or pepper: the key is
 * 122 random bits, and the hash must be a lookup index.
 */
export function hashRecoveryKey(canonicalKey: string): string {
  return createHash("sha256").update(canonicalKey, "utf8").digest("hex");
}

export type RecoveryKeyPair = { key: string; hash: string };

/** A new recovery key (random v4 UUID, already canonical) and its hash. */
export function generateRecoveryKey(): RecoveryKeyPair {
  const key = randomUUID();
  return { key, hash: hashRecoveryKey(key) };
}
