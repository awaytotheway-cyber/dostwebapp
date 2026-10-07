import { NativeModules, Platform } from 'react-native';

/**
 * JavaScript side of the native listening service (plugins/listening).
 * JavaScript starts and stops sessions and reads counters; audio never
 * passes through here.
 */

export type ListenPolicy = 'any_sound';

export type ListenStatus = {
  running: boolean;
  /** Set while the last clip and log lines are being written. */
  stopping?: boolean;
  sessionId?: string | null;
  startedAt?: number;
  policy?: ListenPolicy;
  listenedMs?: number;
  speechMsSaved?: number;
  silenceDroppedMs?: number;
  tooShortDroppedMs?: number;
  micSilencedMs?: number;
  segmentsSaved?: number;
  queueDroppedFrames?: number;
  captureGapMs?: number;
  inClip?: boolean;
  levelDb?: number;
  noiseFloorDb?: number;
  micSilenced?: boolean;
  lastStopReason?: string | null;
};

export type ModelCheckResult = {
  ok?: boolean;
  ranAt?: number;
  device?: string;
  android?: string;
  soc?: string;
  screenOn?: boolean;
  screenOnAtEnd?: boolean;
  vadLoadMs?: number;
  vadMsPerFrame?: number;
  speakerDim?: number;
  speakerLoadMs_2t?: number;
  speakerLoadMs_1t?: number;
  speakerMsPer2sWindow_2t?: number;
  speakerMsPer2sWindow_1t?: number;
  rssMbBefore?: number;
  rssMbAfter?: number;
  peakRssMb?: number;
};

type ListenNativeModule = {
  start: (policy: ListenPolicy) => Promise<'started' | 'already_running'>;
  stop: () => Promise<boolean>;
  getStatus: () => Promise<ListenStatus>;
  runModelCheck: (delayMs: number) => Promise<ModelCheckResult>;
  getModelCheck: () => Promise<ModelCheckResult | null>;
};

function native(): ListenNativeModule | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.ListenModule as ListenNativeModule | undefined) ?? null;
}

export function isListeningAvailable(): boolean {
  return native() !== null;
}

export async function startListening(policy: ListenPolicy = 'any_sound') {
  const mod = native();
  if (!mod) throw new Error('Listening is not available in this build.');
  return mod.start(policy);
}

export async function stopListening(): Promise<void> {
  await native()?.stop();
}

export async function getListenStatus(): Promise<ListenStatus> {
  const mod = native();
  if (!mod) return { running: false };
  return mod.getStatus();
}

export async function runModelCheck(delayMs: number): Promise<ModelCheckResult> {
  const mod = native();
  if (!mod) throw new Error('Listening is not available in this build.');
  return mod.runModelCheck(delayMs);
}

export async function getLastModelCheck(): Promise<ModelCheckResult | null> {
  return (await native()?.getModelCheck()) ?? null;
}
