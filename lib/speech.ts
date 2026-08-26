import Constants, { ExecutionEnvironment } from 'expo-constants';

const MIC_RATIONALE =
  'DOST uses your device to convert speech to text. Nothing is recorded or stored.';

export const SPEECH_UNAVAILABLE_TITLE = 'Voice needs a one-time install';
export const SPEECH_UNAVAILABLE_MESSAGE =
  'The Expo Go app cannot convert speech to text. Chat still works if you type. To use the mic, install a custom DOST app (Dev Client) — about 15 minutes. Your notes from this step explain how.';

export const MIC_PERMISSION_DENIED =
  'Microphone permission is off. You can type instead, or turn it on in your phone settings.';

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

export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
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
  if (isExpoGo()) return SPEECH_UNAVAILABLE_MESSAGE;
  if (!mod) return SPEECH_UNAVAILABLE_MESSAGE;
  try {
    if (typeof mod.isRecognitionAvailable === 'function' && !mod.isRecognitionAvailable()) {
      return 'Speech-to-text is not available on this device. You can still type.';
    }
  } catch {
    return SPEECH_UNAVAILABLE_MESSAGE;
  }
  return null;
}

export async function requestMicPermission(
  mod: SpeechNativeModule,
): Promise<{ granted: boolean; denied: boolean }> {
  const result = await mod.requestPermissionsAsync();
  return { granted: Boolean(result.granted), denied: !result.granted };
}

export function startDictation(mod: SpeechNativeModule): void {
  mod.start({
    lang: 'en-IN',
    interimResults: true,
    maxAlternatives: 1,
    continuous: true,
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
      if (event.error === 'aborted' || event.error === 'no-speech') {
        handlers.onEnd?.();
        return;
      }
      handlers.onError?.(event.message || 'Could not hear that. Try again, or type.');
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

export { MIC_RATIONALE };
