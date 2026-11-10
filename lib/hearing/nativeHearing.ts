import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { pickHearingBackend, type HearingBackend } from './hearingBackend';

let found: HearingBackend | null = null;

/**
 * The listening module for this device, or null where there isn't one.
 * See hearingBackend.ts for how the platform is chosen.
 *
 * Only a found module is cached. A miss is looked up again next time,
 * exactly as the Android code did before iOS existed — caching a miss
 * would let one early, empty lookup switch listening off for the rest
 * of the app's life.
 */
export function hearingBackend(): HearingBackend | null {
  if (found) return found;
  found = pickHearingBackend({
    os: Platform.OS,
    androidModule: (NativeModules as Record<string, unknown>).HearingModule ?? null,
    androidListen: (event, listener) => DeviceEventEmitter.addListener(event, listener),
    loadIosModule: () => requireOptionalNativeModule('DostHearing'),
  });
  return found;
}
