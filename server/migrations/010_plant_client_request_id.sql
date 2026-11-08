-- Idempotent "add plant" (KMP offline queue replay). The app sends one Idempotency-Key per queued add and
-- repeats it on every retry; the server stores it here and answers a repeat with the plant it already made.
-- Old rows and requests without the header keep NULL, which the partial index ignores. Safe to re-run.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS plants_user_client_request_id_key
  ON plants (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
