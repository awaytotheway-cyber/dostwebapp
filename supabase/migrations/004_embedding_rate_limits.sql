-- DOST Phase 3 Step 3: embedding rate-limit table (100/hour per user)
-- Paste this entire file into the Supabase SQL Editor, then click Run.
-- Chat still works if you have not run this yet; RAG will work, but the
-- 100 embeddings/hour cap is only enforced after this table exists.

create table if not exists public.embedding_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null
);

alter table public.embedding_rate_limits enable row level security;

-- No client policies: app users cannot read or write this table.
-- The chat Edge Function uses the service role (bypasses RLS).
revoke all on table public.embedding_rate_limits from anon, authenticated;
