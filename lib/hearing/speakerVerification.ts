import { voiceprintSimilarity, type Voiceprint } from './speakerFingerprint';
import { MODEL_THRESHOLDS } from './voiceprintModel';

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
 *   accept  — at or above this, the segment is confidently the user
 *   reject  — strictly below this, the segment is confidently someone else
 *   between — ambiguous → discard (Rule 5)
 *
 * Fitted alongside the LDA projection; see voiceprintModel.ts for the
 * measured false-accept / false-reject rates behind each setting.
 */
export const THRESHOLDS: Record<Sensitivity, { accept: number; reject: number }> =
  MODEL_THRESHOLDS;

// Segments with less voiced audio than this can't be judged reliably.
export const MIN_SPEECH_SECONDS = 0.5;

export function verifySpeaker(
  segmentVoiceprint: Voiceprint,
  referenceVoiceprint: Voiceprint,
  sensitivity: Sensitivity = 'balanced',
  speechSeconds: number = Infinity,
): VerificationOutcome {
  const similarity = voiceprintSimilarity(segmentVoiceprint, referenceVoiceprint);
  if (speechSeconds < MIN_SPEECH_SECONDS) return { result: 'ambiguous', similarity };
  const { accept, reject } = THRESHOLDS[sensitivity];
  if (similarity >= accept) return { result: 'match', similarity };
  if (similarity < reject) return { result: 'mismatch', similarity };
  return { result: 'ambiguous', similarity };
}
