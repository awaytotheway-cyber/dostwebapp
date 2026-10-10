-- DOST Onboarding: add Varna disposition to the personality_profile table.
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Varna is one of the four natural tendencies named in the mentor's §5.3
-- onboarding list (Brahmana / Kshatriya / Vaishya / Shudra), captured by a
-- short in-app questionnaire. Nullable, so users can skip; stored as text
-- with a check constraint rather than a Postgres enum to make future
-- additions easy.

alter table public.personality_profile
  add column if not exists varna text
    check (varna in ('brahmana', 'kshatriya', 'vaishya', 'shudra'));

comment on column public.personality_profile.varna is
  'Varna disposition from the onboarding questionnaire: brahmana, kshatriya, vaishya, or shudra. Nullable when the module is skipped.';

notify pgrst, 'reload schema';
