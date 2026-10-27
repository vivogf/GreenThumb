-- Photo timeline (architecture §2.8). Rows go with their plant (FK cascade); account deletion also removes
-- them by user_id. Each photo has exactly one `photo` care event (unique photo_id), which goes with the photo.
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS plant_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  url text NOT NULL,
  taken_on date NOT NULL,
  caption text NULL CHECK (char_length(caption) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plant_photos_plant_order_idx
  ON plant_photos (plant_id, taken_on DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS plant_photos_user_idx ON plant_photos (user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'care_events_photo_id_fkey') THEN
    ALTER TABLE care_events
      ADD CONSTRAINT care_events_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES plant_photos(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS care_events_photo_id_key ON care_events (photo_id) WHERE photo_id IS NOT NULL;
