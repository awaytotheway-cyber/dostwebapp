-- DOST Loop System: user_understanding table
-- Stores versioned, evolving understanding of each user.
-- New row inserted each nightly consolidation cycle (never edited in place).
-- Gives full history of how understanding evolved, and trivial rollback.

create table if not exists public.user_understanding (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null,

  understanding_text text not null,
  recurring_themes text[] default '{}',
  effective_approaches text[] default '{}',
  ineffective_approaches text[] default '{}',
  pacing_preference text,
  unresolved_threads text[] default '{}',

  engagement_snapshot jsonb,
  message_count_considered int not null default 0,
  processed_through timestamptz not null,

  created_at timestamptz default now()
);

alter table public.user_understanding enable row level security;

revoke all on table public.user_understanding from public, anon;
grant select on table public.user_understanding to authenticated;
grant all on table public.user_understanding to postgres, service_role;

create policy "own understanding read" on public.user_understanding
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "own understanding delete" on public.user_understanding
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index user_understanding_user_version
  on public.user_understanding(user_id, version desc);

comment on table public.user_understanding is
  'Versioned nightly synthesis of user emotional patterns. Labels and prose only — never names, events, or message text.';

notify pgrst, 'reload schema';
