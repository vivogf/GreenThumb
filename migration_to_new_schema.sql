-- GreenThumb Database Migration
-- This script migrates your plants table to the new schema
-- WARNING: This will DELETE all existing plant data!
-- Run this SQL in your Supabase SQL Editor

-- Step 1: Drop existing table and its policies
DROP TABLE IF EXISTS plants CASCADE;

-- Step 2: Create plants table with correct field names
CREATE TABLE plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  water_frequency_days INTEGER NOT NULL CHECK (water_frequency_days > 0),
  last_watered_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Enable Row Level Security
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS Policies
-- Users can only see their own plants
CREATE POLICY "Users can view their own plants"
  ON plants FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own plants
CREATE POLICY "Users can insert their own plants"
  ON plants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own plants
CREATE POLICY "Users can update their own plants"
  ON plants FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own plants
CREATE POLICY "Users can delete their own plants"
  ON plants FOR DELETE
  USING (auth.uid() = user_id);

-- Step 5: Create indexes for better query performance
CREATE INDEX plants_user_id_idx ON plants(user_id);
CREATE INDEX plants_last_watered_date_idx ON plants(last_watered_date);

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration complete! Plants table has been recreated with correct schema.';
  RAISE NOTICE 'Field mappings:';
  RAISE NOTICE '  - species -> removed (not needed)';
  RAISE NOTICE '  - watering_frequency -> water_frequency_days';
  RAISE NOTICE '  - last_watered -> last_watered_date';
  RAISE NOTICE '  - image_url -> photo_url';
  RAISE NOTICE '';
  RAISE NOTICE 'You can now use the GreenThumb application!';
END $$;
