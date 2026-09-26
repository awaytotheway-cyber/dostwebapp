import {
  DeviceEventEmitter,
  EmitterSubscription,
  NativeModules,
  Platform,
} from 'react-native';

/**
 * JS-side interface to the native HearingModule / HearingService.
 *
 * Contract mirrors the events emitted by HearingService.kt. See that
 * file for the source of truth on shapes and units.
 */

type HearingNativeModule = {
  startSession: () => Promise<boolean>;
  stopSession: () => Promise<boolean>;
  isSessionActive: () => Promise<boolean>;
};

function getNativeModule(): HearingNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as any).HearingModule;
  if (!mod) return null;
  return mod as HearingNativeModule;
}

export type HearingSessionStarted = {
  startedAt: number;
  sampleRate: number;
};

export type HearingSessionStopped = {
  startedAt: number;
  endedAt: number;
  totalMs: number;
  speechMs: number;
  segmentsEmitted: number;
  userRequested: boolean;
};

export type HearingTick = {
  speech: boolean;
  rms: number;
  noiseFloor: number;
  calibrating: boolean;
  totalMs: number;
  speechMs: number;
};

export type HearingStartError = {
  reason: string;
};

export type HearingSpeechSegment = {
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  capturedAt: number;
};

type RawSegmentPayload = {
  pcmBase64: string;
  sampleRate: number;
  durationMs: number;
  capturedAt: number;
};

export type HearingEventHandlers = {
  onStarted?: (e: HearingSessionStarted) => void;
  onStopped?: (e: HearingSessionStopped) => void;
  onTick?: (e: HearingTick) => void;
  onSegment?: (e: HearingSpeechSegment) => void;
  onStartError?: (e: HearingStartError) => void;
};

export function isHearingAvailable(): boolean {
  return getNativeModule() !== null;
}

export async function startSession(): Promise<void> {
  const mod = getNativeModule();
  if (!mod) throw new Error('HearingModule is not available on this platform');
  await mod.startSession();
}

export async function stopSession(): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  await mod.stopSession();
}

export async function isSessionActive(): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  return mod.isSessionActive();
}

/**
 * Subscribe to hearing events. Returns a function that removes every
 * subscription — call it on unmount.
 */
export function subscribeHearing(handlers: HearingEventHandlers): () => void {
  if (Platform.OS !== 'android') return () => {};

  const subs: EmitterSubscription[] = [];

  if (handlers.onStarted) {
    subs.push(
      DeviceEventEmitter.addListener('HearingSessionStarted', handlers.onStarted),
    );
  }
  if (handlers.onStopped) {
    subs.push(
      DeviceEventEmitter.addListener('HearingSessionStopped', handlers.onStopped),
    );
  }
  if (handlers.onTick) {
    subs.push(DeviceEventEmitter.addListener('HearingTick', handlers.onTick));
  }
  if (handlers.onStartError) {
    subs.push(
      DeviceEventEmitter.addListener('HearingStartError', handlers.onStartError),
    );
  }
  if (handlers.onSegment) {
    const onSegment = handlers.onSegment;
    subs.push(
      DeviceEventEmitter.addListener(
        'HearingSpeechSegment',
        (raw: RawSegmentPayload) => {
          const pcm = decodePcm16Base64ToFloat32(raw.pcmBase64);
          onSegment({
            pcm,
            sampleRate: raw.sampleRate,
            durationMs: raw.durationMs,
            capturedAt: raw.capturedAt,
          });
        },
      ),
    );
  }

  return () => {
    for (const s of subs) s.remove();
  };
}

/**
 * Decode a base64-encoded little-endian Int16 PCM buffer into a
 * Float32Array normalized to [-1, 1]. React Native provides `global.atob`
 * on modern runtimes; a manual byte-by-byte fallback covers older ones.
 */
function decodePcm16Base64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const sampleCount = bytes.length >> 1;
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let v = (hi << 8) | lo;
    if (v & 0x8000) v = v - 0x10000; // sign-extend Int16
    out[i] = v / 32768;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64) as string;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return manualBase64Decode(b64);
}

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: number[] = (() => {
  const t = new Array<number>(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

function manualBase64Decode(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = ((clean.length * 3) >> 2) - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = B64_LOOKUP[clean.charCodeAt(i + 3)];
    if (o < outLen) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < outLen) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (o < outLen) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}
