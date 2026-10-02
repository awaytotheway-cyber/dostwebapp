import { LDA_PROJECTION } from './voiceprintModel';

/**
 * ══════════════════════════════════════════════════════════════════
 * Speaker fingerprint — MFCC statistics + LDA (model 'mfcc-lda-v2')
 * ══════════════════════════════════════════════════════════════════
 *
 * Pipeline per segment:
 *   1. Pre-emphasis, 25 ms Hamming frames with a 10 ms hop
 *   2. Power spectrum via a precomputed radix-2 FFT
 *   3. 26-band mel filterbank (60–7600 Hz), log energies
 *   4. DCT → cepstral coefficients c1..c13. c0 is dropped: it is overall
 *      loudness, which tracks mic distance rather than who is speaking.
 *   5. Energy gate: only frames within 30 dB of the segment's loudest
 *      frames contribute, so pauses and room tone don't dilute the print
 *   6. Voiceprint = mean and std of c1..c13 → 26 numbers. This raw
 *      vector is what gets stored at enrollment.
 *
 * Comparison (voiceprintSimilarity): both prints are projected through a
 * fixed LDA matrix (voiceprintModel.ts) that keeps directions where
 * different speakers differ and shrinks directions that noise, volume
 * and mic colouring move. Similarity is exp(-distance) in that space —
 * distance, not cosine, because a phone's mic colouring shifts the
 * user's and a bystander's prints by the same offset, and a difference
 * cancels it. Absolute similarity still shifts between phones and
 * rooms, so accept thresholds are calibrated per user at enrollment.
 * ══════════════════════════════════════════════════════════════════
 */

export type Voiceprint = number[];

const NUM_MEL = 26;
const NUM_CEPS = 13;
const PRE_EMPHASIS = 0.97;
const ENERGY_GATE_DB = 30;
const MEL_LOW_HZ = 60;
const MEL_HIGH_HZ = 7600;
// Frames quieter than this never count as speech (same floor as the
// native VAD's absolute minimum in HearingService.kt).
const SPEECH_MIN_RMS = 0.006;
const DIGITAL_SILENCE_DB = -90;

export const VOICEPRINT_LENGTH = NUM_CEPS * 2;

export type VoiceprintAnalysis = {
  voiceprint: Voiceprint;
  speechSeconds: number;
  // Loud-frame vs quiet-frame energy gap: how far speech rises above
  // the room's background.
  snrDb: number;
};

type Tables = {
  frameSize: number;
  hop: number;
  nfft: number;
  window: Float64Array;
  bitrev: Uint32Array;
  twCos: Float64Array;
  twSin: Float64Array;
  melLo: Int32Array;
  melWeights: Float64Array[];
  dct: Float64Array[];
};

const tableCache = new Map<number, Tables>();

function tablesFor(sampleRate: number): Tables {
  const hit = tableCache.get(sampleRate);
  if (hit) return hit;

  const frameSize = Math.round(sampleRate * 0.025);
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  let nfft = 1;
  while (nfft < frameSize) nfft <<= 1;
  const bits = Math.log2(nfft);

  const window = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const bitrev = new Uint32Array(nfft);
  for (let i = 0; i < nfft; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    bitrev[i] = r;
  }
  const twCos = new Float64Array(nfft / 2);
  const twSin = new Float64Array(nfft / 2);
  for (let i = 0; i < nfft / 2; i++) {
    twCos[i] = Math.cos((2 * Math.PI * i) / nfft);
    twSin[i] = -Math.sin((2 * Math.PI * i) / nfft);
  }

  const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const toHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const highHz = Math.min(MEL_HIGH_HZ, sampleRate / 2 - 1);
  const mLo = toMel(MEL_LOW_HZ);
  const mHi = toMel(highHz);
  const edges = Array.from({ length: NUM_MEL + 2 }, (_, i) =>
    toHz(mLo + ((mHi - mLo) * i) / (NUM_MEL + 1)),
  );
  const binHz = sampleRate / nfft;
  const melLo = new Int32Array(NUM_MEL);
  const melWeights: Float64Array[] = [];
  for (let m = 0; m < NUM_MEL; m++) {
    const [f0, f1, f2] = [edges[m], edges[m + 1], edges[m + 2]];
    const b0 = Math.floor(f0 / binHz);
    const b2 = Math.min(nfft / 2, Math.ceil(f2 / binHz));
    melLo[m] = b0;
    const w = new Float64Array(b2 - b0 + 1);
    for (let k = b0; k <= b2; k++) {
      const f = k * binHz;
      w[k - b0] =
        f <= f1
          ? Math.max(0, (f - f0) / (f1 - f0))
          : Math.max(0, (f2 - f) / (f2 - f1));
    }
    melWeights.push(w);
  }

  const dct: Float64Array[] = [];
  for (let c = 1; c <= NUM_CEPS; c++) {
    const row = new Float64Array(NUM_MEL);
    for (let i = 0; i < NUM_MEL; i++) {
      row[i] =
        Math.cos((Math.PI * c * (2 * i + 1)) / (2 * NUM_MEL)) *
        Math.sqrt(2 / NUM_MEL);
    }
    dct.push(row);
  }

  const t: Tables = {
    frameSize,
    hop,
    nfft,
    window,
    bitrev,
    twCos,
    twSin,
    melLo,
    melWeights,
    dct,
  };
  tableCache.set(sampleRate, t);
  return t;
}

function zeros(): Voiceprint {
  return new Array<number>(VOICEPRINT_LENGTH).fill(0);
}

