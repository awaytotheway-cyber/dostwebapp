/**
 * Where the neural speaker model comes from, and what enrollment does
 * when it can't be fetched. Pure, so both rules are testable.
 *
 * WHY TWO SOURCES. Some networks can't reach GitHub's release file host,
 * and the download then fails on the phone while working everywhere
 * else. Hugging Face serves a byte-for-byte identical copy (same size,
 * same SHA-256: 5ef208a9…fe94, checked 2026-11-11), and the app already
 * downloads its Whisper model from Hugging Face. The caller accepts a
 * file from either source only at the exact expected size.
 *
 * WHY NO SILENT FALLBACK. When the model could run but its download
 * failed, enrollment used to fall back to the basic MFCC voiceprint
 * without saying so. Against that voiceprint the owner's own speech
 * scored 0.36–0.42 and every segment was dropped as "unclear", so a
 * session heard nothing. Now that case stops and asks the person to try
 * again. The basic voiceprint remains only for builds that cannot run
 * the neural model at all.
 */

export const SPEAKER_MODEL_URLS: readonly string[] = [
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx',
  'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/wespeaker_en_voxceleb_resnet34.onnx',
];

/**
 * Run `attempt` on each source in order and return the first that
 * succeeds, or null when none does. A source that throws counts as a
 * failure and the next one is tried.
 */
export async function tryInOrder(
  sources: readonly string[],
  attempt: (source: string) => Promise<boolean>,
): Promise<string | null> {
  for (const source of sources) {
    try {
      if (await attempt(source)) return source;
    } catch {
      // Unreachable host, interrupted transfer: try the next source.
    }
  }
  return null;
}

/**
 * The engine a fresh enrollment should use, or null when it must stop
 * and ask the person to retry: the neural model could run here, but it
 * isn't on the phone.
 */
export function enrollmentEngineFor(state: {
  neuralSupported: boolean;
  modelReady: boolean;
}): 'neural' | 'mfcc' | null {
  if (!state.neuralSupported) return 'mfcc';
  return state.modelReady ? 'neural' : null;
}
