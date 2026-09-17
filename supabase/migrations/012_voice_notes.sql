-- DOST Home + Voice Notes Step 1: voice_notes table + storage RLS
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Dashboard (do this once before or after running this SQL):
--   Storage → New bucket
--   Name: voice-notes-audio
--   Public: NO (private)
--   File size limit: 10 MB
--   Allowed MIME types: audio/*
-- The bucket is created in the Dashboard; this migration only adds storage.objects policies.
--
-- Transcripts are the primary content (searchable, analyzable). Audio is optional —
-- audio_storage_path may be null for a privacy-first, transcript-only approach.

create table if not exists public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  duration_seconds numeric not null,
  transcript text not null,
  dost_response text,
  primary_emotion text,
  secondary_emotions text[],
  underlying_need text,
  audio_storage_path text,
  created_at timestamptz default now()
);

comment on table public.voice_notes is
  'First-class voice notes: transcript is primary; audio_storage_path is optional.';

comment on column public.voice_notes.audio_storage_path is
  'Optional path in the private voice-notes-audio storage bucket (e.g. {user_id}/{id}.m4a).';

comment on column public.voice_notes.primary_emotion is
  'Pattern label only. Never include names or events.';

comment on column public.voice_notes.secondary_emotions is
  'Optional extra pattern labels. Never include names or events.';

comment on column public.voice_notes.underlying_need is
  'Nonviolent-communication need labels. Never include names or events.';

create index if not exists voice_notes_user_created
  on public.voice_notes (user_id, created_at desc);

alter table public.voice_notes enable row level security;

revoke all on table public.voice_notes from public, anon;
grant select, insert, delete on table public.voice_notes to authenticated;

drop policy if exists "own voice notes read" on public.voice_notes;
create policy "own voice notes read"
  on public.voice_notes
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own voice notes insert" on public.voice_notes;
create policy "own voice notes insert"
  on public.voice_notes
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own voice notes delete" on public.voice_notes;
create policy "own voice notes delete"
  on public.voice_notes
  for delete
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private bucket voice-notes-audio (create in Dashboard — see header)
-- Objects should be stored under {auth.uid()}/... so foldername[1] matches.
-- ---------------------------------------------------------------------------

drop policy if exists "own audio read" on storage.objects;
create policy "own audio read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-notes-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own audio insert" on storage.objects;
create policy "own audio insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-notes-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own audio delete" on storage.objects;
create policy "own audio delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'voice-notes-audio'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
