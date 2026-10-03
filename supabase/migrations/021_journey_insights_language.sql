-- Journey insights are now generated in the person's app language.
-- Paste this entire file into the Supabase SQL Editor, then click Run.
--
-- Adds a language column and caches one insight per (user, range, language),
-- so switching languages doesn't serve a reflection written in the old one.
-- Apply this before deploying the updated generate-journey-insight function.

alter table public.journey_insights
  add column if not exists language text not null default 'en';

alter table public.journey_insights
  drop constraint if exists journey_insights_language_check;
alter table public.journey_insights
  add constraint journey_insights_language_check
    check (language in ('en', 'hi', 'mr', 'es', 'de', 'ru', 'zh', 'ja'));

alter table public.journey_insights
  drop constraint if exists journey_insights_user_range_key;
alter table public.journey_insights
  drop constraint if exists journey_insights_user_range_language_key;
alter table public.journey_insights
  add constraint journey_insights_user_range_language_key
    unique (user_id, range_key, language);

comment on column public.journey_insights.language is
  'App language the insight was written in (lib/i18n/languages.ts).';

notify pgrst, 'reload schema';
