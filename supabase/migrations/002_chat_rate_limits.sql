-- DOST Step 8D: chat rate-limit table
-- Paste this entire file into the Supabase SQL Editor, then click Run.
-- If you have not run 001_messages_rls.sql yet, run that one first, then this one.

create table public.chat_rate_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index chat_rate_events_user_id_created_at_idx
  on public.chat_rate_events (user_id, created_at);

alter table public.chat_rate_events enable row level security;

-- No client policies: app users cannot read or write this table.
-- The chat Edge Function uses the service role (bypasses RLS).
revoke all on table public.chat_rate_events from anon, authenticated;
