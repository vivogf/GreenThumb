-- GreenThumb Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor

-- Create plants table
CREATE TABLE IF NOT EXISTS plants (
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

-- Enable Row Level Security
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
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

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS plants_user_id_idx ON plants(user_id);
CREATE INDEX IF NOT EXISTS plants_last_watered_date_idx ON plants(last_watered_date);

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'GreenThumb database setup complete! You can now use the application.';
END $$;
