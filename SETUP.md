# GreenThumb Setup Guide

## Supabase Setup

Your GreenThumb app is almost ready! You need to configure authentication and set up the database in Supabase.

### Step 1: Disable Email Confirmation (For Testing)

**Important**: By default, Supabase requires users to confirm their email before they can sign in. For easier testing, you should disable this:

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** > **Providers** > **Email**
3. Scroll down to find **Confirm email** setting
4. **Disable** the "Confirm email" toggle
5. Click **Save**

Now users can sign in immediately after signing up without email confirmation.

### Step 2: Open Supabase SQL Editor

1. Go to your Supabase project dashboard
2. Navigate to the **SQL Editor** section in the left sidebar
3. Click **New Query**

### Step 3: Run the Setup SQL

Copy the entire contents of `supabase_setup.sql` and paste it into the SQL editor, then click **Run**.

This will:
- ✅ Create the `plants` table with all required fields
- ✅ Enable Row Level Security (RLS) to protect user data
- ✅ Create policies so users can only see and manage their own plants
- ✅ Add database indexes for better performance

### Step 4: Verify Setup

After running the SQL, you should see:
- A success message: "GreenThumb database setup complete!"
- The `plants` table should appear in your Tables section

### Step 5: Start Using the App

That's it! Your app is now ready to use. The authentication and database are fully configured with:

- **Secure Authentication**: Email/password sign up and sign in
- **Data Isolation**: Each user can only see their own plants (enforced by RLS)
- **Real-time Updates**: Changes sync automatically across devices
- **Mobile-First Design**: Beautiful responsive UI that works on all screen sizes

## Features

### Dashboard
- Smart sorting: Plants needing water appear first
- Visual status indicators (overdue, due today, all good)
- One-tap watering with optimistic updates
- Responsive grid layout (1 column mobile, 2 tablet, 3 desktop)

### Add Plant
- Simple form with validation
- Photo URL support (image upload can be added later)
- Customizable watering frequency
- Optional notes field

### Plant Details
- Large plant photo display
- Next watering calculation
- Watering history
- Delete plant option

### Profile
- User account management
- Secure sign out

## PWA Support

The app is configured as a Progressive Web App (PWA):
- Install on mobile devices
- Offline-ready manifest
- App-like experience

## Default Plant Photo URLs

If you want to test with sample plants, here are some free plant image URLs:

```
https://images.unsplash.com/photo-1509937528035-ad76254b0356
https://images.unsplash.com/photo-1463936575829-25148e1db1b8
https://images.unsplash.com/photo-1558603668-6570496b66f8
https://images.unsplash.com/photo-1416879595882-3373a0480b5b
```

## Troubleshooting

### "Missing Supabase environment variables" error
- Make sure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in your environment variables
- Restart the development server after adding env vars

### "Insert failed" or "Select failed" errors
- Verify you ran the `supabase_setup.sql` script
- Check that RLS policies are enabled in Supabase dashboard

### Plants not showing up
- Make sure you're signed in with the same account that created the plants
- Check browser console for any error messages

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript
- **UI**: Shadcn/ui + Tailwind CSS
- **Backend**: Supabase (Auth + PostgreSQL)
- **State**: TanStack Query (React Query)
- **Routing**: Wouter
- **Forms**: React Hook Form + Zod
- **Dates**: date-fns
