/**
 * ══════════════════════════════════════════════════════════════════
 * ⚠️  MOCK — ACOUSTIC EMOTION INFERENCE  ⚠️
 * ══════════════════════════════════════════════════════════════════
 *
 * WHAT IS REAL IN PHASE 1:
 *   • Acoustic features (energy, pitch, rate, silence) — see
 *     acousticFeatures.ts. Real signal processing, real measurements.
 *   • Semantic emotions from transcript — existing Phase 5 pipeline.
 *
 * WHAT IS MOCK HERE:
 *   • Only arousal/valence inference from acoustics. This requires a
 *     trained model that does not exist in this build.
 *
 * WHY THIS IS SAFE:
 *   Everything written from here carries inference_source = 'mock'.
 *   DOST's chat function filters that value out at the query level.
 *   Mock data can never reach a user-facing reflection.
 *
 * TO MAKE THIS REAL (a future phase, needs an ML specialist):
 *   1. Train or source a TFLite arousal/valence regressor.
 *      Datasets: MSP-Podcast, IEMOCAP (dimensional annotations).
 *      Avoid categorical SER models trained on acted speech (RAVDESS,
 *      CREMA-D) — they do not generalise to spontaneous conversation.
 *   2. Input: log-mel spectrogram or wav2vec2 embeddings.
 *   3. Output: continuous arousal + valence, both 0-1.
 *   4. Set inference_source = 'acoustic_v1' ONLY after validating
 *      on real, spontaneous, accented speech — not benchmark scores.
 *
 * DO NOT map acoustic output onto the 16-emotion Vedic taxonomy.
 * Shame, denial, spiritual_bypass etc. are semantic categories and
 * are not acoustically separable. That mapping does not exist and
 * cannot be built from waveform features.
 * ══════════════════════════════════════════════════════════════════
 */

import type { AcousticFeatures } from './acousticFeatures';

export type InferenceSource = 'mock' | 'acoustic_v1' | 'fused_v1';

export type AcousticInference = {
  acoustic_arousal: number;
  acoustic_valence: number;
  inference_source: InferenceSource;
};

export function inferAcousticState(features: AcousticFeatures): AcousticInference {
  // Arousal has a defensible acoustic prior: louder + faster speech
  // reads as higher activation. This heuristic is bounded to [0, 1]
  // and lives alongside real features, but the writer still stamps
  // inference_source = 'mock' so nothing downstream trusts it.
  const arousal = Math.min(
    1,
    features.rms_energy * 0.5 +
      Math.min(1, features.speaking_rate_wpm / 200) * 0.5,
  );

  // Valence — pleasantness — genuinely cannot be derived from these
  // features. A quiet voice is not sad; a loud voice is not happy.
  // Returning neutral rather than fabricating a number: random values
  // would create fake patterns in the data, which is worse than honest
  // emptiness.
  const valence = 0.5;

  return {
    acoustic_arousal: arousal,
    acoustic_valence: valence,
    inference_source: 'mock',
  };
}
