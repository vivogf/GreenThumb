-- Care journal (architecture §2.8). Rows go with their plant (FK cascade); account deletion also removes
-- them by user_id. photo_id points at plant_photos, which a later migration adds. Safe to re-run.
CREATE TABLE IF NOT EXISTS care_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('water', 'fertilize', 'repot', 'prune', 'note', 'photo')),
  occurred_on date NOT NULL,
  note text NULL CHECK (char_length(note) <= 1000),
  photo_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS care_events_plant_order_idx
  ON care_events (plant_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS care_events_user_day_idx ON care_events (user_id, occurred_on);
