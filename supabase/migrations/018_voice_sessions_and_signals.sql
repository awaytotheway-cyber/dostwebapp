-- Hearing Phase 1: session-based voice capture tables.
--
-- voice_sessions   one row per listening session started explicitly by
--                  the user in the app. Owns totals for total/speech
--                  duration and segments processed.
-- voice_signals    one row per VAD-detected speech segment inside a
--                  session. Acoustic columns are real measurements from
--                  the on-device signal processing pipeline. Semantic
--                  columns are emotion/need tags from the redacted
--                  transcript. Acoustic emotion inference columns are
--                  quarantined by the inference_source column — DOST's
--                  chat function filters WHERE inference_source != 'mock'.
--
-- Absolute rule: never store audio bytes or raw transcript here.

create table if not exists voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  total_duration_seconds numeric,
  speech_duration_seconds numeric,
  segments_processed int default 0,
  battery_mode text check (battery_mode in ('attentive','balanced','light')) default 'balanced',
  created_at timestamptz default now()
);

create table if not exists voice_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references voice_sessions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  segment_duration_seconds numeric not null,

  -- ACOUSTIC SIGNALS (real measurements, not emotions)
  rms_energy numeric,
  pitch_mean_hz numeric,
  pitch_variability numeric,
  speaking_rate_wpm numeric,
  silence_ratio numeric,
  vocal_stress_index numeric,

  -- SEMANTIC (from transcript via existing Phase 5 pipeline — real)
  primary_emotion text,
  secondary_emotions text[],
  underlying_need text,
  semantic_confidence numeric,

  -- ACOUSTIC EMOTION INFERENCE (mocked in Phase 1)
  acoustic_arousal numeric,
  acoustic_valence numeric,
  inference_source text not null
    check (inference_source in ('mock','acoustic_v1','fused_v1'))
    default 'mock',

  created_at timestamptz default now()
);

alter table voice_sessions enable row level security;
alter table voice_signals enable row level security;

create policy "own sessions read" on voice_sessions for select using (auth.uid() = user_id);
create policy "own sessions insert" on voice_sessions for insert with check (auth.uid() = user_id);
create policy "own sessions update" on voice_sessions for update using (auth.uid() = user_id);
create policy "own sessions delete" on voice_sessions for delete using (auth.uid() = user_id);

create policy "own signals read" on voice_signals for select using (auth.uid() = user_id);
create policy "own signals insert" on voice_signals for insert with check (auth.uid() = user_id);
create policy "own signals delete" on voice_signals for delete using (auth.uid() = user_id);

create index if not exists voice_signals_user_captured on voice_signals(user_id, captured_at desc);
create index if not exists voice_signals_session on voice_signals(session_id);
create index if not exists voice_signals_source on voice_signals(inference_source);
