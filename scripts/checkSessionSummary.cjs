#!/usr/bin/env node
/**
 * Hearing Phase 3 — checks for the listening_summaries aggregation.
 *
 *   node scripts/checkSessionSummary.cjs
 *
 * The project has no test runner, so this is a standalone script. It
 * compiles lib/hearing/sessionSummary.ts into a temp dir with a
 * stubbed Supabase client, then exercises buildSummaryPayload — the
 * pure aggregation half — against the cases that actually matter.
 *
 * The important ones are the mock-quarantine cases. Acoustic emotion
 * inference is faked until Phase 4 validates a real model, and these
 * assert that a fabricated arousal/valence number can never reach a
 * summary row, while the genuinely real data in the same row (the
 * semantic emotion tokens, the measured speaking rate and vocal
 * strain) still gets aggregated normally.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dost-summary-check-'));

try {
  // tsc exits non-zero on the __DEV__ globals (React Native injects
  // them at runtime) but still emits usable JS, so ignore the status
  // and check for the artifact instead.
  // Invoke tsc through node directly rather than npx: execFileSync
  // cannot spawn a .cmd shim on Windows without a shell.
  const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    execFileSync(
      process.execPath,
      [tsc, 'lib/hearing/sessionSummary.ts', '--outDir', outDir,
       '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
      { cwd: repoRoot, stdio: 'pipe' },
    );
  } catch { /* expected — see above */ }

  const compiled = path.join(outDir, 'hearing', 'sessionSummary.js');
  if (!fs.existsSync(compiled)) {
    console.error('Compile failed: ' + compiled + ' was not emitted.');
    process.exit(1);
  }
  // Replace the compiled Supabase client with a stub so requiring the
  // module does not try to open a real connection.
  fs.writeFileSync(
    path.join(outDir, 'supabase.js'),
    'module.exports = { supabase: null };\n',
  );

  process.exit(run(require(compiled).buildSummaryPayload));
} finally {
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
}

