import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Sensitivity } from './speakerVerification';

/**
 * Persistence for the speaker-verification sensitivity setting.
 * Held in AsyncStorage so it survives app restarts without a
 * per-session network read. Default is 'balanced'.
 */

const KEY = 'dost.hearing.sensitivity.v1';
const DEFAULT: Sensitivity = 'balanced';

const VALID: readonly Sensitivity[] = ['strict', 'balanced', 'lenient'];

function isSensitivity(v: string | null): v is Sensitivity {
  return v !== null && (VALID as readonly string[]).includes(v);
}

export async function getSensitivity(): Promise<Sensitivity> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return isSensitivity(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function setSensitivity(value: Sensitivity): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value);
  } catch {
    // best-effort — a failed write means we'll keep using the last value
  }
}
