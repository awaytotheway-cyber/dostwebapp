# Listening Phase 2 — Step 2: native capture with silence removal

## What changed

* New native pipeline in `plugins/listening/` (see its README): microphone →
  3 s RAM buffer → stage 1 loudness gate → AAC `.m4a` clips in
  `filesDir/voice/recordings/YYYY-MM-DD/`. JavaScript only starts, stops and reads
  counters.
* Kept rules: notification with Stop while listening, one session at a time,
  wake lock, stop on low storage (< 200 MB) or low battery (< 15%, not charging),
  stop reasons in the log, phone calls detected as digital silence and logged,
  retries with backoff when the microphone fails, never restarts by itself.
* `voice/` is excluded from Android backup and device transfer.
* Build is arm64-v8a only. Models are inside the app (27 MB).
* Model check button on the Listening screen measures model speed on the phone.
* Old cloud pipeline removed: Whisper, emotion tagging, MFCC voiceprint, its
  screens, `whisper.rn`, the `hearing-extract-emotions` function. Migration
  `022_drop_cloud_hearing.sql` drops the old Supabase tables. On the phone, the
  old Whisper model file and settings are removed once.
* Recording policy is **any_sound** in this build (no speech detector or
  speaker check yet). It saves other people's voices. Test build only.

## Desktop simulation (H1/H2)

`scripts/listening/sim/` runs the phone's `ClipAssembler` on 10-minute
recordings with ~2 minutes of real speech in 12 utterances. Results
(`step2-h1-sim.json`):

| Scenario | Speech kept | Saved | Silence dropped | Mostly-silence clips | Audio kept before first word (min) |
| --- | --- | --- | --- | --- | --- |
| Quiet room | 100% | 131 s (utterances 117 s) | 469 s | 0 | 434 ms |
| Steady fan/AC | 97.7% | 143 s | 456 s | 5 | 242 ms |
| Phone call, 30 s | 93.3%* | 123 s | 449 s | 0 | 461 ms |
| Household noise | 100% | 167 s | 433 s | 5 (noise, expected until Step 3) | 227 ms |

\* the simulated call silenced part of one utterance; mic_silenced and
mic_resumed were logged.

## Test on the phone (H1)

1. Settings → Space Settings → Listening → Delete all listening recordings
   (should report 0 files left).
2. Listening → Start. Accept the new disclosure and permissions.
3. Ten minutes in a quiet room, about two minutes of speaking spread out.
   Lock the screen for part of it.
4. Stop. Note: Listened, Saved, Silence skipped, number of clips.
5. Play the clips: first words intact, no clip that is mostly silence.
6. Run Model check, lock the screen within 10 s, come back after a minute,
   and send a screenshot.
