/**
 * ══════════════════════════════════════════════════════════════════
 * Speaker fingerprint — Path 2 (MFCC-based)
 * ══════════════════════════════════════════════════════════════════
 *
 * A classical MFCC-based voiceprint. Lower accuracy than a trained
 * speaker-embedding model (ECAPA-TDNN and friends), but self-contained:
 * no model file, no download, no licensing question, no native
 * dependency. Path 2, the fallback we chose after honest evaluation
 * of Path 1 in Step 2.
 *
 * Pipeline per segment:
 *   1. Slice into 25 ms frames with 10 ms hop
 *   2. Hamming window each frame to reduce spectral leakage
 *   3. Compute magnitude-squared spectrum (naive DFT — fine for the
 *      small frame sizes and low duty cycle we run at)
 *   4. Apply a 26-band mel filterbank; log-energy per band
 *   5. DCT to decorrelate, keep first 13 MFCC coefficients per frame
 *   6. Reduce the whole segment to one voiceprint by taking the mean
 *      and standard deviation of each of the 13 MFCC coefficients
 *      across all frames → 26-dimensional vector
 *
 * Cosine similarity is the comparison metric (see verifySpeaker in
 * speakerVerification.ts). Two voiceprints from the same speaker
 * typically sit above ~0.75; two from different speakers typically
 * below ~0.65. The ambiguous middle band is treated as a discard
 * per Rule 5.
 *
 * Language independence: MFCCs capture voice timbre (vocal tract
 * shape, glottal source), which is largely language-independent.
 * A user's English, Hindi and Marathi voiceprints should cluster
 * together. Enrolling across all three languages the user speaks
 * makes the reference more robust — the enrollment flow does this
 * in Step 4.
 * ══════════════════════════════════════════════════════════════════
 */

export type Voiceprint = number[]; // fixed length — see VOICEPRINT_LENGTH

const NUM_MEL_FILTERS = 26;
const NUM_MFCC_COEFFICIENTS = 13;

/** Fixed voiceprint length: 13 MFCC means + 13 MFCC stds. */
export const VOICEPRINT_LENGTH = NUM_MFCC_COEFFICIENTS * 2;

export function extractVoiceprint(
  pcm: Float32Array,
  sampleRate: number,
): Voiceprint {
  if (pcm.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return new Array<number>(VOICEPRINT_LENGTH).fill(0);
  }

  const frameSize = Math.floor(sampleRate * 0.025); // 25 ms frames
  const hopSize = Math.max(1, Math.floor(sampleRate * 0.01)); // 10 ms hop
  if (frameSize <= 1) {
    return new Array<number>(VOICEPRINT_LENGTH).fill(0);
  }

  const mfccFrames: number[][] = [];
  for (let start = 0; start + frameSize < pcm.length; start += hopSize) {
    const frame = pcm.slice(start, start + frameSize);
    const windowed = applyHammingWindow(frame);
    const powerSpectrum = computePowerSpectrum(windowed);
    const melEnergies = applyMelFilterbank(
      powerSpectrum,
      sampleRate,
      NUM_MEL_FILTERS,
    );
    const mfcc = dctFirstN(melEnergies, NUM_MFCC_COEFFICIENTS);
    mfccFrames.push(mfcc);
  }

  if (mfccFrames.length === 0) {
    return new Array<number>(VOICEPRINT_LENGTH).fill(0);
  }

  // Voiceprint = mean and std of each MFCC coefficient across the segment.
  const means = new Array<number>(NUM_MFCC_COEFFICIENTS).fill(0);
  const stds = new Array<number>(NUM_MFCC_COEFFICIENTS).fill(0);

  for (let c = 0; c < NUM_MFCC_COEFFICIENTS; c++) {
    const values = mfccFrames.map((f) => f[c]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    means[c] = mean;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    stds[c] = Math.sqrt(variance);
  }

  return [...means, ...stds];
}

/**
 * Cosine similarity in [-1, 1] for two equal-length voiceprints.
 * Returns 0 for length mismatch or zero-magnitude inputs.
 */
export function cosineSimilarity(a: Voiceprint, b: Voiceprint): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Average several voiceprints into one reference vector, then L2-normalize.
 * Used by enrollment to reduce N clip-voiceprints to one stored reference.
 */
export function averageVoiceprints(prints: Voiceprint[]): Voiceprint {
  if (prints.length === 0) return new Array<number>(VOICEPRINT_LENGTH).fill(0);
  const dim = prints[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const p of prints) {
    if (p.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += p[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= prints.length;
  // L2 normalize so the reference has unit magnitude — cosine values are
  // unaffected but comparing magnitudes across enrollments is easier.
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return out;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

// ─── DSP primitives ───────────────────────────────────────────────

function applyHammingWindow(frame: Float32Array): Float32Array {
  const out = new Float32Array(frame.length);
  const denom = Math.max(1, frame.length - 1);
  for (let i = 0; i < frame.length; i++) {
    out[i] =
      frame[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / denom));
  }
  return out;
}

function computePowerSpectrum(frame: Float32Array): Float32Array {
  // Naive DFT — O(N^2). Fine for our frame size (400 samples at 16 kHz)
  // and the very low duty cycle: this runs on VAD-detected segments only,
  // not continuously.
  const N = frame.length;
  const halfN = Math.floor(N / 2);
  const spectrum = new Float32Array(halfN);
  for (let k = 0; k < halfN; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += frame[n] * Math.cos(angle);
      im -= frame[n] * Math.sin(angle);
    }
    spectrum[k] = (re * re + im * im) / N;
  }
  return spectrum;
}

function applyMelFilterbank(
  powerSpectrum: Float32Array,
  sampleRate: number,
  numFilters: number,
): number[] {
  const melMin = 0;
  const melMax = 2595 * Math.log10(1 + sampleRate / 2 / 700);
  const melPoints = Array.from(
    { length: numFilters + 2 },
    (_, i) => melMin + (i * (melMax - melMin)) / (numFilters + 1),
  );
  const hzPoints = melPoints.map((m) => 700 * (10 ** (m / 2595) - 1));
  const binPoints = hzPoints.map((hz) =>
    Math.floor((hz * powerSpectrum.length * 2) / sampleRate),
  );

  const energies: number[] = [];
  for (let i = 1; i <= numFilters; i++) {
    let energy = 0;
    for (
      let j = binPoints[i - 1];
      j < binPoints[i + 1] && j < powerSpectrum.length;
      j++
    ) {
      const weight =
        j < binPoints[i]
          ? (j - binPoints[i - 1]) /
            Math.max(1, binPoints[i] - binPoints[i - 1])
          : (binPoints[i + 1] - j) /
            Math.max(1, binPoints[i + 1] - binPoints[i]);
      energy += powerSpectrum[j] * Math.max(0, weight);
    }
    energies.push(Math.log(Math.max(energy, 1e-10)));
  }
  return energies;
}

function dctFirstN(input: number[], n: number): number[] {
  const N = input.length;
  const output: number[] = [];
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += input[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * N));
    }
    output.push(sum);
  }
  return output;
}
