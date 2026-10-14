import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DriftReport } from './driftDetection';

const NUDGE_KEY = 'dost_hearing_pending_nudge';

/**
 * Store a pending nudge based on drift detection results.
 * The next chat session will consume it and inject the context.
 * Only one nudge is stored at a time — latest wins.
 */
export async function storeDriftNudge(
  drift: DriftReport,
): Promise<void> {
  if (!drift.hasDrift) return;

  const parts: string[] = [];

  if (drift.dominantEmotionShift) {
    parts.push(
      `a shift in dominant emotion from "${drift.dominantEmotionShift.from}" to "${drift.dominantEmotionShift.to}"`,
    );
  }

  if (drift.dominantNeedShift) {
    parts.push(
      `a shift in underlying need from "${drift.dominantNeedShift.from}" to "${drift.dominantNeedShift.to}"`,
    );
  }

  for (const d of drift.dimensions) {
    parts.push(`${d.label.toLowerCase()} ${d.direction === 'up' ? 'increasing' : 'decreasing'}`);
  }

  if (parts.length === 0) return;

  const nudge = `DOST's listening sessions have noticed ${parts.join(', ')} over recent sessions. If it feels natural, gently and briefly acknowledge you've noticed a shift — but only if the person seems open. Never announce data or recite numbers.`;

  try {
    await AsyncStorage.setItem(NUDGE_KEY, nudge);
  } catch {
    // fail-open
  }
}

/**
 * Consume the pending nudge (returns it and clears it).
 * Returns null if no nudge is pending.
 */
export async function consumeDriftNudge(): Promise<string | null> {
  try {
    const nudge = await AsyncStorage.getItem(NUDGE_KEY);
    if (nudge) {
      await AsyncStorage.removeItem(NUDGE_KEY);
    }
    return nudge;
  } catch {
    return null;
  }
}
