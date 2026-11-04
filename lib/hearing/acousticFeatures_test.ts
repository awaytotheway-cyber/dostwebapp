// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  extractAcousticFeatures,
  estimatePitchContour,
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
