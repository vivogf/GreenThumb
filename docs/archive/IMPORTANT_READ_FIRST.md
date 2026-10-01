# IMPORTANT: Database migration

## Your database needs an update!

You already have a `plants` table, but its structure differs slightly from what the app expects. You need to run a simple migration.

## Quick migration (2 minutes)

### Step 1: Disable email confirmation
1. Open the Supabase Dashboard
2. Go to **Authentication** → **Providers** → **Email**
3. Find "Confirm email" and **turn it OFF**
4. Click **Save**

### Step 2: Run the migration script
1. In the Supabase Dashboard open the **SQL Editor**
2. Click **New Query**
3. Copy the **entire** contents of the `migration_to_new_schema.sql` file
4. Paste it and click **Run**
5. You will see: "Migration complete!"

**WARNING:** The migration will delete all existing data in the plants table!

### Step 3: Verify
- Check that the `plants` table appears under **Database** → **Tables**
- You should see the fields: id, user_id, name, location, **photo_url**, **water_frequency_days**, **last_watered_date**, notes

## Done! Now you can test the app:

1. Open the app (it is already running on port 5000)
2. Sign up with any email (for example, test@example.com)
3. Start adding plants!

---

## What does the migration change?

**Old fields -> New:**
- `species` -> removed (not needed)
- `watering_frequency` -> `water_frequency_days`
- `last_watered` -> `last_watered_date`
- `image_url` -> `photo_url`

## What happens if you skip the migration?

- The app will not be able to add plants
- Errors when trying to water a plant
- Data displayed incorrectly

## Need help?

See `SETUP.md` for detailed instructions.

---

**After completing the 2 steps the app is fully ready to use!**
