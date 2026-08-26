-- DOST Phase 3 Step 6: export rate-limit + privacy notes
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Conversation delete is NOT a client RLS policy. Phase 2 forbade client
-- update/delete on conversations. Privacy delete is done by the
-- delete-conversations Edge Function (JWT via getUser + service_role
-- delete for that user only).
--
-- Account delete is done by the delete-account Edge Function, which calls
-- auth.admin.deleteUser after JWT identifies the user. Related rows cascade
-- via ON DELETE CASCADE on auth.users.

-- Service-role only. The export-data Edge Function uses this to cap exports at 3/day.
create table if not exists public.export_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0
);

alter table public.export_rate_limits enable row level security;
revoke all on table public.export_rate_limits from public, anon, authenticated;
grant all on table public.export_rate_limits to postgres, service_role;
notify pgrst, 'reload schema';

-- No client policies on export_rate_limits. The function uses the service role (bypasses RLS).
