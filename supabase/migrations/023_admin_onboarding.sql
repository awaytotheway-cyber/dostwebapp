-- DOST admin onboarding: screens an admin can author plus the user
-- answers they produce.
--
-- Two tables, deliberately simple:
--
--   admin_onboarding_screens   screen definitions written by an admin
--                              in the separate /admin app. Shown between
--                              the Varna step and the Confirm step in
--                              the mobile onboarding flow, ordered by
--                              `position` (ascending). Inactive rows are
--                              hidden without being deleted.
--
--   admin_onboarding_answers    user answers to those screens. One row
--                              per (user, screen). The chat edge function
--                              reads these to seed context so the bot can
--                              use the information from next session.
--
-- No admin auth yet. RLS stays permissive so the admin web app can read
-- and write with the anon key, which matches the user's "no login yet"
-- posture. Tighten this before the admin surface is reachable from
-- outside localhost.

create extension if not exists pgcrypto;

create table if not exists public.admin_onboarding_screens (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null,
  subtitle text,
  question_type text not null check (question_type in ('short_text', 'single_choice')),
  options jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_onboarding_screens is
  'Admin-authored onboarding questions shown between Varna and Confirm in the mobile app.';
comment on column public.admin_onboarding_screens.position is
  'Lower numbers appear first within the admin block.';
comment on column public.admin_onboarding_screens.question_type is
  'One of short_text or single_choice.';
comment on column public.admin_onboarding_screens.options is
  'For single_choice: a JSON array of {label} strings.';

create index if not exists admin_onboarding_screens_active_position_idx
  on public.admin_onboarding_screens (is_active, position);

create table if not exists public.admin_onboarding_answers (
  user_id uuid not null references auth.users(id) on delete cascade,
  screen_id uuid not null references public.admin_onboarding_screens(id) on delete cascade,
  answer_text text,
  answer_option text,
  answered_at timestamptz not null default now(),
  primary key (user_id, screen_id)
);

comment on table public.admin_onboarding_answers is
  'User answers to the admin-authored onboarding questions.';

create index if not exists admin_onboarding_answers_user_idx
  on public.admin_onboarding_answers (user_id);

alter table public.admin_onboarding_screens enable row level security;
alter table public.admin_onboarding_answers enable row level security;

-- Screens: everyone (including anon) can read and write for now so the
-- admin web app and the mobile app work without a real auth system.
drop policy if exists "screens_all_read" on public.admin_onboarding_screens;
create policy "screens_all_read"
  on public.admin_onboarding_screens
  for select
  using (true);

drop policy if exists "screens_anon_write" on public.admin_onboarding_screens;
create policy "screens_anon_write"
  on public.admin_onboarding_screens
  for all
  using (true)
  with check (true);

-- Answers: a user can read and write their own; the admin (anon) can read
-- all answers for the admin UI. No one can mutate someone else's answers.
drop policy if exists "answers_own_rw" on public.admin_onboarding_answers;
create policy "answers_own_rw"
  on public.admin_onboarding_answers
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "answers_anon_read" on public.admin_onboarding_answers;
create policy "answers_anon_read"
  on public.admin_onboarding_answers
  for select
  to anon
  using (true);

grant select, insert, update, delete on public.admin_onboarding_screens to anon, authenticated;
grant select on public.admin_onboarding_answers to anon;
grant select, insert, update, delete on public.admin_onboarding_answers to authenticated;

notify pgrst, 'reload schema';
