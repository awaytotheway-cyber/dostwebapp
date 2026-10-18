import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { computeFbank, subtractFeatureMean } from './fbank';

/**
 * ══════════════════════════════════════════════════════════════════
 * Neural speaker embedding — model 'wespeaker-resnet34-v1'
 * ══════════════════════════════════════════════════════════════════
 *
 * The same family of technology behind "Hey Siri" personalisation,
 * Alexa Voice ID and Google Voice Match: a deep network trained on
 * thousands of speakers maps any stretch of speech to a 256-number
 * embedding, and two stretches from the same person land close together
 * (cosine similarity) regardless of the words, the room or the mic.
 *
 * Model: WeSpeaker ResNet34 trained on VoxCeleb (≈7,000 speakers, many
 * accents and languages incl. Indian English), ONNX export published
 * by k2-fsa/sherpa-onnx (Apache-2.0). ~26 MB, downloaded once and
 * cached; never bundled.
 *
 *   JS:     80-bin Kaldi fbank (fbank.ts) → per-utterance mean removal
 *   Native: ONNX Runtime forward pass (SpeakerEmbedder.kt)
 *   JS:     L2-normalise → cosine similarity
 *
 * Measured offline against the old MFCC voiceprint, 24 speakers on one
 * shared microphone (AudioMNIST — the bystander-on-your-phone case),
 * ~2 s segments, equal error rate:
 *                    clean   others talking (10 dB)   fan noise (15 dB)
 *     mfcc-lda-v2     8.6%          17.2%                   18.4%
 *     this model      0.3%           1.8%                    0.4%
 *
 * Everything fails soft: if the native method is missing (an older app
 * binary) or the model can't be downloaded, callers fall back to the
 * MFCC voiceprint.
 * ══════════════════════════════════════════════════════════════════
 */

export const SPEAKER_MODEL_VERSION = 'wespeaker-resnet34-v1';
export const EMBEDDING_LENGTH = 256;

const MODEL_FILENAME = 'wespeaker_en_voxceleb_resnet34.onnx';
const MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx';
const MODEL_BYTES = 26_534_365;
export const SPEAKER_MODEL_APPROX_MB = 27;

// WeSpeaker models are trained on int16-range samples.
const SAMPLE_SCALE = 32768;
// Below ~0.5 s the embedding is too noisy to trust.
const MIN_FRAMES = 50;

const SPEECH_MIN_RMS = 0.006;
const DIGITAL_SILENCE_DB = -90;

export type Embedding = number[];

type NativeEmbedder = {
  computeSpeakerEmbedding: (
    modelPath: string,
    featuresBase64: string,
    frames: number,
  ) => Promise<number[]>;
  releaseSpeakerModel?: () => Promise<boolean>;
};

function nativeEmbedder(): NativeEmbedder | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as Record<string, unknown>).HearingModule as
    | Partial<NativeEmbedder>
    | undefined;
  if (!mod || typeof mod.computeSpeakerEmbedding !== 'function') return null;
  return mod as NativeEmbedder;
}

/** True when this app binary can run the neural model at all. */
export function isNeuralSpeakerSupported(): boolean {
  return nativeEmbedder() !== null;
}

function modelPath(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error('documentDirectory is unavailable on this platform');
  return `${dir}${MODEL_FILENAME}`;
}

export async function isSpeakerModelReady(): Promise<boolean> {
  if (!isNeuralSpeakerSupported()) return false;
  try {
    const info = await FileSystem.getInfoAsync(modelPath());
    return info.exists && (info.size ?? 0) === MODEL_BYTES;
  } catch {
    return false;
  }
}

let inFlightDownload: Promise<boolean> | null = null;

/**
 * Download the model if needed. Resolves true when the neural path is
 * usable on this device, false otherwise (never throws).
 */
