-- Seasonal watering mode (architecture §2.9). Existing users get 'auto'. Safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_mode text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_season_mode_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_season_mode_check CHECK (season_mode IN ('auto', 'north', 'south', 'off'));
  END IF;
END $$;
