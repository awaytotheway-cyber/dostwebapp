-- Align the Phase 3 chat schema with the chat Edge Function.
-- The 31st message inside one minute is rejected.

create table if not exists public.chat_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  constraint chat_rate_limits_count_check check (count >= 0)
);

alter table public.chat_rate_limits enable row level security;
revoke all on table public.chat_rate_limits from public, anon, authenticated;
grant all on table public.chat_rate_limits to postgres, service_role;
notify pgrst, 'reload schema';
