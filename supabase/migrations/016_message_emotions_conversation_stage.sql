-- DOST Revolution Step 2: conversation-stage tracking on message_emotions
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Tracks where the user is in a reflective conversation (meeting → integration)
-- and which emotions/needs were suggested vs chosen. PII rule unchanged: labels only.

alter table public.message_emotions
  add column if not exists conversation_stage text
    check (conversation_stage in (
      'meeting', 'naming_emotion', 'naming_need', 'exploring_origin',
      'surfacing_myth', 'challenging_belief', 'integration', 'closed'
    )) default 'meeting',
  add column if not exists suggested_emotions text[] default '{}'::text[],
  add column if not exists suggested_needs text[] default '{}'::text[],
  add column if not exists selected_emotion text,
  add column if not exists selected_need text,
  add column if not exists theme_repeat_count int default 0;

update public.message_emotions
set conversation_stage = 'meeting'
where conversation_stage is null;

update public.message_emotions
set suggested_emotions = '{}'::text[]
where suggested_emotions is null;

update public.message_emotions
set suggested_needs = '{}'::text[]
where suggested_needs is null;

update public.message_emotions
set theme_repeat_count = 0
where theme_repeat_count is null;

alter table public.message_emotions
  alter column conversation_stage set default 'meeting',
  alter column suggested_emotions set default '{}'::text[],
  alter column suggested_needs set default '{}'::text[],
  alter column theme_repeat_count set default 0;

comment on column public.message_emotions.conversation_stage is
  'Reflective conversation phase: meeting through closed. Labels only — no message text.';

comment on column public.message_emotions.suggested_emotions is
  'Emotion/pattern labels offered to the user at this turn. Never names or events.';

comment on column public.message_emotions.suggested_needs is
  'NVC need labels offered to the user at this turn. Never names or events.';

comment on column public.message_emotions.selected_emotion is
  'Emotion/pattern label the user chose from suggestions (if any).';

comment on column public.message_emotions.selected_need is
  'Need label the user chose from suggestions (if any).';

comment on column public.message_emotions.theme_repeat_count is
  'How many times the same underlying theme has surfaced in this conversation arc.';

notify pgrst, 'reload schema';
