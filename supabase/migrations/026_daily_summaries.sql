-- Your Patterns: one short reflection per person, local day and language,
-- written by the generate-day-summary function from the person's own typed
-- messages that day plus that day's confident emotion labels.
--
-- Readable only by its owner; written only by the function (service role).
-- Removed with the account (cascade) and by delete-conversations, and
-- included in export-data.

create table if not exists public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  language text not null default 'en',
  tone text not null,
  feelings text[] not null default '{}'::text[],
  summary text not null,
  safety boolean not null default false,
  -- Identifies the messages the summary was written from; a different
  -- fingerprint means the day changed and the summary is rewritten.
  source_fingerprint text not null,
  generated_at timestamptz not null default now(),
  constraint daily_summaries_tone_check check (tone in ('light', 'mixed', 'heavy')),
  constraint daily_summaries_summary_length_check check (char_length(summary) between 1 and 1000),
  constraint daily_summaries_user_day_language_key unique (user_id, day, language)
);

create index if not exists daily_summaries_user_day_idx
  on public.daily_summaries (user_id, day desc);

alter table public.daily_summaries enable row level security;

drop policy if exists "daily_summaries_select_own" on public.daily_summaries;
create policy "daily_summaries_select_own"
  on public.daily_summaries
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

revoke all on table public.daily_summaries from public, anon, authenticated;
grant all on table public.daily_summaries to postgres, service_role;
grant select on table public.daily_summaries to authenticated;

comment on table public.daily_summaries is
  'Your Patterns day reflections. Derived from the owner''s own messages; never shown to anyone else.';

-- Per-person generation cap (rolling 24 h), as chat_rate_limits does for chat.
create table if not exists public.daily_summary_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  constraint daily_summary_rate_limits_count_check check (count >= 0)
);

alter table public.daily_summary_rate_limits enable row level security;
revoke all on table public.daily_summary_rate_limits from public, anon, authenticated;
grant all on table public.daily_summary_rate_limits to postgres, service_role;

notify pgrst, 'reload schema';
