// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  extractAcousticFeatures,
  estimatePitchContour,
  vocalStressIndex,
  withSpeakingRate,
} from "./acousticFeatures.ts";

const SR = 16_000;

/** A periodic buzz at `hz`, scaled to `amplitude`. Not a pure sine —
 *  a couple of harmonics, so it looks more like voiced speech. */
function tone(hz: number, seconds: number, amplitude: number): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      amplitude *
      (Math.sin(2 * Math.PI * hz * t) +
        0.5 * Math.sin(4 * Math.PI * hz * t) +
        0.25 * Math.sin(6 * Math.PI * hz * t)) /
      1.75;
  }
  return out;
}

function noise(seconds: number, amplitude: number, seed = 7): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

function voicedFraction(contour: number[]): number {
  if (contour.length === 0) return 0;
  return contour.filter((p) => p > 0).length / contour.length;
}

// THE REGRESSION THIS FILE EXISTS FOR.
//
// Before the fix the voicing test compared RAW autocorrelation against
// 0.3. Raw correlation scales with window energy, so the test was really
// asking "is this loud?" rather than "is this periodic?". A quiet but
// perfectly periodic clip reported 0 Hz and no voiced frames at all.
Deno.test("pitch is found in quiet speech, not only loud speech", () => {
  const loud = estimatePitchContour(tone(150, 1, 0.3), SR);
  const quiet = estimatePitchContour(tone(150, 1, 0.01), SR);

  assert(voicedFraction(loud) > 0.9, `loud voiced ${voicedFraction(loud)}`);
  assert(voicedFraction(quiet) > 0.9, `quiet voiced ${voicedFraction(quiet)}`);
});

Deno.test("the same speech at any volume gives the same pitch", () => {
  const at = (amp: number) => {
    const c = estimatePitchContour(tone(150, 1, amp), SR).filter((p) => p > 0);
    return c.reduce((a, b) => a + b, 0) / c.length;
  };
  const loud = at(0.3);
  const quiet = at(0.01);
  // Scale-free: the ratio is unchanged by gain, so the answer should be
  // identical, not merely close.
  assertEquals(loud, quiet);
  assert(Math.abs(loud - 150) < 8, `expected ~150 Hz, got ${loud}`);
});

Deno.test("noise is still rejected — the threshold is not just permissive", () => {
  const contour = estimatePitchContour(noise(1, 0.3), SR);
  assert(
    voicedFraction(contour) < 0.2,
    `noise voiced fraction ${voicedFraction(contour)}`,
  );
});

Deno.test("silence yields no pitch and does not divide by zero", () => {
  const contour = estimatePitchContour(new Float32Array(SR), SR);
  assertEquals(voicedFraction(contour), 0);
  assert(contour.every((p) => Number.isFinite(p)));
});

Deno.test("pitch variability tracks a changing pitch, flat on a steady one", () => {
  const steady = extractAcousticFeatures(tone(150, 2, 0.05), SR, "one two", 2);

  // Two halves at different pitches, quietly spoken.
  const a = tone(120, 1, 0.05);
  const b = tone(220, 1, 0.05);
  const varied = new Float32Array(a.length + b.length);
  varied.set(a, 0);
  varied.set(b, a.length);
  const changing = extractAcousticFeatures(varied, SR, "one two", 2);

  assert(steady.pitch_mean_hz > 0, "steady clip should be voiced");
  assert(changing.pitch_variability > steady.pitch_variability * 3);
});

Deno.test("empty input returns zeroed features", () => {
  const f = extractAcousticFeatures(new Float32Array(0), SR, "", 0);
  assertEquals(f.pitch_mean_hz, 0);
  assertEquals(f.vocal_stress_index, 0);
});

// ── vocal_stress_index and the two-stage pipeline ────────────────────
//
// The pipeline cannot know the speaking rate until Whisper returns, so
// it extracts features with an empty transcript and fills the rate in
// afterwards. It used to do that with a plain spread, which left
// vocal_stress_index computed against a rate of zero.

Deno.test("speaking rate actually moves vocal stress", () => {
  const slow = vocalStressIndex(0.3, 40, 0.2);
  const fast = vocalStressIndex(0.3, 180, 0.2);
  assert(fast > slow, `expected ${fast} > ${slow}`);
  // The rate term carries 0.4 of the formula.
  assert(
    Math.abs(fast - slow - 0.4 * (Math.min(1, 180 / 200) - Math.min(1, 40 / 200))) < 1e-9,
  );
});

Deno.test("the full range stays reachable, so 'elevated' can occur", () => {
  // Both consumers label > 0.6 as "elevated". With the rate term dead
  // the ceiling was 0.6 and that label could never be produced.
  const high = vocalStressIndex(1, 200, 0);
  assertEquals(high, 1);
  assert(vocalStressIndex(0.6, 180, 0.1) > 0.6, "a plausible stressed clip should clear 0.6");
});

Deno.test("withSpeakingRate recomputes stress, not just the rate", () => {
  const pcm = tone(150, 2, 0.2);
  // What the pipeline does: features first, with no transcript.
  const staged = extractAcousticFeatures(pcm, SR, "", 2);
  const filled = withSpeakingRate(staged, 170);

  assertEquals(filled.speaking_rate_wpm, 170);
  assert(
    filled.vocal_stress_index > staged.vocal_stress_index,
    `stress should rise once the rate is known: ${staged.vocal_stress_index} -> ${filled.vocal_stress_index}`,
  );
});

// The property that matters: computing in two stages must equal
// computing in one. This is what a naive spread broke.
Deno.test("two-stage extraction matches single-pass extraction", () => {
  const pcm = tone(150, 2, 0.2);
  const transcript = Array(50).fill("word").join(" ");
  const wpm = (50 / 2) * 60;

  const onePass = extractAcousticFeatures(pcm, SR, transcript, 2);
  const twoStage = withSpeakingRate(extractAcousticFeatures(pcm, SR, "", 2), wpm);

  assertEquals(twoStage.speaking_rate_wpm, onePass.speaking_rate_wpm);
  assertEquals(twoStage.vocal_stress_index, onePass.vocal_stress_index);
  assertEquals(twoStage.pitch_mean_hz, onePass.pitch_mean_hz);
  assertEquals(twoStage.silence_ratio, onePass.silence_ratio);
});

Deno.test("a nonsense rate cannot produce a nonsense stress value", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
    const f = withSpeakingRate(extractAcousticFeatures(tone(150, 1, 0.2), SR, "", 1), bad);
    assert(Number.isFinite(f.speaking_rate_wpm), `rate ${bad}`);
    assert(f.speaking_rate_wpm >= 0, `rate ${bad}`);
    assert(
      Number.isFinite(f.vocal_stress_index) &&
        f.vocal_stress_index >= 0 &&
        f.vocal_stress_index <= 1,
      `stress from rate ${bad} was ${f.vocal_stress_index}`,
    );
  }
});
