import { supabase } from '../supabase';
import type { Sensitivity, VerificationResult } from './speakerVerification';

/**
 * Time-boxed calibration logging for speaker verification.
 *
 * For a bounded window per user we log every verification outcome
 * (similarity + classification) into speaker_verification_calibration.
 * The window is capped by two limits, whichever comes first:
 *
 *   - CALIBRATION_LOG_DAYS days since enrollment
 *   - CALIBRATION_LOG_MAX_ROWS rows written for this user
 *
 * The pipeline consults shouldLogCalibration() once at session start
 * and treats the answer as fixed for the session's lifetime. Per-row
 * writes are fire-and-forget: a failing insert never blocks the
 * pipeline and never surfaces to the user. Once thresholds are tuned
 * and the table is dropped in the DB, the inserts silently fail and
 * everything else keeps working.
 */

export const CALIBRATION_LOG_DAYS = 3;
export const CALIBRATION_LOG_MAX_ROWS = 200;

export type CalibrationDecision = {
  shouldLog: boolean;
  rowsRemaining: number;
};

/**
 * Decide whether this user is still in their logging window. Returns
 * rowsRemaining so the caller can enforce the cap per-segment during
 * the session without another DB round trip.
 */
export async function shouldLogCalibration(
  userId: string,
): Promise<CalibrationDecision> {
  try {
    // Enrolled recently?
    const { data: enroll } = await supabase
      .from('speaker_enrollment')
      .select('enrolled_at')
      .eq('user_id', userId)
      .maybeSingle();
    const enrolledAt = enroll?.enrolled_at ? new Date(enroll.enrolled_at) : null;
    if (!enrolledAt) return { shouldLog: false, rowsRemaining: 0 };

    const now = Date.now();
    const windowEnd = enrolledAt.getTime() + CALIBRATION_LOG_DAYS * 24 * 60 * 60 * 1000;
    if (now >= windowEnd) return { shouldLog: false, rowsRemaining: 0 };

    // Under the row cap for this user?
    const { count } = await supabase
      .from('speaker_verification_calibration')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const already = count ?? 0;
    const remaining = Math.max(0, CALIBRATION_LOG_MAX_ROWS - already);
    if (remaining <= 0) return { shouldLog: false, rowsRemaining: 0 };

    return { shouldLog: true, rowsRemaining: remaining };
  } catch {
    // If any check fails, don't log — better to have no calibration
    // data than to break the session pipeline on a metadata query.
    return { shouldLog: false, rowsRemaining: 0 };
  }
}

/**
 * Fire-and-forget insert. Never awaited by the pipeline. Never throws.
 */
export function logCalibrationRow(
  userId: string,
  similarity: number,
  classification: VerificationResult,
  sensitivity: Sensitivity,
): void {
  void (async () => {
    try {
      await supabase
        .from('speaker_verification_calibration')
        .insert({
          user_id: userId,
          similarity,
          classification,
          sensitivity,
        });
    } catch {
      // Fire-and-forget: never surface calibration errors.
    }
  })();
}
