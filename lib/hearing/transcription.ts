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
import * as FileSystem from 'expo-file-system/legacy';

/**
 * On-device Whisper transcription for hearing sessions.
 *
 * The tiny English quantized model (~31 MB) is downloaded once from the
 * canonical whisper.cpp HuggingFace repository — the same URL pattern
 * whisper.rn's own docs point at — and cached in the app's document
 * directory. It is never bundled.
 *
 * Every function here is designed to fail soft. A hearing session must
 * still run and produce acoustic features even if the model download
 * fails or transcription errors out; the caller sees an empty transcript
 * for that segment and the semantic-emotions leg is simply skipped.
 */

// Multilingual tiny model — supports 99 languages including English,
// Hindi and Marathi (the three languages DOST's users speak). The
// English-only variant (ggml-tiny.en-q5_1.bin) would garble anything
// non-English, so we deliberately use the multilingual build even
// though it's slightly less accurate on pure English input.
const MODEL_FILENAME = 'ggml-tiny-q5_1.bin';

// Canonical whisper.cpp GGML model URL. This is where ggerganov
// publishes every whisper.cpp GGML/quantized model.
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin';

// Approximate on-disk size (~31 MB). Used only for the disclosure copy
// so we don't hardcode a number the UI can lie about.
export const MODEL_APPROX_MB = 31;

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
 * Transcribe a single VAD-detected speech segment. Returns '' on any
 * failure — the caller is expected to keep the pipeline running and let
 * the semantic-emotion leg be skipped for that segment.
 */
export async function transcribeSegment(pcm: Float32Array): Promise<string> {
  try {
    const ctx = whisperContext ?? (await initTranscription());
    // whisper.rn accepts a base64-encoded Float32 string OR an ArrayBuffer.
    // Slice to a clean ArrayBuffer view — a Float32Array from a Base64
    // decode may carry a byteOffset otherwise.
    // pcm.buffer is ArrayBufferLike in TS 5.9's typed-array typings, but
    // our Float32Array is always backed by a plain ArrayBuffer in the
    // bridge — cast to satisfy whisper.rn's ArrayBuffer parameter.
    const buf = pcm.buffer.slice(
      pcm.byteOffset,
      pcm.byteOffset + pcm.byteLength,
    ) as ArrayBuffer;
    const { promise } = ctx.transcribeData(buf, {
      // 'auto' lets Whisper detect the language per segment, so a
      // session that mixes English, Hindi and Marathi transcribes
      // each segment in its own language rather than forcing one.
      language: 'auto',
      maxThreads: 2,
    });
    const res = await promise;
    return (res?.result ?? '').trim();
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
