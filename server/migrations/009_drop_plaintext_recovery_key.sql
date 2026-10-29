-- Recovery-key hash, stage 2 (contract). Drops the plaintext users.recovery_key; from here on the database holds
-- only hex(SHA-256) of each key (users.recovery_key_hash, from 008) and of a pending rotation key.
-- Apply only after 008 and after scripts/ops/verify-recovery-hash.mjs reported mismatched=0 null=0, with a build
-- running that never names recovery_key (sign-in and confirm look up by hash only).
-- No rollback: the plaintext keys are gone. A build that still reads or writes recovery_key fails after this.
-- DROP COLUMN only hides the column; the old values stay in the table's pages until VACUUM FULL users (runbook,
-- outside this transaction, since VACUUM cannot run in one).
-- migrate.mjs runs this file in one transaction (by hand: psql --single-transaction, or SET LOCAL does nothing).
-- RAISE messages carry counts or type names only. Safe to re-run.

-- 0. Fail fast instead of queueing every request on users behind the exclusive lock.
SET LOCAL lock_timeout = '5s';

-- 1. 008 must be in place and every row must have a hash: a row without one could never sign in again.
DO $$
DECLARE
  hash_type text;
  missing bigint;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO hash_type
    FROM pg_attribute a
   WHERE a.attrelid = 'users'::regclass AND a.attname = 'recovery_key_hash' AND a.attnum > 0 AND NOT a.attisdropped;
  IF hash_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '009: users.recovery_key_hash must be text (apply 008 first), found %', coalesce(hash_type, 'no column');
  END IF;
  SELECT count(*) INTO missing FROM users WHERE recovery_key_hash IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '009: % users have no recovery_key_hash', missing;
  END IF;
END $$;

-- 2. The hash is the only credential now: NOT NULL and unique (008 set both; repeated so 009 does not depend on it).
ALTER TABLE users ALTER COLUMN recovery_key_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_recovery_key_hash_key ON users (recovery_key_hash);

-- 3. The 008 trigger recomputes the hash from recovery_key; it goes before the column it reads.
DROP TRIGGER IF EXISTS users_recovery_key_hash_sync ON users;
DROP FUNCTION IF EXISTS users_recovery_key_hash_sync();

-- 4. The plaintext column, with its DEFAULT and unique constraint. No CASCADE: an unknown dependent object
-- stops the migration instead of silently going with it.
ALTER TABLE users DROP COLUMN IF EXISTS recovery_key;
