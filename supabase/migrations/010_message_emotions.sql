-- DOST Phase 5 Step 1: emotion/need metadata per chat message
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Chat messages live in public.conversations (one row per turn: user or assistant).
-- That is the table the chat Edge Function writes to. Do not FK to public.messages
-- from 001_messages_rls.sql — that table is unused by live chat.
--
-- Encryption decision:
-- Supabase already encrypts database disks at rest (AES-256). This project has no
-- pgsodium, Vault, or column-level encryption set up. Extra column encryption is
-- not used here because these fields store only pattern/need labels (not names,
-- events, or message text), and later steps must query and aggregate them.
-- Access is limited by RLS (users only see their own rows).
--
-- PII rule: store emotion patterns and NVC needs only — never names, events, or
-- quoted message content. Never log full message text.

create table if not exists public.message_emotions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.conversations (id) on delete cascade,
  primary_emotion text,
  secondary_emotions text[],
  underlying_need text,
  confidence_score numeric,
  created_at timestamptz not null default now(),
  constraint message_emotions_message_id_key unique (message_id),
  constraint message_emotions_confidence_score_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

comment on table public.message_emotions is
  'Emotion/need tags for one conversations row. Patterns and needs only — never names, events, or message text. At-rest encryption is Supabase disk encryption; labels stay in plaintext columns so they can be queried.';

comment on column public.message_emotions.message_id is
  'FK to public.conversations.id (the actual chat message row).';

comment on column public.message_emotions.primary_emotion is
  'Pattern label only (e.g. shame, anger_grief). Never include names or events.';

comment on column public.message_emotions.secondary_emotions is
  'Optional extra pattern labels. Never include names or events.';

comment on column public.message_emotions.underlying_need is
  'Nonviolent-communication need labels (e.g. safety, autonomy). Never include names or events.';

create index if not exists message_emotions_user_created
  on public.message_emotions (user_id, created_at desc);

alter table public.message_emotions enable row level security;

revoke all on table public.message_emotions from public, anon;
grant select, insert on table public.message_emotions to authenticated;

drop policy if exists "own emotions read" on public.message_emotions;
create policy "own emotions read"
  on public.message_emotions
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own emotions insert" on public.message_emotions;
create policy "own emotions insert"
  on public.message_emotions
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

-- No update/delete policies: Step 2 only inserts. Deleting a conversation row
-- or a user account removes related emotion rows via ON DELETE CASCADE.

notify pgrst, 'reload schema';
