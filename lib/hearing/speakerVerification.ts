import {
  voiceprintSimilarity,
  type Voiceprint,
  type VoiceprintAnalysis,
} from './speakerFingerprint';

/**
 * Speaker verification gate.
 *
 * Rule 5 of Phase 2: when a segment is not clearly the user, it is
 * discarded. Missing a segment of the user's own speech costs only a
 * slightly thinner dataset; wrongly accepting someone else's speech is
 * the exact harm this phase exists to prevent. When in doubt, discard.
 *
 * Absolute similarity moves a lot between phones, rooms and languages,
 * so a single global threshold either rejects everyone or accepts
 * everyone on some devices. Instead, each user's thresholds come from
 * their own enrollment: 3 s windows of each clip are scored against the
 * other clips, and the accept line sits at a percentile of those
 * self-scores. Segments that are noisy (absolutely, or compared with the
 * enrollment) are discarded outright, because noise pulls strangers'
 * voices toward the user's reference.
 *
 * Measured per 1.5–4 s segment, own voice kept / others accepted:
 *
 *   Speech Commands, 200 held-out speakers, each on their own device,
 *   different words at enrollment and test:
 *                 quiet room   others talking nearby   fan noise
 *     strict      40% / 1%     40% / 2%                discarded
 *     balanced    48% / 1%     48% / 2%                discarded
 *     lenient     58% / 1%     56% / 4%                discarded
 *
 *   AudioMNIST, 60 speakers all on the same mic (closest to bystanders
 *   on the user's own phone):
 *     strict      69% / 6%     80% / 17%               discarded
 *     balanced    81% / 9%     88% / 23%               discarded
 *     lenient     91% / 13%    93% / 31%               discarded
 *
 * MFCC voiceprints cannot reliably separate people recorded on the same
 * phone, especially with background speech. The neural embedding gate
 * at the bottom of this file replaces it wherever the device supports
 * it; the MFCC gate remains only as the fallback. Real Hindi/Marathi conversation will also
 * differ; speaker_verification_calibration logs real scores.
 */

export type Sensitivity = 'strict' | 'balanced' | 'lenient';

export type VerificationResult = 'match' | 'mismatch' | 'ambiguous';

export type VerificationOutcome = {
  result: VerificationResult;
  similarity: number;
};

export type SpeakerCalibration = {
  accept: Record<Sensitivity, number>;
  reject: number;
  enrollmentSnrDb: number;
};

const ACCEPT_PERCENTILE: Record<Sensitivity, number> = {
  strict: 0.6,
  balanced: 0.5,
  lenient: 0.4,
};
const REJECT_PERCENTILE = 0.05;
// Guards against a poor enrollment producing a near-zero accept line.
const MIN_ACCEPT_SIMILARITY = 0.2;
// A segment must be at least this clear (speech above background), both
// absolutely and relative to the user's enrollment. Not tied to the
// sensitivity setting: in noise the voiceprint can't tell people apart.
const MIN_SNR_DB = 25;
const MAX_SNR_DROP_FROM_ENROLLMENT_DB = 12;
export const MIN_SPEECH_SECONDS = 0.5;

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function calibrateFromSelfScores(
  selfScores: number[],
  enrollmentSnrDb: number,
): SpeakerCalibration {
  const accept = {} as Record<Sensitivity, number>;
  for (const s of Object.keys(ACCEPT_PERCENTILE) as Sensitivity[]) {
    accept[s] = Math.max(MIN_ACCEPT_SIMILARITY, percentile(selfScores, ACCEPT_PERCENTILE[s]));
  }
  return {
    accept,
    reject: Math.min(percentile(selfScores, REJECT_PERCENTILE), accept.lenient),
    enrollmentSnrDb,
  };
}

