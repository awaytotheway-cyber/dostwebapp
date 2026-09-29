-- Hearing Phase 2 — Step 8: calibration table.
--
-- Explicitly temporary. Purpose: gather the real distribution of
-- similarity scores per verification outcome (match / mismatch /
-- ambiguous) during a short logging window per user, so the
-- speakerVerification.ts thresholds can be re-tuned against real
-- data. Pipeline writes per segment during a bounded window (see
-- pipeline.ts CALIBRATION_LOG_MAX_ROWS + CALIBRATION_LOG_DAYS);
-- pg_cron nightly job drops rows older than 30 days. Once the
-- thresholds feel right in production, this whole table can be
-- dropped without changing app code — the writes are fire-and-forget.

create table if not exists speaker_verification_calibration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  similarity numeric not null,
  classification text not null
    check (classification in ('match', 'mismatch', 'ambiguous')),
  sensitivity text not null
    check (sensitivity in ('strict', 'balanced', 'lenient')),
  created_at timestamptz default now()
);

alter table speaker_verification_calibration enable row level security;

create policy "own calibration read" on speaker_verification_calibration
  for select using (auth.uid() = user_id);
create policy "own calibration insert" on speaker_verification_calibration
  for insert with check (auth.uid() = user_id);
create policy "own calibration delete" on speaker_verification_calibration
  for delete using (auth.uid() = user_id);

create index if not exists speaker_verification_calibration_user
  on speaker_verification_calibration(user_id, created_at desc);

-- Nightly cleanup at 03:17 UTC (off-hour to spread load).
select cron.unschedule('speaker-verification-calibration-cleanup')
  where exists (
    select 1 from cron.job
    where jobname = 'speaker-verification-calibration-cleanup'
  );

select cron.schedule(
  'speaker-verification-calibration-cleanup',
  '17 3 * * *',
  $$delete from public.speaker_verification_calibration where created_at < now() - interval '30 days'$$
);
