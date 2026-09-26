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
  const rateNorm = Math.min(1, speaking_rate_wpm / 200);
  const vocal_stress_index = Math.min(
    1,
    pitch_variability * 0.4 + rateNorm * 0.4 + (1 - silence_ratio) * 0.2,
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

function estimatePitchContour(
  pcm: Float32Array,
  sampleRate: number,
): number[] {
  const windowSize = Math.floor(sampleRate * 0.04); // 40 ms
  const hopSize = Math.max(1, Math.floor(windowSize / 2));
  const minLag = Math.max(1, Math.floor(sampleRate / 400)); // 400 Hz ceiling
  const maxLag = Math.floor(sampleRate / 70); // 70 Hz floor
  const contour: number[] = [];

  for (let start = 0; start + windowSize < pcm.length; start += hopSize) {
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
    contour.push(bestLag > 0 && bestCorr > 0.3 ? sampleRate / bestLag : 0);
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
