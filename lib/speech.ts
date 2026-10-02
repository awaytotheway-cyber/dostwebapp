import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getLocaleTag, t } from './i18n';

export const expoGoVoiceMessage = () => t('speech.expoGo');
export const speechUnavailableMessage = () => t('speech.unavailable');
export const micPermissionDenied = () => t('speech.permissionDenied');
export const micBusyMessage = () => t('speech.busy');
export const micStartFail = () => t('speech.startFail');
export const micNoSpeech = () => t('speech.noSpeech');

type PermissionResult = {
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
};

type SpeechResultEvent = {
  isFinal?: boolean;
  results?: Array<{ transcript?: string }>;
};

type SpeechErrorEvent = {
  error?: string;
  message?: string;
};

type SpeechListener = { remove: () => void };

export type SpeechNativeModule = {
  requestPermissionsAsync: () => Promise<PermissionResult>;
  getPermissionsAsync?: () => Promise<PermissionResult>;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
  addListener: (event: string, cb: (event: unknown) => void) => SpeechListener;
  isRecognitionAvailable?: () => boolean;
};

type SpeechPackage = {
  ExpoSpeechRecognitionModule: SpeechNativeModule;
};

export type MicPermissionState =
  | { status: 'granted' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unknown' };

export function isExpoGo(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === 'expo'
  );
}

export function loadSpeechModule(): SpeechNativeModule | null {
  if (isExpoGo()) return null;
  try {
    const loaded = require('expo-speech-recognition') as SpeechPackage;
    return loaded?.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

export function speechUnavailableReason(mod: SpeechNativeModule | null): string | null {
  if (isExpoGo()) return expoGoVoiceMessage();
  if (!mod) return speechUnavailableMessage();
  try {
    if (typeof mod.isRecognitionAvailable === 'function' && !mod.isRecognitionAvailable()) {
      return t('speech.notOnDevice');
    }
  } catch {
    return speechUnavailableMessage();
  }
  return null;
}

export async function getMicPermissionState(
  mod: SpeechNativeModule,
): Promise<MicPermissionState> {
  try {
    if (typeof mod.getPermissionsAsync === 'function') {
      const current = await mod.getPermissionsAsync();
      if (current.granted) return { status: 'granted' };
      return {
        status: 'denied',
        canAskAgain: current.canAskAgain !== false,
      };
    }
  } catch {
    // Fall through to request.
  }
  return { status: 'unknown' };
}

export async function requestMicPermission(
  mod: SpeechNativeModule,
): Promise<{ granted: boolean; denied: boolean; canAskAgain: boolean }> {
  try {
    const result = await mod.requestPermissionsAsync();
    return {
      granted: Boolean(result.granted),
      denied: !result.granted,
      canAskAgain: result.canAskAgain !== false,
    };
  } catch {
    return { granted: false, denied: true, canAskAgain: true };
  }
}

export function startDictation(mod: SpeechNativeModule): void {
  mod.start({
    lang: getLocaleTag(),
    interimResults: true,
    maxAlternatives: 1,
    continuous: false,
    // OS speech APIs only — do not persist microphone audio on disk.
    requiresOnDeviceRecognition: false,
    addsPunctuation: true,
    iosTaskHint: 'dictation',
    recordingOptions: { persist: false },
  });
}

export function stopDictation(mod: SpeechNativeModule): void {
  try {
    mod.stop();
  } catch {
    try {
      mod.abort?.();
    } catch {
      // Native stop can throw if recognition already ended.
    }
  }
}

export function abortDictation(mod: SpeechNativeModule): void {
  try {
    mod.abort?.();
  } catch {
    try {
      mod.stop();
    } catch {
      // Already stopped.
    }
  }
}

function friendlySpeechError(event: SpeechErrorEvent): string | null {
  const code = (event.error ?? '').toLowerCase();
  if (
    code === 'aborted' ||
    code === 'cancelled' ||
    code === 'canceled' ||
    code === 'client'
  ) {
    return null;
  }
  if (code === 'no-speech' || code === 'speech-timeout') {
    return micNoSpeech();
  }
  if (code === 'not-allowed' || code === 'permission-denied' || code === 'audio-capture') {
    return micPermissionDenied();
  }
  if (code === 'network') {
    return t('speech.needsConnection');
  }
  if (code === 'busy' || code === 'already-started') {
    return micBusyMessage();
  }
  const msg = typeof event.message === 'string' ? event.message.trim() : '';
  if (msg && !/\b500\b|exception|stack|native/i.test(msg)) {
    return msg.length > 120 ? micNoSpeech() : msg;
  }
  return micNoSpeech();
}

export function subscribeSpeech(
  mod: SpeechNativeModule,
  handlers: {
    onStart?: () => void;
    onEnd?: () => void;
    onResult?: (transcript: string, isFinal: boolean) => void;
    onError?: (message: string) => void;
  },
): () => void {
  const listeners: SpeechListener[] = [];
  listeners.push(mod.addListener('start', () => handlers.onStart?.()));
  listeners.push(mod.addListener('end', () => handlers.onEnd?.()));
  listeners.push(
    mod.addListener('result', (raw) => {
      const event = raw as SpeechResultEvent;
      const transcript = event.results?.[0]?.transcript?.trim() ?? '';
      if (transcript) handlers.onResult?.(transcript, Boolean(event.isFinal));
    }),
  );
  listeners.push(
    mod.addListener('error', (raw) => {
      const event = raw as SpeechErrorEvent;
      const friendly = friendlySpeechError(event);
      if (friendly === null) {
        handlers.onEnd?.();
        return;
      }
      handlers.onError?.(friendly);
    }),
  );
  return () => {
    for (const listener of listeners) {
      try {
        listener.remove();
      } catch {
        // Listener may already be gone.
      }
    }
  };
}

