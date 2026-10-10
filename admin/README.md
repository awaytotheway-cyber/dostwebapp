# DOST admin

Separate web app for editing onboarding questions shown in the mobile app.

There is **no login** yet. Run this only on your own machine.

## Run

1. Copy `.env.example` to `.env.local` (same Supabase project as the mobile app).
2. Apply the database migration `supabase/migrations/023_admin_onboarding.sql` if it is not on the project yet:

   `npx supabase db push`

3. Install and start:

   ```bash
   cd admin
   npm install
   npm run dev
   ```

   Opens at http://127.0.0.1:5174

## What it does

- Add an extra onboarding screen (short text or single choice).
- Edit the question title, subtitle, options, order, required, and active flags.
- Active screens appear in the Dost app after the Varna step and before Confirm.
