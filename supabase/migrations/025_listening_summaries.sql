-- Hearing Phase 3: per-session listening summaries.
--
-- One row per completed listening session. Written on-device by
-- lib/hearing/sessionSummary.ts when stopHearingSession() finishes,
-- aggregated from that session's voice_signals rows.
--
-- WHAT GOES IN HERE: labels and numbers only.
--   • counts and distributions of emotion/need tokens (semantic, real)
--   • averages of measured acoustic features (real DSP measurements)
--   • averaged acoustic *inference* (arousal/valence) — quarantined,
--     see inference_source below
--
-- WHAT NEVER GOES IN HERE: audio bytes, transcript text, raw PCM,
-- anything a person said. Same absolute rule as voice_signals.
--
-- ── The inference_source quarantine ────────────────────────────────
-- Two different kinds of data live in this table and they have very
-- different trustworthiness:
--
--   REAL     emotion_counts / dominant_emotion / need_counts        →
--            semantic tokens from the transcript via
--            hearing-extract-emotions. Trustworthy.
--   REAL     avg_speaking_rate_wpm / avg_pitch_* / avg_rms_energy /
--            avg_silence_ratio / avg_vocal_stress_index             →
--            direct signal measurements. Trustworthy.
--   MOCK     avg_arousal / avg_valence                              →
--            acoustic emotion inference. Faked since Phase 1.
--
-- inference_source describes the provenance of avg_arousal and
-- avg_valence ONLY — nothing else in the row. Consumers (the chat
-- edge function and nightly-consolidation) must read arousal/valence
-- only when inference_source <> 'mock'. The writer additionally
-- stores NULL for both whenever the underlying segments were all
-- mock, so the quarantine holds even if a consumer forgets to filter.
--
-- This migration is idempotent: it both creates the table fresh (new
-- environments) and brings an already-created table up to date (the
-- live project, where the table was applied out-of-band as
-- 20261013163607_listening_summaries).

create table if not exists listening_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references voice_sessions(id) on delete cascade,

  -- Not-null-ness here mirrors the live table exactly: a summary is
  -- written only for a session that has ended, so its times, durations
  -- and counts are always known. The writer always supplies them.
  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  session_duration_seconds numeric not null,
  speech_duration_seconds numeric not null default 0,

  total_segments int not null default 0,
  matched_segments int not null default 0,

  -- SEMANTIC (real — from transcript via hearing-extract-emotions)
  -- The counts are never null — an empty object means "nothing heard"
  -- — but the dominant token is null when the counts are empty.
  emotion_counts jsonb not null default '{}'::jsonb,
  dominant_emotion text,
  need_counts jsonb not null default '{}'::jsonb,
  dominant_need text,

  -- MEASURED ACOUSTIC FEATURES (real — signal processing, not emotion)
  avg_rms_energy numeric,
  avg_pitch_mean_hz numeric,
  avg_pitch_variability numeric,
  avg_speaking_rate_wpm numeric,
  avg_silence_ratio numeric,
  avg_vocal_stress_index numeric,

  -- ACOUSTIC EMOTION INFERENCE (quarantined — see header)
  avg_arousal numeric,
  avg_valence numeric,

  created_at timestamptz default now()
);

-- Brings the live table (created without it) up to date.
alter table listening_summaries
  add column if not exists inference_source text not null default 'mock';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listening_summaries_inference_source_check'
  ) then
    alter table listening_summaries
      add constraint listening_summaries_inference_source_check
      check (inference_source in ('mock', 'acoustic_v1', 'fused_v1'));
  end if;
end $$;

comment on table listening_summaries is
  'Per-session aggregate of a listening session. Labels and numbers only — never audio or transcript text. avg_arousal/avg_valence are quarantined by inference_source.';
comment on column listening_summaries.inference_source is
  'Provenance of avg_arousal/avg_valence ONLY. ''mock'' means they are not real and both are NULL. Semantic and measured-feature columns are real regardless of this value.';

alter table listening_summaries enable row level security;

drop policy if exists "own summaries read" on listening_summaries;
drop policy if exists "own summaries insert" on listening_summaries;
drop policy if exists "own summaries update" on listening_summaries;
drop policy if exists "own summaries delete" on listening_summaries;

create policy "own summaries read" on listening_summaries
  for select using (auth.uid() = user_id);
create policy "own summaries insert" on listening_summaries
  for insert with check (auth.uid() = user_id);
-- UPDATE is needed so the device-side writer can upsert on
-- session_id: a retried session-stop must be idempotent, not a
-- duplicate-key error.
create policy "own summaries update" on listening_summaries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own summaries delete" on listening_summaries
  for delete using (auth.uid() = user_id);

create unique index if not exists listening_summaries_session_unique
  on listening_summaries(session_id);
create index if not exists listening_summaries_user_session
  on listening_summaries(user_id, session_started_at desc);
create index if not exists listening_summaries_session
  on listening_summaries(session_id);
create index if not exists listening_summaries_source
  on listening_summaries(inference_source);
