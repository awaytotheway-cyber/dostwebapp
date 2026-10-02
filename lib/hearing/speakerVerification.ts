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
 * phone, especially with background speech; a neural speaker-embedding
 * model is the upgrade path. Real Hindi/Marathi conversation will also
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
