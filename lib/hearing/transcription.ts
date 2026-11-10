// The `whisper.rn` package's `exports` map defines only subpath exports,
// so `moduleResolution: bundler` can't resolve the bare root import.
// Import through the explicit `./index` subpath instead.
//
// Type-only: whisper.rn calls TurboModuleRegistry.get('RNWhisper') at the
// top level of its module. On web TurboModuleRegistry is undefined, so a
// static import crashes the whole bundle before React mounts. The runtime
// value is pulled in lazily by loadInitWhisper() below, which keeps the
// module in the bundle but never evaluates it on web.
import type { WhisperContext } from 'whisper.rn/index';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import { cleanTranscript, encodeWav, floatToPcm16 } from './pcm';

/**
 * Transcription for hearing sessions.
 *
 * Default: on-device Whisper. The multilingual base quantized model
 * (~57 MB) is downloaded once from the canonical whisper.cpp HuggingFace
 * repository — the same URL pattern whisper.rn's own docs point at — and
 * cached in the app's document directory. It is never bundled.
 *
 * Opt-in ("More accurate transcription" in Settings): segments that
 * already passed the speaker gate — only the user's own voice — are sent
 * to the transcribe-voice-note edge function (OpenAI speech-to-text, the
 * same cloud-recognition approach Alexa uses). Nothing is stored there.
 * Any cloud failure falls back to on-device Whisper for that segment.
 *
 * Every function here is designed to fail soft. A hearing session must
 * still run and produce acoustic features even if the model download
 * fails or transcription errors out; the caller sees an empty transcript
 * for that segment and the semantic-emotions leg is simply skipped.
 */

// Multilingual base model — supports 99 languages including English,
// Hindi and Marathi (the three languages DOST's users speak). tiny
// garbled too much real conversation, Hindi and Marathi especially;
// base roughly halves the word error rate for ~2x the compute.
const MODEL_FILENAME = 'ggml-base-q5_1.bin';
// Replaced by MODEL_FILENAME; deleted on first download to free space.
const LEGACY_MODEL_FILENAMES = ['ggml-tiny-q5_1.bin'];

// Canonical whisper.cpp GGML model URL. This is where ggerganov
// publishes every whisper.cpp GGML/quantized model.
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin';

// Approximate on-disk size (~57 MB). Used only for the disclosure copy
// so we don't hardcode a number the UI can lie about.
export const MODEL_APPROX_MB = 57;

const CLOUD_KEY = 'dost.hearing.cloudTranscription.v1';

export type TranscriptionOptions = {
  cloud: boolean;
  // ISO 639-1 hint ('en' | 'hi' | 'mr'); undefined = detect.
  language?: string;
};

export async function getCloudTranscription(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CLOUD_KEY)) === 'on';
  } catch {
    return false;
  }
}

export async function setCloudTranscription(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CLOUD_KEY, on ? 'on' : 'off');
  } catch {
    // best-effort
  }
}

let whisperContext: WhisperContext | null = null;
let inFlightInit: Promise<WhisperContext> | null = null;

type InitWhisper = (opts: { filePath: string }) => Promise<WhisperContext>;

/**
 * Resolve whisper.rn's initWhisper at call time rather than import time.
 * Evaluating the module registers a TurboModule, which only exists on a
 * native build — doing it eagerly takes the web bundle down with it.
 */
function loadInitWhisper(): InitWhisper {
  if (Platform.OS === 'web') {
    throw new Error('On-device transcription is not available on the web build.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('whisper.rn/index') as { initWhisper: InitWhisper }).initWhisper;
}

export type DownloadProgress = (fractionComplete: number) => void;

export function getModelPath(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error('documentDirectory is unavailable on this platform');
  return `${dir}${MODEL_FILENAME}`;
}

export async function isModelDownloaded(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(getModelPath());
    return info.exists && (info.size ?? 0) > 1_000_000; // guard against a 0-byte stub
  } catch {
    return false;
  }
}

export async function ensureModelDownloaded(
  onProgress?: DownloadProgress,
): Promise<string> {
  const modelPath = getModelPath();
  if (await isModelDownloaded()) return modelPath;

  const resumable = FileSystem.createDownloadResumable(
    MODEL_URL,
    modelPath,
    {},
    (progress) => {
      if (!onProgress) return;
      const total = progress.totalBytesExpectedToWrite;
      if (total > 0) {
        onProgress(progress.totalBytesWritten / total);
      }
    },
  );

  const result = await resumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('Whisper model download failed');
  }
  const dir = FileSystem.documentDirectory;
  for (const legacy of LEGACY_MODEL_FILENAMES) {
    if (!dir) break;
    await FileSystem.deleteAsync(`${dir}${legacy}`, { idempotent: true }).catch(() => {});
  }
  return result.uri;
}

export async function initTranscription(
  onDownloadProgress?: DownloadProgress,
): Promise<WhisperContext> {
  if (whisperContext) return whisperContext;
  if (inFlightInit) return inFlightInit;

  inFlightInit = (async () => {
    const modelPath = await ensureModelDownloaded(onDownloadProgress);
    const ctx = await loadInitWhisper()({ filePath: modelPath });
    whisperContext = ctx;
    return ctx;
  })();

  try {
    return await inFlightInit;
  } finally {
    inFlightInit = null;
  }
}

/**
 * Transcribe a single speaker-verified speech segment. Returns '' on any
 * failure — the caller is expected to keep the pipeline running and let
 * the semantic-emotion leg be skipped for that segment.
 */
export async function transcribeSegment(
  pcm: Float32Array,
  sampleRate: number,
  options: TranscriptionOptions = { cloud: false },
): Promise<string> {
  if (options.cloud) {
    const text = await transcribeInCloud(pcm, sampleRate, options.language);
    if (text) return text;
  }
  return transcribeOnDevice(pcm, options.language);
}

async function transcribeInCloud(
  pcm: Float32Array,
  sampleRate: number,
  language?: string,
): Promise<string> {
  try {
    const lang = language ?? 'auto';
    const { data, error } = await supabase.functions.invoke<{ transcript?: string }>(
      `transcribe-voice-note?language=${encodeURIComponent(lang)}`,
      {
        body: encodeWav(pcm, sampleRate),
        headers: { 'Content-Type': 'audio/wav' },
      },
    );
    if (error || typeof data?.transcript !== 'string') return '';
    return cleanTranscript(data.transcript);
  } catch (err) {
    if (__DEV__) console.warn('[hearing] cloud transcription failed:', err);
    return '';
  }
}

async function transcribeOnDevice(pcm: Float32Array, language?: string): Promise<string> {
  try {
    const ctx = whisperContext ?? (await initTranscription());
    // transcribeData() reads its ArrayBuffer as signed 16-bit PCM, never
    // as Float32 — the Float32Array's own bytes would be heard as noise.
    const { promise } = ctx.transcribeData(floatToPcm16(pcm), {
      // With one enrolled language, say so — detection on short clips
      // often mislabels Hindi/Marathi. With several, 'auto' detects per
      // segment so a mixed session keeps each segment's own language.
      language: language ?? 'auto',
      maxThreads: 2,
    });
    const res = await promise;
    return cleanTranscript(res?.result ?? '');
  } catch (err) {
    // Deliberately soft — a transcription failure never aborts a session.
    if (__DEV__) console.warn('[hearing] transcribeSegment failed:', err);
    return '';
  }
}

export async function disposeTranscription(): Promise<void> {
  const ctx = whisperContext;
  whisperContext = null;
  if (ctx) {
    try {
      await ctx.release();
    } catch {
      // Ignore — release is best-effort.
    }
  }
}
