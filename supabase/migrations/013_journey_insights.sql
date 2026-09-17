-- DOST Home Step 9: cached journey insights (one soft reflection per range / day)
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Stores DOST-voiced paragraphs generated from emotion/need aggregates only —
-- never message text, names, or events. Regenerated at most once per day per range
-- by the generate-journey-insight Edge Function (service role upsert).

create table if not exists public.journey_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  range_key text not null,
  insight_text text not null,
  emotion_counts jsonb not null default '{}'::jsonb,
  top_needs text[] not null default '{}'::text[],
  generated_at timestamptz not null default now(),
  constraint journey_insights_range_key_check
    check (range_key in ('7d', '30d', 'all')),
  constraint journey_insights_user_range_key unique (user_id, range_key)
);

comment on table public.journey_insights is
  'Cached DOST journey reflections. Pattern/need aggregates only — never message text.';

comment on column public.journey_insights.range_key is
  'Time window: 7d, 30d, or all.';

comment on column public.journey_insights.insight_text is
  'Warm DOST-voiced paragraph. No clinical language; no PII.';

comment on column public.journey_insights.emotion_counts is
  'Snapshot of emotion token → count used to generate the insight.';

comment on column public.journey_insights.top_needs is
  'Top NVC need tokens at generation time.';

create index if not exists journey_insights_user_generated
  on public.journey_insights (user_id, generated_at desc);

alter table public.journey_insights enable row level security;

revoke all on table public.journey_insights from public, anon;
grant select on table public.journey_insights to authenticated;

drop policy if exists "own journey insights read" on public.journey_insights;
create policy "own journey insights read"
  on public.journey_insights
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

-- Writes are service-role only (Edge Function). No insert/update for authenticated.

notify pgrst, 'reload schema';
