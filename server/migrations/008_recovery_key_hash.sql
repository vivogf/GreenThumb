-- Recovery-key hash, stage 1 (expand). Adds users.recovery_key_hash = hex(SHA-256(UTF-8 bytes of the canonical
-- lowercase key)), the same value as hashRecoveryKey in server/auth/recoveryKey.ts. The plaintext column stays as it
-- is (DEFAULT, NOT NULL, UNIQUE) until stage 2. The trigger recomputes the hash whenever a writer sets recovery_key,
-- so the previous app build (which knows nothing about the hash) keeps working after a rollback.
-- It also adds users.pending_recovery_key_hash for the two-phase key rotation (regenerate writes only pending;
-- confirm or a login with the pending key promotes it). Every statement is compatible with the previous build,
-- so this file is applied while the old code still runs.
-- migrate.mjs runs this file in one transaction (by hand: psql --single-transaction, or SET LOCAL does nothing).
-- RAISE messages carry counts or type names only, never keys or hashes. Safe to re-run.

-- 0. Fail fast instead of queueing behind a long query: ALTER TABLE waits for an exclusive lock on users, and
-- every request touching users would queue behind that wait.
SET LOCAL lock_timeout = '5s';

-- 0b. The backfill, the trigger and the stage-1 fallback assume recovery_key is uuid (canonical lowercase text
-- form). Any other type: stop before changing anything.
DO $$
DECLARE
  key_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO key_type
    FROM pg_attribute a
   WHERE a.attrelid = 'users'::regclass AND a.attname = 'recovery_key' AND a.attnum > 0 AND NOT a.attisdropped;
  IF key_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION '008: users.recovery_key must be uuid, found %', coalesce(key_type, 'no column');
  END IF;
END $$;

-- 1. This server's sha256 + convert_to must give the app's golden value, or every backfilled hash would be wrong.
DO $$
BEGIN
  IF encode(sha256(convert_to('00000000-0000-4000-8000-000000000000', 'UTF8')), 'hex')
     IS DISTINCT FROM 'db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98' THEN
    RAISE EXCEPTION '008: sha256 golden check failed';
  END IF;
END $$;

-- 2-3. Nullable column, then backfill from the plaintext key (uuid::text is already canonical lowercase).
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_key_hash text;

UPDATE users
SET recovery_key_hash = encode(sha256(convert_to(recovery_key::text, 'UTF8')), 'hex')
WHERE recovery_key_hash IS DISTINCT FROM encode(sha256(convert_to(recovery_key::text, 'UTF8')), 'hex');

-- 4. Every row has the right hash.
DO $$
DECLARE
  missing bigint;
  mismatched bigint;
BEGIN
  SELECT count(*) FILTER (WHERE recovery_key_hash IS NULL),
         count(*) FILTER (WHERE recovery_key_hash IS DISTINCT FROM encode(sha256(convert_to(recovery_key::text, 'UTF8')), 'hex'))
    INTO missing, mismatched
    FROM users;
  IF missing > 0 OR mismatched > 0 THEN
    RAISE EXCEPTION '008: backfill check failed: % null, % mismatched', missing, mismatched;
  END IF;
END $$;

-- 5. Constraints, only after the backfill.
ALTER TABLE users ALTER COLUMN recovery_key_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_recovery_key_hash_key ON users (recovery_key_hash);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_recovery_key_hash_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_recovery_key_hash_check CHECK (recovery_key_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- 6. Pending key of a two-phase rotation: NULL = none. Same hex shape as the current hash; unique among the
-- pending values (partial index: most rows are NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_recovery_key_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS users_pending_recovery_key_hash_key ON users (pending_recovery_key_hash)
  WHERE pending_recovery_key_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pending_recovery_key_hash_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_pending_recovery_key_hash_check CHECK (pending_recovery_key_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- 7. The hash follows the plaintext key on every insert and key change. A BEFORE trigger runs before the NOT NULL
-- check, so an INSERT that omits the hash (the old build) still passes. Every write of recovery_key also drops a
-- pending key: the old build's regenerate (or any other key write) must not leave a second live key behind; the
-- new build's commit writes recovery_key and clears pending itself. An UPDATE that does not name recovery_key
-- (the login hash repair, regenerate writing pending) does not fire it.
CREATE OR REPLACE FUNCTION users_recovery_key_hash_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.recovery_key_hash := encode(sha256(convert_to(NEW.recovery_key::text, 'UTF8')), 'hex');
  NEW.pending_recovery_key_hash := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_recovery_key_hash_sync ON users;
CREATE TRIGGER users_recovery_key_hash_sync
  BEFORE INSERT OR UPDATE OF recovery_key ON users
  FOR EACH ROW EXECUTE FUNCTION users_recovery_key_hash_sync();

-- 8. recovery_key keeps its DEFAULT gen_random_uuid() and NOT NULL: stage 2 (migration 009) removes it.
