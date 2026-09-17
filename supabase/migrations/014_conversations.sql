-- DOST: chat message storage (live table for the chat Edge Function)
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- public.messages from 001_messages_rls.sql is legacy/unused. Live chat reads and
-- writes public.conversations (role + content). message_emotions FKs here.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint conversations_content_length_check check (char_length(content) <= 2000),
  constraint conversations_role_check check (role in ('user', 'assistant'))
);

create index if not exists conversations_user_id_created_at_idx
  on public.conversations (user_id, created_at);

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

-- Inserts/updates/deletes are service-role only (chat Edge Function + privacy fns).
-- No client insert policy by design (Phase 2 privacy model).

notify pgrst, 'reload schema';
