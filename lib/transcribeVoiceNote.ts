import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import NetInfo from '@react-native-community/netinfo';
import { ensureAnonymousSession } from './session';
import { t as translate } from './i18n';
import { supabase } from './supabase';

const gentleError = () => translate('errors.transcribeUnclear');
const silenceError = () => translate('errors.silence');
const offlineError = () => translate('errors.offline');
const sessionError = () => translate('errors.connect');
const sessionDisabledError = () => translate('errors.connectDisabled');

export type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; message: string };

/** Whisper sometimes returns punctuation-only (or whitespace) for near-silence. */
export function isBlankOrSilentTranscript(text: string): boolean {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return true;
  const stripped = trimmed.replace(/[\s./\\,;:!?'"…\-–—·•[\]()]+/g, '');
  return stripped.length === 0;
}

function statusFromInvoke(
  error: unknown,
  response?: { status?: number } | null,
): number | undefined {
  if (typeof response?.status === 'number') return response.status;
  if (
    error &&
    typeof error === 'object' &&
    'context' in error &&
    error.context &&
    typeof (error.context as { status?: unknown }).status === 'number'
  ) {
    return (error.context as { status: number }).status;
  }
  return undefined;
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof FunctionsFetchError ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'FunctionsFetchError')
  );
}

function messageForStatus(
  status: number | undefined,
  isNetwork: boolean,
): string {
  if (isNetwork) return offlineError();
  if (status === 401) return sessionError();
  if (status === 400) {
    return translate('errors.recordingTooShort');
  }
  return gentleError();
}

async function assertOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    // If NetInfo fails, still attempt the request.
    return true;
  }
}

/**
 * Upload a local M4A (or similar) recording URI to Whisper via edge function.
 * React Native FormData file shape — do not JSON-stringify.
 */
export async function transcribeVoiceNote(
  uri: string,
): Promise<TranscribeResult> {
  const trimmed = typeof uri === 'string' ? uri.trim() : '';
  if (!trimmed) {
    return { ok: false, message: gentleError() };
  }

  const online = await assertOnline();
  if (!online) {
    return { ok: false, message: offlineError() };
  }

  const session = await ensureAnonymousSession();
  if (!session.ok) {
    return {
      ok: false,
      message:
        session.kind === 'anonymous_disabled'
          ? sessionDisabledError()
          : sessionError(),
    };
  }

  const formData = new FormData();
  formData.append('file', {
    uri: trimmed,
    name: 'voice-note.m4a',
    type: 'audio/mp4',
  } as unknown as Blob);

  try {
    const { data, error, response } = await supabase.functions.invoke<{
      transcript?: unknown;
      error?: unknown;
    }>('transcribe-voice-note', {
      body: formData,
    });

    if (error) {
      const status = statusFromInvoke(error, response);
      const network = isNetworkError(error);
      if (
        error instanceof FunctionsHttpError ||
        (error as { name?: string })?.name === 'FunctionsHttpError'
      ) {
        return { ok: false, message: messageForStatus(status, network) };
      }
      return { ok: false, message: messageForStatus(status, network) };
    }

    const transcript =
      typeof data?.transcript === 'string' ? data.transcript.trim() : '';
    if (isBlankOrSilentTranscript(transcript)) {
      return { ok: false, message: silenceError() };
    }

    return { ok: true, transcript };
  } catch (caught) {
    if (caught instanceof FunctionsHttpError) {
      return { ok: false, message: gentleError() };
    }
    if (isNetworkError(caught)) {
      return { ok: false, message: offlineError() };
    }
    return { ok: false, message: gentleError() };
  }
}
