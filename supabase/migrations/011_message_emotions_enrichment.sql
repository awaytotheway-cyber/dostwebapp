-- DOST Emotional Intelligence Enhancement: enrich message_emotions
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Adds primary_emotions / needs arrays, intensity scores, ambiguity flag,
-- and a short explanation field. Keeps legacy primary_emotion / underlying_need
-- columns populated for backward compatibility with older readers.
--
-- PII rule unchanged: pattern/need labels and thematic explanations only —
-- never names, events, or full message text.

alter table public.message_emotions
  add column if not exists primary_emotions text[] default '{}'::text[],
  add column if not exists needs text[] default '{}'::text[],
  add column if not exists emotion_intensities jsonb default '{}'::jsonb,
  add column if not exists is_ambiguous boolean not null default false,
  add column if not exists explanation text;

-- Backfill arrays from legacy single-value columns where missing.
update public.message_emotions
set primary_emotions = array[primary_emotion]
where (primary_emotions is null or cardinality(primary_emotions) = 0)
  and primary_emotion is not null
  and length(trim(primary_emotion)) > 0;

update public.message_emotions
set needs = array[underlying_need]
where (needs is null or cardinality(needs) = 0)
  and underlying_need is not null
  and length(trim(underlying_need)) > 0;

alter table public.message_emotions
  alter column primary_emotions set default '{}'::text[],
  alter column needs set default '{}'::text[],
  alter column emotion_intensities set default '{}'::jsonb,
  alter column is_ambiguous set default false;

update public.message_emotions
set primary_emotions = '{}'::text[]
where primary_emotions is null;

update public.message_emotions
set needs = '{}'::text[]
where needs is null;

update public.message_emotions
set emotion_intensities = '{}'::jsonb
where emotion_intensities is null;

alter table public.message_emotions
  alter column primary_emotions set not null,
  alter column needs set not null,
  alter column emotion_intensities set not null,
  alter column is_ambiguous set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_emotions'::regclass
      and conname = 'message_emotions_primary_emotions_len_check'
  ) then
    alter table public.message_emotions
      add constraint message_emotions_primary_emotions_len_check
      check (cardinality(primary_emotions) <= 2);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_emotions'::regclass
      and conname = 'message_emotions_secondary_emotions_len_check'
  ) then
    alter table public.message_emotions
      add constraint message_emotions_secondary_emotions_len_check
      check (
        secondary_emotions is null
        or cardinality(secondary_emotions) <= 3
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_emotions'::regclass
      and conname = 'message_emotions_needs_len_check'
  ) then
    alter table public.message_emotions
      add constraint message_emotions_needs_len_check
      check (cardinality(needs) <= 3);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_emotions'::regclass
      and conname = 'message_emotions_explanation_len_check'
  ) then
    alter table public.message_emotions
      add constraint message_emotions_explanation_len_check
      check (explanation is null or char_length(explanation) <= 1200);
  end if;
end $$;

comment on column public.message_emotions.primary_emotions is
  '1–2 primary emotion/pattern labels. Never names, events, or message text.';

comment on column public.message_emotions.secondary_emotions is
  '0–3 secondary emotion/pattern labels. Never names, events, or message text.';

comment on column public.message_emotions.needs is
  '1–3 NVC-style unmet need labels. Never names, events, or message text.';

comment on column public.message_emotions.emotion_intensities is
  'JSONB map of emotion label → intensity 1–5. Keys are labels only.';

comment on column public.message_emotions.is_ambiguous is
  'True when extraction confidence stayed below threshold after reconsideration.';

comment on column public.message_emotions.explanation is
  'Short thematic rationale for emotion/need choices. No names, events, or long quotes.';

comment on column public.message_emotions.primary_emotion is
  'Legacy single primary label (first of primary_emotions). Kept for older readers.';

comment on column public.message_emotions.underlying_need is
  'Legacy single need label (first of needs). Kept for older readers.';

create index if not exists message_emotions_user_ambiguous_created
  on public.message_emotions (user_id, is_ambiguous, created_at desc);

-- Step 4.2 scaffolding: daily extraction quality (confidence + ambiguity).
-- Labels/scores only — never message text. security_invoker keeps RLS so
-- authenticated users only see their own aggregates; service role sees all.
create or replace view public.message_emotions_quality_metrics
with (security_invoker = true) as
select
  user_id,
  (date_trunc('day', created_at at time zone 'utc'))::date as day_utc,
  count(*)::bigint as extractions,
  round(avg(confidence_score)::numeric, 3) as avg_confidence,
  count(*) filter (where is_ambiguous)::bigint as ambiguous_count,
  round(
    (count(*) filter (where is_ambiguous))::numeric / nullif(count(*), 0),
    3
  ) as ambiguous_rate
from public.message_emotions
group by 1, 2;

comment on view public.message_emotions_quality_metrics is
  'EI Step 4.2: per-user daily avg confidence and ambiguous rate. No message text. Review monthly (Step 4.3) and feed hard cases back into extract-emotions few-shots.';

grant select on public.message_emotions_quality_metrics to authenticated;

notify pgrst, 'reload schema';
