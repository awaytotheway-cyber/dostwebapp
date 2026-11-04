-- 025_listening_summaries_and_understanding.sql
--
-- CAPTURED FROM PRODUCTION, NOT A NEW CHANGE.
--
-- listening_summaries, user_understanding and the two consolidation
-- helper functions were created directly against the project and were
-- never committed, so the repo could not rebuild the database and a
-- deploy from the repo risked losing them. This file is that state
-- written down, verified against the live schema on 2026-10-29.
--
-- Every statement is idempotent: running it against the project that
-- already has these objects changes nothing.
--
-- listening_summaries — one row per listening session, written on the
-- device when a session stops (lib/hearing/sessionSummary.ts). Labels
-- and numbers only: emotion/need counts from the already-redacted
-- transcript, plus averaged acoustic measurements. Never audio, never
-- transcript text.
--
-- inference_source describes the provenance of avg_arousal/avg_valence
-- ONLY. Those two are mocked until Phase 4 validates a real model, so
-- readers must use them only when the tag reads 'acoustic_v1' or
-- 'fused_v1'. The other columns are real throughout.

create table if not exists listening_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references voice_sessions(id) on delete cascade,

  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  session_duration_seconds numeric not null,
  speech_duration_seconds numeric not null default 0,
  total_segments integer not null default 0,
  matched_segments integer not null default 0,

  -- Semantic, from the transcript. Real.
  emotion_counts jsonb not null default '{}'::jsonb,
  dominant_emotion text,
  need_counts jsonb not null default '{}'::jsonb,
  dominant_need text,

  -- Measured acoustics. Real.
  avg_rms_energy numeric,
  avg_pitch_mean_hz numeric,
  avg_pitch_variability numeric,
  avg_speaking_rate_wpm numeric,
  avg_silence_ratio numeric,
  avg_vocal_stress_index numeric,

  -- Inferred acoustics. Mocked until Phase 4 — see inference_source.
  avg_arousal numeric,
  avg_valence numeric,

  inference_source text not null default 'mock'
    check (inference_source in ('mock', 'acoustic_v1', 'fused_v1')),

  created_at timestamptz default now(),

  constraint listening_summaries_session_unique unique (session_id)
);

comment on table listening_summaries is
  'Per-session aggregate of a listening session. Labels and numbers only — never audio or transcript text. avg_arousal/avg_valence are quarantined by inference_source.';

create index if not exists listening_summaries_user_session
  on listening_summaries(user_id, session_started_at desc);
create index if not exists listening_summaries_session
  on listening_summaries(session_id);
create index if not exists listening_summaries_source
  on listening_summaries(inference_source);

alter table listening_summaries enable row level security;

drop policy if exists "own summaries read" on listening_summaries;
create policy "own summaries read" on listening_summaries
  for select using (auth.uid() = user_id);

drop policy if exists "own summaries insert" on listening_summaries;
create policy "own summaries insert" on listening_summaries
  for insert with check (auth.uid() = user_id);

drop policy if exists "own summaries update" on listening_summaries;
create policy "own summaries update" on listening_summaries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own summaries delete" on listening_summaries;
create policy "own summaries delete" on listening_summaries
  for delete using (auth.uid() = user_id);

-- user_understanding — the nightly synthesis of how a person tends to
-- engage. Prose and labels only, never message text. Written by the
-- nightly-consolidation function with the service role; the person can
-- read and delete their own, but never write one by hand.

create table if not exists user_understanding (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  understanding_text text not null,
  recurring_themes text[] default '{}'::text[],
  effective_approaches text[] default '{}'::text[],
  ineffective_approaches text[] default '{}'::text[],
  pacing_preference text,
  unresolved_threads text[] default '{}'::text[],
  engagement_snapshot jsonb,
  message_count_considered integer not null default 0,
  processed_through timestamptz not null,
  created_at timestamptz default now()
);

comment on table user_understanding is
  'Versioned nightly synthesis of user emotional patterns. Labels and prose only — never names, events, or message text.';

create index if not exists user_understanding_user_version
  on user_understanding(user_id, version desc);

alter table user_understanding enable row level security;

drop policy if exists "own understanding read" on user_understanding;
create policy "own understanding read" on user_understanding
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own understanding delete" on user_understanding;
create policy "own understanding delete" on user_understanding
  for delete to authenticated using (auth.uid() = user_id);

-- Helpers used by the nightly-consolidation Edge Function. Both are
-- SECURITY DEFINER so the scheduled run can read across users; neither
-- returns message text.

create or replace function public.get_users_needing_consolidation(min_new_messages integer)
returns table(user_id uuid, since_watermark timestamptz)
language plpgsql
security definer
as $function$
begin
  return query
  select
    m.user_id,
    coalesce(
      (select max(u.processed_through) from user_understanding u where u.user_id = m.user_id),
      '2020-01-01'::timestamptz
    ) as since_watermark
  from message_emotions m
  group by m.user_id
  having count(*) filter (
    where m.created_at > coalesce(
      (select max(u.processed_through) from user_understanding u where u.user_id = m.user_id),
      '2020-01-01'::timestamptz
    )
  ) >= min_new_messages;
end;
$function$;

create or replace function public.compute_engagement_signals(p_user_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_total_messages int;
  v_chip_offered_count int;
  v_chip_selected_count int;
  v_avg_theme_repeat numeric;
  v_max_theme_repeat int;
  v_stage_reached_challenging int;
  v_stage_reached_integration int;
  v_farewell_early_count int;
begin
  select count(*) into v_total_messages
  from message_emotions
  where user_id = p_user_id and created_at > p_since;

  select count(*) into v_chip_offered_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and (array_length(suggested_emotions, 1) > 0 or array_length(suggested_needs, 1) > 0);

  select count(*) into v_chip_selected_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and (selected_emotion is not null or selected_need is not null);

  select avg(theme_repeat_count), max(theme_repeat_count)
    into v_avg_theme_repeat, v_max_theme_repeat
  from message_emotions
  where user_id = p_user_id and created_at > p_since;

  select count(*) into v_stage_reached_challenging
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage in ('challenging_belief', 'integration');

  select count(*) into v_stage_reached_integration
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage = 'integration';

  select count(*) into v_farewell_early_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage = 'closed';

  return jsonb_build_object(
    'total_messages', coalesce(v_total_messages, 0),
    'chip_offer_rate', case when v_total_messages > 0
      then round(v_chip_offered_count::numeric / v_total_messages, 2) else 0 end,
    'chip_acceptance_rate', case when v_chip_offered_count > 0
      then round(v_chip_selected_count::numeric / v_chip_offered_count, 2) else null end,
    'avg_theme_repeat_count', round(coalesce(v_avg_theme_repeat, 0), 2),
    'max_theme_repeat_count', coalesce(v_max_theme_repeat, 0),
    'reached_deeper_stages', coalesce(v_stage_reached_challenging, 0),
    'reached_integration', coalesce(v_stage_reached_integration, 0),
    'conversations_closed', coalesce(v_farewell_early_count, 0)
  );
end;
$function$;
