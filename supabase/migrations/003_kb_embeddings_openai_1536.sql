-- DOST Phase 3 Step 2: switch kb_modules embeddings from 1024 (DeepSeek) to 1536 (OpenAI)
-- Paste this entire file into the Supabase SQL Editor, then click Run.
-- Run this ONCE. Running it again drops the embedding column and you would need to re-embed.
-- pgvector cannot ALTER vector(1024) → vector(1536) in place.
-- This script does NOT change kb_modules row-level security.

drop index if exists public.kb_modules_embedding_idx;

alter table public.kb_modules drop column if exists embedding;

alter table public.kb_modules add column embedding vector(1536);

create index kb_modules_embedding_idx
  on public.kb_modules
  using hnsw (embedding vector_cosine_ops);

drop function if exists public.match_modules(vector, double precision, integer);

create function public.match_modules(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 3
)
returns table (
  id text,
  title text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    m.id::text,
    m.module_name as title,
    m.content,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.kb_modules m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_modules(vector, double precision, integer) from public;
grant execute on function public.match_modules(vector, double precision, integer) to authenticated;
grant execute on function public.match_modules(vector, double precision, integer) to service_role;
