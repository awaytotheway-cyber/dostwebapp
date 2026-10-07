-- Listening Phase 2 starts fresh and keeps all voice data on the phone.
-- Remove the old cloud hearing pipeline: session rows, acoustic/emotion
-- signals, the uploaded MFCC voiceprints, and speaker-gate calibration scores.
-- This permanently deletes that data.

drop table if exists public.speaker_verification_calibration;
drop table if exists public.speaker_enrollment;
drop table if exists public.voice_signals;
drop table if exists public.voice_sessions;
