// The `whisper.rn` package's `exports` map defines only subpath exports,
// so `moduleResolution: bundler` can't resolve the bare root import.
// Import through the explicit `./index` subpath instead.
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
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

const MODEL_FILENAME = 'ggml-tiny.en-q5_1.bin';

// Canonical whisper.cpp GGML model URL. This is the file location
// whisper.rn's README references directly, and it is where ggerganov
// publishes every whisper.cpp GGML/quantized model.
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin';

// Approximate on-disk size (~31 MB). Used only for the disclosure copy
// so we don't hardcode a number the UI can lie about.
export const MODEL_APPROX_MB = 31;

let whisperContext: WhisperContext | null = null;
let inFlightInit: Promise<WhisperContext> | null = null;

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
    const ctx = await initWhisper({ filePath: modelPath });
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
      language: 'en',
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
