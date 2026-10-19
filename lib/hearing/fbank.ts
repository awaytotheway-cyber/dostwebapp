/**
 * Kaldi-compatible 80-bin log-mel filterbank — the front-end that neural
 * speaker-embedding models (WeSpeaker, 3D-Speaker CAM++) are trained on.
 *
 * Matches kaldi-native-fbank's defaults at inference time: 25 ms frames,
 * 10 ms hop, snip_edges, DC removal, 0.97 pre-emphasis, Povey window,
 * 512-point power spectrum, 80 triangular bins on Kaldi's mel scale
 * (20 Hz – Nyquist), natural log, no dither. Checked against
 * kaldi_native_fbank to within float rounding.
 *
 * Output is a flat Float32Array of frameCount × FBANK_BINS, row-major.
 */

export const FBANK_BINS = 80;

const PRE_EMPHASIS = 0.97;
const LOW_FREQ_HZ = 20;
const LOG_FLOOR = 1.1920928955078125e-7; // float32 epsilon, as Kaldi uses

type Tables = {
  frameSize: number;
  hop: number;
  nfft: number;
  window: Float64Array;
  bitrev: Uint32Array;
  twCos: Float64Array;
  twSin: Float64Array;
  binLo: Int32Array;
  binWeights: Float64Array[];
};

const tableCache = new Map<number, Tables>();

function kaldiMel(hz: number): number {
  return 1127 * Math.log(1 + hz / 700);
}

function tablesFor(sampleRate: number): Tables {
  const hit = tableCache.get(sampleRate);
  if (hit) return hit;

  const frameSize = Math.round(sampleRate * 0.025);
  const hop = Math.round(sampleRate * 0.01);
  let nfft = 1;
  while (nfft < frameSize) nfft <<= 1;
  const bits = Math.log2(nfft);

  const window = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1)), 0.85);
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

  // Kaldi builds the triangles in mel space and leaves out the Nyquist bin.
  const numFftBins = nfft / 2;
  const binHz = sampleRate / nfft;
  const melLow = kaldiMel(LOW_FREQ_HZ);
  const melHigh = kaldiMel(sampleRate / 2);
  const delta = (melHigh - melLow) / (FBANK_BINS + 1);
  const binLo = new Int32Array(FBANK_BINS);
  const binWeights: Float64Array[] = [];
  for (let m = 0; m < FBANK_BINS; m++) {
    const left = melLow + m * delta;
    const center = left + delta;
    const right = center + delta;
    let first = -1;
    const w: number[] = [];
    for (let i = 0; i < numFftBins; i++) {
      const mel = kaldiMel(binHz * i);
      if (mel > left && mel < right) {
        if (first < 0) first = i;
        w.push(mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center));
      }
    }
    binLo[m] = Math.max(0, first);
    binWeights.push(Float64Array.from(w));
  }

  const t: Tables = { frameSize, hop, nfft, window, bitrev, twCos, twSin, binLo, binWeights };
  tableCache.set(sampleRate, t);
  return t;
}

/**
 * @param pcm      mono samples in [-1, 1]
 * @param scale    multiplier applied before analysis. WeSpeaker models
 *                 expect int16-range samples (32768); CAM++ expects 1.
 */
export function computeFbank(
  pcm: Float32Array,
  sampleRate: number,
  scale = 1,
): { features: Float32Array; frames: number } {
  const t = tablesFor(sampleRate);
  const { frameSize, hop, nfft, window, bitrev, twCos, twSin } = t;
  if (pcm.length < frameSize) return { features: new Float32Array(0), frames: 0 };

  const frames = 1 + Math.floor((pcm.length - frameSize) / hop);
  const out = new Float32Array(frames * FBANK_BINS);
  const frame = new Float64Array(frameSize);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const power = new Float64Array(nfft / 2 + 1);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let mean = 0;
    for (let i = 0; i < frameSize; i++) {
      frame[i] = pcm[start + i] * scale;
      mean += frame[i];
    }
    mean /= frameSize;
    for (let i = 0; i < frameSize; i++) frame[i] -= mean;
    for (let i = frameSize - 1; i > 0; i--) frame[i] -= PRE_EMPHASIS * frame[i - 1];
    frame[0] -= PRE_EMPHASIS * frame[0];
    for (let i = 0; i < frameSize; i++) frame[i] *= window[i];

    for (let i = 0; i < nfft; i++) {
      const j = bitrev[i];
      re[i] = j < frameSize ? frame[j] : 0;
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
    for (let k = 0; k <= nfft / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];

    const row = f * FBANK_BINS;
    for (let m = 0; m < FBANK_BINS; m++) {
      const w = t.binWeights[m];
      const lo = t.binLo[m];
      let acc = 0;
      for (let k = 0; k < w.length; k++) acc += power[lo + k] * w[k];
      out[row + m] = Math.log(Math.max(acc, LOG_FLOOR));
    }
  }
  return { features: out, frames };
}

/** Per-utterance cepstral mean normalisation, in place. */
export function subtractFeatureMean(features: Float32Array, frames: number): void {
  if (frames === 0) return;
  for (let m = 0; m < FBANK_BINS; m++) {
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += features[f * FBANK_BINS + m];
    mean /= frames;
    for (let f = 0; f < frames; f++) features[f * FBANK_BINS + m] -= mean;
  }
}
