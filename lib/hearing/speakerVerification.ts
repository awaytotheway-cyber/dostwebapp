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
 * self-scores. A segment noticeably noisier than the enrollment is
 * discarded outright, because noise pulls strangers' voices toward the
 * user's reference.
 *
 * Measured per 1.5–4 s segment, own voice kept / others accepted:
 *                      quiet room    people talking nearby   fan noise
 *   strict   (p60)     40% / 1%      44% / 2%                discarded
 *   balanced (p50)     48% / 1%      52% / 3%                discarded
 *   lenient  (p30)     66% / 2%      69% / 6%                discarded
 * on 200 held-out Speech Commands speakers (different words at
 * enrollment and test). On 60 speakers from an unseen recording setup
 * (AudioMNIST, everyone on the same mic), balanced kept 78% with 2%
 * others accepted in a quiet room. Real Hindi/Marathi conversation
 * will differ; speaker_verification_calibration logs real scores.
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
  lenient: 0.3,
};
const REJECT_PERCENTILE = 0.05;
// Guards against a poor enrollment producing a near-zero accept line.
const MIN_ACCEPT_SIMILARITY = 0.2;
const NOISE_VETO_DB = 15;
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
  if (
    segment.speechSeconds < MIN_SPEECH_SECONDS ||
    segment.snrDb < calibration.enrollmentSnrDb - NOISE_VETO_DB
  ) {
    return { result: 'ambiguous', similarity };
  }
  if (similarity >= calibration.accept[sensitivity]) return { result: 'match', similarity };
  if (similarity < calibration.reject) return { result: 'mismatch', similarity };
  return { result: 'ambiguous', similarity };
}
