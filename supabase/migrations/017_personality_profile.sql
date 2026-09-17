-- DOST Personality Profile onboarding Step 1: personality_profile table
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- One row per user (user_id primary key). Optional personality modules
-- (dosha, enneagram, life path, TCM, MBTI). All profile fields are nullable;
-- modules can be skipped and tracked in completed_modules / skipped_modules.
-- Labels only — no message text or PII.

create table if not exists public.personality_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dosha_body text,
  dosha_mind text,
  enneagram_type int check (enneagram_type between 1 and 9),
  enneagram_source text check (enneagram_source in ('quiz', 'self_report')),
  life_path_number int,
  tcm_element text check (tcm_element in ('Wood', 'Fire', 'Earth', 'Metal', 'Water')),
  tcm_emotional_state text,
  tcm_climate_preference text,
  mbti_type text,
  completed_modules text[] default '{}'::text[],
  skipped_modules text[] default '{}'::text[],
  updated_at timestamptz default now()
);

comment on table public.personality_profile is
  'Optional personality onboarding answers. One row per user; all module fields nullable.';

comment on column public.personality_profile.completed_modules is
  'Module keys the user finished (e.g. dosha, enneagram).';

comment on column public.personality_profile.skipped_modules is
  'Module keys the user chose to skip during onboarding.';

comment on column public.personality_profile.enneagram_source is
  'Whether enneagram_type came from an in-app quiz or self-report.';

alter table public.personality_profile enable row level security;

revoke all on table public.personality_profile from public, anon;
grant select, insert, update on table public.personality_profile to authenticated;
grant all on table public.personality_profile to postgres, service_role;

drop policy if exists "own profile read" on public.personality_profile;
create policy "own profile read"
  on public.personality_profile
  for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own profile insert" on public.personality_profile;
create policy "own profile insert"
  on public.personality_profile
  for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "own profile update" on public.personality_profile;
create policy "own profile update"
  on public.personality_profile
  for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

notify pgrst, 'reload schema';
