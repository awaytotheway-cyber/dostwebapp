-- DOST Step 8C: messages table + Row Level Security
-- Paste this entire file into the Supabase SQL Editor, then click Run.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint messages_message_length_check check (char_length(message) <= 2000),
  constraint messages_role_check check (role in ('user', 'assistant'))
);

create index messages_user_id_created_at_idx
  on public.messages (user_id, created_at);

alter table public.messages enable row level security;

create policy "messages_select_own"
  on public.messages
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "messages_update_own"
  on public.messages
  for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);
