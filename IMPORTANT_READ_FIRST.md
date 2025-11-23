# ⚠️ IMPORTANT: Setup Required Before Testing

## Your app is built, but it won't work yet!

The GreenThumb app has been fully built and is running on port 5000, but **you must complete the Supabase setup** before it will function.

## Quick Setup Checklist (5 minutes)

### ☐ Step 1: Disable Email Confirmation
1. Open your Supabase Dashboard
2. Go to **Authentication** → **Providers** → **Email**
3. Find "Confirm email" and **DISABLE** it
4. Click **Save**

### ☐ Step 2: Run the SQL Script
1. In Supabase Dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy ALL contents from `supabase_setup.sql` (in this project)
4. Paste and click **Run**
5. You should see: "GreenThumb database setup complete!"

### ☐ Step 3: Verify
- Check that the `plants` table appears in **Database** → **Tables**
- You should see columns: id, user_id, name, location, photo_url, etc.

## That's it! Now you can test the app:

1. Open the app (it's already running on port 5000)
2. Sign up with any email (e.g., test@example.com)
3. Start adding plants!

---

## What happens if I skip this?

- ❌ Sign up will appear to work but sign in will fail
- ❌ "Invalid login credentials" error
- ❌ Can't add plants
- ❌ Database errors in console

## Need help?

See `SETUP.md` for detailed instructions with screenshots and troubleshooting.

---

**✅ Once you complete these 2 steps, the app is fully functional and ready to use!**
