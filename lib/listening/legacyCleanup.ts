import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * One-time removal of what the old cloud hearing pipeline left on the
 * phone: the downloaded Whisper model (~31 MB) and its stored settings.
 * The enrollment-language choice is kept for the new enrollment.
 */
const DONE_KEY = 'dost.listening.legacyCleanup.v1';
const OLD_KEYS = [
  'dost.hearing.disclosure.ack.v1',
  'dost.hearing.enrollment.complete.v1',
  'dost.hearing.sensitivity.v1',
];
const OLD_PREFIXES = ['dost.hearing.speakerCalibration.'];
const OLD_FILES = ['ggml-tiny-q5_1.bin'];

export async function cleanUpOldHearingData(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(DONE_KEY)) return;
    const all = await AsyncStorage.getAllKeys();
    const stale = all.filter(
      (k) => OLD_KEYS.includes(k) || OLD_PREFIXES.some((p) => k.startsWith(p)),
    );
    if (stale.length) await AsyncStorage.multiRemove(stale);
    const doc = FileSystem.documentDirectory;
    if (doc) {
      for (const name of OLD_FILES) {
        await FileSystem.deleteAsync(`${doc}${name}`, { idempotent: true });
      }
    }
    await AsyncStorage.setItem(DONE_KEY, new Date().toISOString());
  } catch {
    // Retried on the next app start.
  }
}
