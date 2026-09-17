-- DOST: ensure chat Edge Function can write conversations (service_role).
-- Run in Supabase SQL Editor if chat returns HTTP 502.

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

-- Chat + privacy functions use service_role (bypasses RLS). Explicit grants avoid 42501.
revoke all on table public.conversations from public, anon, authenticated;
grant all on table public.conversations to postgres, service_role;
grant select on table public.conversations to authenticated;

notify pgrst, 'reload schema';
