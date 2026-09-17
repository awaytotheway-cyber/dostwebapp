-- Store optional onboarding preferences without changing existing profile RLS.

alter table public.profiles
  add column if not exists daily_rhythm text,
  add column if not exists hobbies text[] default '{}'::text[],
  add column if not exists social_style text;

alter table public.profiles
  alter column hobbies set default '{}'::text[];

update public.profiles
set hobbies = '{}'::text[]
where hobbies is null;

alter table public.profiles
  alter column hobbies set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_daily_rhythm_check'
  ) then
    alter table public.profiles
      add constraint profiles_daily_rhythm_check
      check (daily_rhythm is null or daily_rhythm in ('day', 'flexible', 'night'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_hobbies_check'
  ) then
    alter table public.profiles
      add constraint profiles_hobbies_check
      check (
        cardinality(hobbies) <= 5
        and hobbies <@ array[
          'reading',
          'music',
          'movement',
          'nature',
          'art',
          'cooking',
          'travel',
          'games',
          'spiritual_practice'
        ]::text[]
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_social_style_check'
  ) then
    alter table public.profiles
      add constraint profiles_social_style_check
      check (social_style is null or social_style in ('introvert', 'ambivert', 'extrovert'));
  end if;
end
$$;

notify pgrst, 'reload schema';