export function analyzeVoiceprint(
  pcm: Float32Array,
  sampleRate: number,
): VoiceprintAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
    return { voiceprint: zeros(), speechSeconds: 0, snrDb: 0 };
  }
  const t = tablesFor(sampleRate);
  if (pcm.length < t.frameSize) {
    return { voiceprint: zeros(), speechSeconds: 0, snrDb: 0 };
  }

  const { frameSize, hop, nfft, window, bitrev, twCos, twSin } = t;
  const frameCount = Math.floor((pcm.length - frameSize) / hop) + 1;
  const ceps = new Float64Array(frameCount * NUM_CEPS);
  const energyDb = new Float64Array(frameCount);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const windowed = new Float64Array(frameSize);
  const logMel = new Float64Array(NUM_MEL);
  const speechMinPow = SPEECH_MIN_RMS * SPEECH_MIN_RMS;
  let speechFrames = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      const x = pcm[start + i];
      const prev = start + i > 0 ? pcm[start + i - 1] : 0;
      windowed[i] = (x - PRE_EMPHASIS * prev) * window[i];
      energy += x * x;
    }
    const meanPow = energy / frameSize;
    energyDb[f] = 10 * Math.log10(meanPow + 1e-12);
    if (meanPow >= speechMinPow) speechFrames++;

    for (let i = 0; i < nfft; i++) {
      const j = bitrev[i];
      re[i] = j < frameSize ? windowed[j] : 0;
      im[i] = 0;
    }
    for (let size = 2; size <= nfft; size <<= 1) {
      const half = size >> 1;
      const step = nfft / size;
      for (let s = 0; s < nfft; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = twCos[k * step];
          const wi = twSin[k * step];
          const a = s + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    for (let m = 0; m < NUM_MEL; m++) {
      const w = t.melWeights[m];
      const lo = t.melLo[m];
      let acc = 0;
      for (let k = 0; k < w.length; k++) {
        const bin = lo + k;
        acc += ((re[bin] * re[bin] + im[bin] * im[bin]) / nfft) * w[k];
      }
      logMel[m] = Math.log(acc + 1e-10);
    }
    for (let c = 0; c < NUM_CEPS; c++) {
      const row = t.dct[c];
      let acc = 0;
      for (let i = 0; i < NUM_MEL; i++) acc += row[i] * logMel[i];
      ceps[f * NUM_CEPS + c] = acc;
    }
  }

  const sortedDb = Array.from(energyDb).sort((a, b) => a - b);
  const loudDb = sortedDb[Math.floor(0.95 * (sortedDb.length - 1))];
  // Digital silence (exact zeros, common at the start of a recording) is
  // not the room's background and would make any audio look noise-free.
  const audibleDb = sortedDb.filter((d) => d > DIGITAL_SILENCE_DB);
  const floorDb = audibleDb.length
    ? audibleDb[Math.floor(0.1 * (audibleDb.length - 1))]
    : DIGITAL_SILENCE_DB;
  let kept = 0;
  const keep = new Uint8Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    if (energyDb[f] >= loudDb - ENERGY_GATE_DB) {
      keep[f] = 1;
      kept++;
    }
  }
  if (kept < 10) {
    keep.fill(1);
    kept = frameCount;
  }

  const mean = new Array<number>(NUM_CEPS).fill(0);
  const sq = new Array<number>(NUM_CEPS).fill(0);
  for (let f = 0; f < frameCount; f++) {
    if (!keep[f]) continue;
    for (let c = 0; c < NUM_CEPS; c++) mean[c] += ceps[f * NUM_CEPS + c];
  }
  for (let c = 0; c < NUM_CEPS; c++) mean[c] /= kept;
  for (let f = 0; f < frameCount; f++) {
    if (!keep[f]) continue;
    for (let c = 0; c < NUM_CEPS; c++) {
      const d = ceps[f * NUM_CEPS + c] - mean[c];
      sq[c] += d * d;
    }
  }
  const std = sq.map((v) => Math.sqrt(v / kept));

  return {
    voiceprint: [...mean, ...std],
    speechSeconds: (speechFrames * hop) / sampleRate,
    snrDb: loudDb - floorDb,
  };
}

export function extractVoiceprint(
  pcm: Float32Array,
  sampleRate: number,
): Voiceprint {
  return analyzeVoiceprint(pcm, sampleRate).voiceprint;
}

/** Enrollment reference: plain mean of the per-clip voiceprints. */
export function averageVoiceprints(prints: Voiceprint[]): Voiceprint {
  const valid = prints.filter((p) => p.length === VOICEPRINT_LENGTH);
  if (valid.length === 0) return zeros();
  const out = zeros();
  for (const p of valid) {
    for (let i = 0; i < VOICEPRINT_LENGTH; i++) out[i] += p[i] / valid.length;
  }
  return out;
}

function project(v: Voiceprint): number[] {
  return LDA_PROJECTION.map((row) => {
    let acc = 0;
    for (let j = 0; j < VOICEPRINT_LENGTH; j++) acc += row[j] * v[j];
    return acc;
  });
}

/** Similarity in (0, 1]: exp(-RMS distance) in LDA space. */
export function voiceprintSimilarity(a: Voiceprint, b: Voiceprint): number {
  const pa = project(a);
  const pb = project(b);
  let s = 0;
  for (let i = 0; i < pa.length; i++) s += (pa[i] - pb[i]) ** 2;
  return Math.exp(-Math.sqrt(s / pa.length));
}
