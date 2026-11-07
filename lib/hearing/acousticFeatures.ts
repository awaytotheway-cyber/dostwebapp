/**
 * Real acoustic feature extraction from a Float32 PCM segment.
 *
 * These are actual measurements, not ML inference. Nothing here is
 * mocked. The values feed the voice_signals table's acoustic columns.
 *
 * vocal_stress_index is a heuristic composite of pitch variability,
 * speaking rate and speech density — NOT a validated clinical measure.
 * The UI must label it as such wherever it appears.
 */

export type AcousticFeatures = {
  rms_energy: number;
  pitch_mean_hz: number;
  pitch_variability: number;
  speaking_rate_wpm: number;
  silence_ratio: number;
  vocal_stress_index: number;
};

export function extractAcousticFeatures(
  pcm: Float32Array,
  sampleRate: number,
  transcript: string,
  durationSeconds: number,
): AcousticFeatures {
  if (pcm.length === 0 || !isFinite(sampleRate) || sampleRate <= 0) {
    return emptyFeatures();
  }

  // RMS energy, normalized so a full-scale sine sits near 1.
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i++) sumSquares += pcm[i] * pcm[i];
  const rms = Math.sqrt(sumSquares / pcm.length);
  const rms_energy = Math.min(1, rms * 4);

  // Pitch contour via short-window autocorrelation, restricted to 70–400 Hz.
  const pitches = estimatePitchContour(pcm, sampleRate);
  const voiced = pitches.filter((p) => p > 0);
  const pitch_mean_hz = voiced.length
    ? voiced.reduce((a, b) => a + b, 0) / voiced.length
    : 0;
  const pitch_variability =
    voiced.length > 1 && pitch_mean_hz > 0
      ? standardDeviation(voiced) / pitch_mean_hz
      : 0;

  // Speaking rate: words per minute across the segment.
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const speaking_rate_wpm =
    durationSeconds > 0 ? (wordCount / durationSeconds) * 60 : 0;

  // Silence ratio: fraction of 20ms frames whose RMS falls below 0.01.
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  let silentFrames = 0;
  let totalFrames = 0;
  for (let i = 0; i + frameSize < pcm.length; i += frameSize) {
    let frameSum = 0;
    for (let j = i; j < i + frameSize; j++) frameSum += pcm[j] * pcm[j];
    const frameRms = Math.sqrt(frameSum / frameSize);
    if (frameRms < 0.01) silentFrames++;
    totalFrames++;
  }
  const silence_ratio = totalFrames > 0 ? silentFrames / totalFrames : 0;

  // Heuristic composite. Labeled and treated as such — not a clinical index.
  const vocal_stress_index = vocalStressIndex(
    pitch_variability,
    speaking_rate_wpm,
    silence_ratio,
  );

  return {
    rms_energy,
    pitch_mean_hz,
    pitch_variability,
    speaking_rate_wpm,
    silence_ratio,
    vocal_stress_index,
  };
}

/**
 * The heuristic composite, in one place.
 *
 * NOT a validated clinical measure — a weighted blend of pitch
 * variability, speaking rate and speech density. The UI must label it
 * as such wherever it appears.
 *
 * Exported so there is exactly one definition. The pipeline cannot know
 * the speaking rate until the transcript comes back from Whisper, so it
 * has to compute these features in two stages; having the formula in
 * two places is what let the rate term silently go missing.
 */
export function vocalStressIndex(
  pitchVariability: number,
  speakingRateWpm: number,
  silenceRatio: number,
): number {
  const rateNorm = Math.min(1, Math.max(0, speakingRateWpm) / 200);
  return Math.min(
    1,
    pitchVariability * 0.4 + rateNorm * 0.4 + (1 - silenceRatio) * 0.2,
  );
}

/**
 * Fill in the speaking rate once the transcript exists, and recompute
 * everything that depends on it.
 *
 * THE BUG THIS EXISTS TO PREVENT. The pipeline used to extract features
 * with an empty transcript and then spread `{ ...features,
 * speaking_rate_wpm }` over the result. That patched the rate but left
 * vocal_stress_index as it was — computed with a rate of zero, so the
 * 0.4 weight on speaking rate was permanently dead. Stored values
 * topped out around 0.37 against a formula that reads up to 1.0, and
 * both the chat lens and the nightly synthesis call anything above 0.6
 * "elevated" — a label that could never be produced.
 *
 * Use this rather than spreading the rate in by hand: anything derived
 * from speaking rate is recomputed here, so a future derived field
 * cannot be forgotten the same way.
 */
export function withSpeakingRate(
  features: AcousticFeatures,
  speakingRateWpm: number,
): AcousticFeatures {
  const rate = Number.isFinite(speakingRateWpm) ? Math.max(0, speakingRateWpm) : 0;
  return {
    ...features,
    speaking_rate_wpm: rate,
    vocal_stress_index: vocalStressIndex(
      features.pitch_variability,
      rate,
      features.silence_ratio,
    ),
  };
}

/**
 * Short-window autocorrelation pitch, restricted to 70-400 Hz.
 *
 * The correlation is divided by the window's own energy before the 0.3
 * voicing test. Without that division the test is a loudness gate rather
 * than a periodicity test: raw autocorrelation scales with how loud the
 * window is, so a loud window passes almost regardless of whether it is
 * periodic and a quiet one almost never passes however clearly voiced it
 * is. Measured on synthetic clips before the fix, every quiet clip
 * reported 0 Hz and 0% voiced frames while every loud clip reported 100%.
 *
 * Dividing by energy makes the ratio scale-free — it is unchanged if the
 * same speech is recorded louder or softer — so 0.3 means "at least 30%
 * of the window's energy repeats at this lag", which is what the
 * threshold was always meant to mean.
 */
export function estimatePitchContour(
  pcm: Float32Array,
  sampleRate: number,
): number[] {
  const windowSize = Math.floor(sampleRate * 0.04); // 40 ms
  const hopSize = Math.max(1, Math.floor(windowSize / 2));
  const minLag = Math.max(1, Math.floor(sampleRate / 400)); // 400 Hz ceiling
  const maxLag = Math.floor(sampleRate / 70); // 70 Hz floor
  const contour: number[] = [];

  for (let start = 0; start + windowSize < pcm.length; start += hopSize) {
    // The window's own energy. Constant across lags, so it does not
    // change which lag wins — only whether that lag counts as voiced.
    let energy = 0;
    for (let i = start; i < start + windowSize; i++) energy += pcm[i] * pcm[i];
    if (energy <= 0) energy = 1e-12;

    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < windowSize - lag; i++) {
        corr += pcm[start + i] * pcm[start + i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    const periodicity = bestCorr / energy;
    contour.push(bestLag > 0 && periodicity > 0.3 ? sampleRate / bestLag : 0);
  }
  return contour;
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function emptyFeatures(): AcousticFeatures {
  return {
    rms_energy: 0,
    pitch_mean_hz: 0,
    pitch_variability: 0,
    speaking_rate_wpm: 0,
    silence_ratio: 0,
    vocal_stress_index: 0,
  };
}