export async function ensureSpeakerModel(
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  if (!isNeuralSpeakerSupported()) return false;
  if (await isSpeakerModelReady()) return true;
  if (inFlightDownload) return inFlightDownload;

  inFlightDownload = (async () => {
    const path = modelPath();
    try {
      // A partial file from an interrupted download would fail the size
      // check forever; start clean.
      await FileSystem.deleteAsync(path, { idempotent: true });
      const resumable = FileSystem.createDownloadResumable(MODEL_URL, path, {}, (p) => {
        if (onProgress && p.totalBytesExpectedToWrite > 0) {
          onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
        }
      });
      await resumable.downloadAsync();
      if (await isSpeakerModelReady()) return true;
      await FileSystem.deleteAsync(path, { idempotent: true });
      return false;
    } catch (err) {
      if (__DEV__) console.warn('[hearing] speaker model download failed:', err);
      return false;
    }
  })();

  try {
    return await inFlightDownload;
  } finally {
    inFlightDownload = null;
  }
}

/**
 * Embedding for one stretch of 16 kHz speech, L2-normalised. Returns
 * null on any failure or when the audio is too short.
 */
export async function embedSpeech(
  pcm: Float32Array,
  sampleRate: number,
): Promise<Embedding | null> {
  const native = nativeEmbedder();
  if (!native) return null;
  const { features, frames } = computeFbank(pcm, sampleRate, SAMPLE_SCALE);
  if (frames < MIN_FRAMES) return null;
  subtractFeatureMean(features, frames);
  try {
    const raw = await native.computeSpeakerEmbedding(
      modelPath(),
      float32ToBase64(features),
      frames,
    );
    if (!Array.isArray(raw) || raw.length !== EMBEDDING_LENGTH) return null;
    return normalize(raw);
  } catch (err) {
    if (__DEV__) console.warn('[hearing] embedSpeech failed:', err);
    return null;
  }
}

export async function releaseSpeakerModel(): Promise<void> {
  try {
    await nativeEmbedder()?.releaseSpeakerModel?.();
  } catch {
    // best-effort
  }
}

export function cosineSimilarity(a: Embedding, b: Embedding): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Enrollment reference: normalised mean of normalised embeddings. */
export function averageEmbeddings(list: Embedding[]): Embedding {
  const valid = list.filter((e) => e.length === EMBEDDING_LENGTH);
  const out = new Array<number>(EMBEDDING_LENGTH).fill(0);
  for (const e of valid) for (let i = 0; i < EMBEDDING_LENGTH; i++) out[i] += e[i];
  return normalize(out);
}

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export type SpeechStats = {
  speechSeconds: number;
  // Loud-frame vs quiet-frame energy gap: how far speech rises above
  // the room's background.
  snrDb: number;
};

/** Cheap energy statistics (25 ms frames, 10 ms hop) — no FFT. */
export function speechStats(pcm: Float32Array, sampleRate: number): SpeechStats {
  const frame = Math.round(sampleRate * 0.025);
  const hop = Math.round(sampleRate * 0.01);
  if (pcm.length < frame) return { speechSeconds: 0, snrDb: 0 };
  const count = 1 + Math.floor((pcm.length - frame) / hop);
  const db = new Float64Array(count);
  const minPow = SPEECH_MIN_RMS * SPEECH_MIN_RMS;
  let speechFrames = 0;
  for (let f = 0; f < count; f++) {
    let e = 0;
    const start = f * hop;
    for (let i = 0; i < frame; i++) {
      const x = pcm[start + i];
      e += x * x;
    }
    const pow = e / frame;
    if (pow >= minPow) speechFrames++;
    db[f] = 10 * Math.log10(pow + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const loud = sorted[Math.floor(0.95 * (sorted.length - 1))];
  const audible = sorted.filter((d) => d > DIGITAL_SILENCE_DB);
  const floor = audible.length
    ? audible[Math.floor(0.1 * (audible.length - 1))]
    : DIGITAL_SILENCE_DB;
  return { speechSeconds: (speechFrames * hop) / sampleRate, snrDb: loud - floor };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function float32ToBase64(data: Float32Array): string {
  // Copy into a fresh little-endian byte view (every RN target is LE).
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  const CHUNK = 3 * 4096;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    let s = '';
    for (let i = start; i < end; i += 3) {
      const a = bytes[i];
      const b = i + 1 < end ? bytes[i + 1] : 0;
      const c = i + 2 < end ? bytes[i + 2] : 0;
      const triple = (a << 16) | (b << 8) | c;
      s += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
      s += i + 1 < end ? B64[(triple >> 6) & 63] : '=';
      s += i + 2 < end ? B64[triple & 63] : '=';
    }
    out.push(s);
  }
  return out.join('');
}

export const __test = { float32ToBase64 };
