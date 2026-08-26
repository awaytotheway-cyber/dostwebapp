-- DOST Phase 3 Step 5: daily reflection loop
-- Paste this entire file into the Supabase SQL Editor, then click Run.

alter table public.profiles
  add column if not exists reflection_time time default '20:00';

create table if not exists public.daily_intentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  for_date date not null,
  intentions text[] not null,
  created_at timestamptz default now()
);

create unique index if not exists daily_intentions_user_id_for_date_idx
  on public.daily_intentions (user_id, for_date);

alter table public.daily_intentions enable row level security;

drop policy if exists "own intentions" on public.daily_intentions;
create policy "own intentions"
  on public.daily_intentions
  for all
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

grant select, insert, update, delete on table public.daily_intentions to authenticated;
