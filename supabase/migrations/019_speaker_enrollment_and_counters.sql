-- Hearing Phase 2: speaker verification enrollment + per-session
-- verification counters.
--
-- speaker_enrollment  one row per user, holding their reference
--                     voiceprint. The voiceprint is a fixed-length
--                     vector derived from a few short enrollment clips;
--                     the clips themselves are never stored. Dimension
--                     26 matches the Path 2 MFCC fingerprint (13 means
--                     + 13 stds). If a viable pretrained embedding
--                     model lands, this column is altered to that
--                     model's output dimension in a follow-up migration.
--
-- voice_sessions.segments_matched
-- voice_sessions.segments_discarded_other_speaker
-- voice_sessions.segments_discarded_ambiguous
--                     Verification counters. Rule 5 of Phase 2: an
--                     ambiguous segment is discarded, not stored — we
--                     favor privacy over data completeness.

create table if not exists speaker_enrollment (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voiceprint vector(26),
  enrollment_method text check (enrollment_method in ('embedding_model', 'mfcc_fingerprint')),
  model_version text,
  clips_used int not null default 0,
  enrolled_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table speaker_enrollment enable row level security;

create policy "own enrollment read" on speaker_enrollment
  for select using (auth.uid() = user_id);
create policy "own enrollment insert" on speaker_enrollment
  for insert with check (auth.uid() = user_id);
create policy "own enrollment update" on speaker_enrollment
  for update using (auth.uid() = user_id);
create policy "own enrollment delete" on speaker_enrollment
  for delete using (auth.uid() = user_id);

alter table voice_sessions
  add column if not exists segments_matched int default 0,
  add column if not exists segments_discarded_other_speaker int default 0,
  add column if not exists segments_discarded_ambiguous int default 0;
