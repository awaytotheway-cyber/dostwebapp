-- DOST Phase 3 Step 4: persistent user memory (rolling summary)
-- Paste this entire file into the Supabase SQL Editor, then click Run.

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users (id) on delete cascade,
  summary text,
  patterns jsonb,
  last_updated timestamptz default now()
);

alter table public.user_memory enable row level security;

drop policy if exists "own memory read" on public.user_memory;
create policy "own memory read"
  on public.user_memory
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own memory write" on public.user_memory;
create policy "own memory write"
  on public.user_memory
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own memory update" on public.user_memory;
create policy "own memory update"
  on public.user_memory
  for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

-- Service-role only. The update-memory Edge Function uses this to avoid hammering DeepSeek.
create table if not exists public.memory_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0
);

alter table public.memory_rate_limits enable row level security;
revoke all on table public.memory_rate_limits from anon, authenticated;