function run(buildSummaryPayload) {
  const input = {
    userId: 'u1', sessionId: 's1',
    startedAt: 1760000000000, endedAt: 1760000600000,
    totalMs: 600000, speechMs: 300000, segmentsMatched: 3,
  };
  
  function row(o) {
    return Object.assign({
      primary_emotion: null, secondary_emotions: null, underlying_need: null,
      rms_energy: null, pitch_mean_hz: null, pitch_variability: null,
      speaking_rate_wpm: null, silence_ratio: null, vocal_stress_index: null,
      acoustic_arousal: null, acoustic_valence: null, inference_source: 'mock',
    }, o);
  }
  
  let pass = 0, fail = 0;
  function check(name, cond, got) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + '  got: ' + JSON.stringify(got)); }
  }
  
  console.log('\n[1] All-mock session (today\'s reality)');
  let r = buildSummaryPayload([
    row({ primary_emotion: 'shame', underlying_need: 'safety', speaking_rate_wpm: 120,
          vocal_stress_index: 0.7, acoustic_arousal: 0.81, acoustic_valence: 0.5 }),
    row({ primary_emotion: 'shame', underlying_need: 'safety', speaking_rate_wpm: 140,
          vocal_stress_index: 0.5, acoustic_arousal: 0.42, acoustic_valence: 0.5 }),
  ], input);
  check('arousal suppressed to null', r.avg_arousal === null, r.avg_arousal);
  check('valence suppressed to null', r.avg_valence === null, r.avg_valence);
  check('row stamped mock', r.inference_source === 'mock', r.inference_source);
  check('real wpm still aggregated (130)', r.avg_speaking_rate_wpm === 130, r.avg_speaking_rate_wpm);
  check('real stress still aggregated (0.6)', Math.abs(r.avg_vocal_stress_index - 0.6) < 1e-9, r.avg_vocal_stress_index);
  check('semantic emotion counted', r.emotion_counts.shame === 2, r.emotion_counts);
  check('dominant emotion', r.dominant_emotion === 'shame', r.dominant_emotion);
  check('dominant need', r.dominant_need === 'safety', r.dominant_need);
  
  console.log('\n[2] Real acoustic_v1 session (post-Phase-4)');
  r = buildSummaryPayload([
    row({ inference_source: 'acoustic_v1', acoustic_arousal: 0.8, acoustic_valence: 0.4 }),
    row({ inference_source: 'acoustic_v1', acoustic_arousal: 0.6, acoustic_valence: 0.6 }),
  ], input);
  check('arousal averaged (0.7)', Math.abs(r.avg_arousal - 0.7) < 1e-9, r.avg_arousal);
  check('valence averaged (0.5)', Math.abs(r.avg_valence - 0.5) < 1e-9, r.avg_valence);
  check('stamped acoustic_v1', r.inference_source === 'acoustic_v1', r.inference_source);
  
  console.log('\n[3] Mixed mock + real — mock must not dilute the average');
  r = buildSummaryPayload([
    row({ acoustic_arousal: 0.1 }),
    row({ inference_source: 'acoustic_v1', acoustic_arousal: 0.9, acoustic_valence: 0.3 }),
  ], input);
  check('averages real row only (0.9)', Math.abs(r.avg_arousal - 0.9) < 1e-9, r.avg_arousal);
  check('stamped acoustic_v1', r.inference_source === 'acoustic_v1', r.inference_source);
  
  console.log('\n[4] Mixed acoustic_v1 + fused_v1 — weakest wins');
  r = buildSummaryPayload([
    row({ inference_source: 'fused_v1', acoustic_arousal: 0.5 }),
    row({ inference_source: 'acoustic_v1', acoustic_arousal: 0.5 }),
  ], input);
  check('stamped acoustic_v1 not fused_v1', r.inference_source === 'acoustic_v1', r.inference_source);
  
  console.log('\n[5] Unknown/garbage provenance treated as mock');
  r = buildSummaryPayload([
    row({ inference_source: 'totally_made_up', acoustic_arousal: 0.95 }),
    row({ inference_source: null, acoustic_arousal: 0.95 }),
  ], input);
  check('arousal suppressed', r.avg_arousal === null, r.avg_arousal);
  check('stamped mock', r.inference_source === 'mock', r.inference_source);
  
  console.log('\n[6] Secondary emotions counted; zero/garbage numbers skipped');
  r = buildSummaryPayload([
    row({ primary_emotion: 'grief', secondary_emotions: ['fear', 'grief'],
          speaking_rate_wpm: 0, pitch_mean_hz: 0 }),
    row({ primary_emotion: 'fear', speaking_rate_wpm: 100, pitch_mean_hz: 200 }),
  ], input);
  check('grief counted twice', r.emotion_counts.grief === 2, r.emotion_counts);
  check('fear counted twice', r.emotion_counts.fear === 2, r.emotion_counts);
  check('zero wpm excluded (100 not 50)', r.avg_speaking_rate_wpm === 100, r.avg_speaking_rate_wpm);
  check('zero pitch excluded (200)', r.avg_pitch_mean_hz === 200, r.avg_pitch_mean_hz);
  check('no-data field is null', r.avg_silence_ratio === null, r.avg_silence_ratio);
  
  console.log('\n[7] Shape / privacy — no free text can leak');
  r = buildSummaryPayload([row({ primary_emotion: 'anger' })], input);
  const keys = Object.keys(r).sort();
  const allowed = ['avg_arousal','avg_pitch_mean_hz','avg_pitch_variability','avg_rms_energy','avg_silence_ratio','avg_speaking_rate_wpm','avg_valence','avg_vocal_stress_index','dominant_emotion','dominant_need','emotion_counts','inference_source','matched_segments','need_counts','session_duration_seconds','session_ended_at','session_id','session_started_at','speech_duration_seconds','total_segments','user_id'].sort();
  check('exactly the expected columns', JSON.stringify(keys) === JSON.stringify(allowed), keys);
  check('durations in seconds', r.session_duration_seconds === 600 && r.speech_duration_seconds === 300, [r.session_duration_seconds, r.speech_duration_seconds]);
  
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail === 0 ? 0 : 1;
}
