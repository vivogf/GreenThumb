-- Achievements (architecture §2.11). A row is written once when the achievement is first met and is never
-- removed by plant or event deletion; account deletion removes the user's rows. Safe to re-run.
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id text NOT NULL,
  achievement_id text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);
