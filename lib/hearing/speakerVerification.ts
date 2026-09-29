import { cosineSimilarity, type Voiceprint } from './speakerFingerprint';

/**
 * Speaker verification gate.
 *
 * Rule 5 of Phase 2: when similarity lands in the ambiguous middle
 * band — not clearly a match, not clearly a mismatch — the segment
 * is discarded. Missing a segment of the user's own speech costs
 * only a slightly thinner dataset; wrongly accepting a segment of
 * someone else's speech is the exact harm this phase exists to
 * prevent. When in doubt, discard.
 */

export type Sensitivity = 'strict' | 'balanced' | 'lenient';

export type VerificationResult = 'match' | 'mismatch' | 'ambiguous';

export type VerificationOutcome = {
  result: VerificationResult;
  similarity: number;
};

/**
 * Similarity thresholds per sensitivity setting.
 *
 *   accept  — at or above this, the segment is confidently the user
 *   reject  — strictly below this, the segment is confidently someone else
 *   between — ambiguous → discard (Rule 5)
 *
 * Numbers chosen based on the MFCC voiceprint's expected same-speaker
 * vs cross-speaker distribution. Step 8's calibration table will let
 * us re-tune these against real user data.
 */
export const THRESHOLDS: Record<Sensitivity, { accept: number; reject: number }> = {
  strict:   { accept: 0.85, reject: 0.75 },
  balanced: { accept: 0.78, reject: 0.65 },
  lenient:  { accept: 0.70, reject: 0.55 },
};

export function verifySpeaker(
  segmentVoiceprint: Voiceprint,
  referenceVoiceprint: Voiceprint,
  sensitivity: Sensitivity = 'balanced',
): VerificationOutcome {
  const similarity = cosineSimilarity(segmentVoiceprint, referenceVoiceprint);
  const { accept, reject } = THRESHOLDS[sensitivity];
  if (similarity >= accept) return { result: 'match', similarity };
  if (similarity < reject) return { result: 'mismatch', similarity };
  return { result: 'ambiguous', similarity };
}
