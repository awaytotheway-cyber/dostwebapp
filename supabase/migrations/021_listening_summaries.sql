-- Phase 3 Step 1: per-session listening summaries.
--
-- One row per completed voice_session. Holds ONLY labels and numbers:
-- emotion tokens, need tokens, counts, averages. Never a transcript
-- fragment, never audio, never free text beyond the fixed label
-- vocabulary defined by hearing-extract-emotions.
--
-- Privacy boundary is absolute.

create table if not exists listening_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references voice_sessions(id) on delete cascade,

  -- When the session ran
  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  session_duration_seconds numeric not null,
  speech_duration_seconds numeric not null default 0,

  -- Segment counts
  total_segments int not null default 0,
  matched_segments int not null default 0,

  -- Emotion distribution: {"sad": 3, "anxious": 2, "calm": 1}
  emotion_counts jsonb not null default '{}'::jsonb,
  -- The single most frequent emotion
  dominant_emotion text,

  -- Need distribution: {"connection": 2, "safety": 1}
  need_counts jsonb not null default '{}'::jsonb,
  dominant_need text,

  -- Acoustic averages across matched segments
  avg_rms_energy numeric,
  avg_pitch_mean_hz numeric,
  avg_pitch_variability numeric,
  avg_speaking_rate_wpm numeric,
  avg_silence_ratio numeric,
  avg_vocal_stress_index numeric,

  -- Acoustic inference averages (only non-mock segments)
  avg_arousal numeric,
  avg_valence numeric,

  created_at timestamptz default now()
);

alter table listening_summaries enable row level security;

create policy "own summaries read" on listening_summaries
  for select using (auth.uid() = user_id);
create policy "own summaries insert" on listening_summaries
  for insert with check (auth.uid() = user_id);
create policy "own summaries delete" on listening_summaries
  for delete using (auth.uid() = user_id);

create index if not exists listening_summaries_user_session
  on listening_summaries(user_id, session_started_at desc);
create index if not exists listening_summaries_session
  on listening_summaries(session_id);

-- Unique constraint: one summary per session
alter table listening_summaries
  add constraint listening_summaries_session_unique unique (session_id);