export function verifySpeaker(
  segment: VoiceprintAnalysis,
  reference: Voiceprint,
  calibration: SpeakerCalibration,
  sensitivity: Sensitivity = 'balanced',
): VerificationOutcome {
  const similarity = voiceprintSimilarity(segment.voiceprint, reference);
  const minSnrDb = Math.max(
    MIN_SNR_DB,
    calibration.enrollmentSnrDb - MAX_SNR_DROP_FROM_ENROLLMENT_DB,
  );
  if (segment.speechSeconds < MIN_SPEECH_SECONDS || segment.snrDb < minSnrDb) {
    return { result: 'ambiguous', similarity };
  }
  if (similarity >= calibration.accept[sensitivity]) return { result: 'match', similarity };
  if (similarity < calibration.reject) return { result: 'mismatch', similarity };
  return { result: 'ambiguous', similarity };
}

// ─── neural embedding gate (wespeaker-resnet34-v1) ────────────────
//
// Cosine scores from the neural model sit on a different scale. The
// accept line sits between the user's own enrollment self-score (median
// of 3 s windows vs the other clips) and the level typical of a
// different speaker on the same microphone:
//
//   accept = selfMedian − α · (selfMedian − NEURAL_IMPOSTOR_LEVEL)
//
// Measured offline (24 speakers, one shared mic, ~2 s segments; and a
// two-person turn-taking case scored in 1.5 s windows), own speech kept
// / other people accepted:
//
//                 quiet room   others talking   fan noise    turn-taking
//     strict      100% / 2.3%  95% / 0.5%       99% / 0.1%   100% / 5.5%
//     balanced    100% / 3.3%  97% / 0.9%       99% / 0.2%   100% / 6.1%
//     lenient     100% / 6.7%  98% / 2.5%       100% / 0.7%  100% / 8.1%
//
// ("others" is the hardest case: strangers on the very same microphone,
// saying the same words as the user.)
//
// Compared with the MFCC gate above (40–58% of own speech kept on real
// phones), this keeps nearly everything the user says. Noise no longer
// needs a strict SNR floor: the network was trained on noisy speech.

export type NeuralCalibration = {
  selfMedian: number;
  enrollmentSnrDb: number;
};

const NEURAL_IMPOSTOR_LEVEL = 0.3;
const NEURAL_ALPHA: Record<Sensitivity, number> = {
  strict: 0.4,
  balanced: 0.45,
  lenient: 0.55,
};
// Guards against a poor enrollment dragging the accept line down to
// where same-mic strangers start to pass.
const NEURAL_MIN_ACCEPT = 0.4;
// Clearly someone else below this distance under the accept line;
// in between is "ambiguous" (still discarded, but counted separately).
const NEURAL_MISMATCH_MARGIN = 0.12;
const NEURAL_MIN_SNR_DB = 6;

export function calibrateNeuralFromSelfScores(
  selfScores: number[],
  enrollmentSnrDb: number,
): NeuralCalibration {
  return { selfMedian: percentile(selfScores, 0.5), enrollmentSnrDb };
}

export function neuralAcceptThreshold(
  calibration: NeuralCalibration,
  sensitivity: Sensitivity,
): number {
  const { selfMedian } = calibration;
  return Math.max(
    NEURAL_MIN_ACCEPT,
    selfMedian - NEURAL_ALPHA[sensitivity] * (selfMedian - NEURAL_IMPOSTOR_LEVEL),
  );
}

export function verifyNeural(
  similarity: number,
  stats: { speechSeconds: number; snrDb: number },
  calibration: NeuralCalibration,
  sensitivity: Sensitivity = 'balanced',
): VerificationOutcome {
  if (stats.speechSeconds < MIN_SPEECH_SECONDS || stats.snrDb < NEURAL_MIN_SNR_DB) {
    return { result: 'ambiguous', similarity };
  }
  const accept = neuralAcceptThreshold(calibration, sensitivity);
  if (similarity >= accept) return { result: 'match', similarity };
  if (similarity < accept - NEURAL_MISMATCH_MARGIN) return { result: 'mismatch', similarity };
  return { result: 'ambiguous', similarity };
}
