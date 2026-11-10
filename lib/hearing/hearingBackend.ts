/**
 * Which native listening module this platform has, and how to hear its
 * events.
 *
 * Android: the classic React Native module `HearingModule` (Kotlin, in
 * plugins/hearing-service/kotlin), emitting on DeviceEventEmitter.
 * iOS: the Expo module `DostHearing` (Swift, in
 * plugins/hearing-service/ios), whose module object is itself the event
 * emitter.
 *
 * Both expose the same functions and the same five events, so every
 * caller in lib/hearing/ works against this one shape and never asks
 * which platform it is on.
 *
 * Pure on purpose — it imports nothing, and nativeHearing.ts supplies the
 * real React Native pieces — so the selection rules are testable without
 * a device.
 */

export type HearingEventName =
  | 'HearingSessionStarted'
  | 'HearingSessionStopped'
  | 'HearingSpeechSegment'
  | 'HearingTick'
  | 'HearingStartError';

export type Subscription = { remove: () => void };
export type Listen = (
  event: HearingEventName,
  listener: (payload: any) => void,
) => Subscription;

export type NativeClip = {
  pcmBase64: string;
  sampleRate: number;
  durationMs: number;
};

/** The functions both native modules implement. */
export type HearingNative = {
  startSession: () => Promise<boolean>;
  stopSession: () => Promise<boolean>;
  isSessionActive: () => Promise<boolean>;
  captureEnrollmentClip?: (durationMs: number) => Promise<NativeClip>;
  cancelEnrollmentCapture?: () => Promise<boolean>;
  computeSpeakerEmbedding?: (
    modelPath: string,
    featuresBase64: string,
    frames: number,
  ) => Promise<number[]>;
  releaseSpeakerModel?: () => Promise<boolean>;
  /** iOS only: Android asks through PermissionsAndroid instead. */
  requestMicrophonePermission?: () => Promise<boolean>;
};

export type HearingBackend = {
  platform: 'android' | 'ios';
  module: HearingNative;
  listen: Listen;
};

type IosModule = Partial<HearingNative> & {
  addListener?: (event: string, listener: (payload: any) => void) => Subscription;
};

export type BackendEnv = {
  os: string;
  androidModule?: unknown;
  androidListen?: Listen;
  /** May throw or return null when the binary lacks the module. */
  loadIosModule?: () => unknown;
};

function hasCore(m: unknown): m is HearingNative {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.startSession === 'function' &&
    typeof o.stopSession === 'function' &&
    typeof o.isSessionActive === 'function'
  );
}

/**
 * Null when this platform has no listening support in this binary: web,
 * or an app built before the native module existed. Callers treat null
 * as "not available here" exactly as they used to treat non-Android.
 */
export function pickHearingBackend(env: BackendEnv): HearingBackend | null {
  if (env.os === 'android') {
    if (!hasCore(env.androidModule) || !env.androidListen) return null;
    return { platform: 'android', module: env.androidModule, listen: env.androidListen };
  }

  if (env.os === 'ios') {
    let mod: unknown = null;
    try {
      mod = env.loadIosModule ? env.loadIosModule() : null;
    } catch {
      mod = null;
    }
    if (!hasCore(mod)) return null;
    const ios = mod as IosModule;
    if (typeof ios.addListener !== 'function') return null;
    const addListener = ios.addListener.bind(ios);
    return {
      platform: 'ios',
      module: ios as HearingNative,
      listen: (event, listener) => addListener(event, listener),
    };
  }

  return null;
}
