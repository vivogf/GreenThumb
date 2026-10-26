-- Species fields on plants (catalog id + scientific name) and daily provider usage counters.
-- Safe to re-run.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS species_id text;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS species_name text;

CREATE TABLE IF NOT EXISTS api_usage (
  day date NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, kind)
);
