import { FunctionsFetchError } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';

const GENTLE_ERROR = "Something's off on my end. Try again in a moment.";

export type PrivacyResult = { ok: true } | { ok: false; message: string };

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

function messageForStatus(status: number | undefined, isNetwork: boolean, kind: 'export' | 'delete'): string {
  if (status === 401) return "Couldn't verify your session. Close the app and open it again.";
  if (status === 429 && kind === 'export') {
    return 'Too many exports today. You can export up to 3 times per day.';
  }
  if (status === 400 && kind === 'delete') return 'Type DELETE to confirm.';
  if (isNetwork) return GENTLE_ERROR;
  // Never show raw HTTP codes (500) or FunctionsHttpError text.
  return GENTLE_ERROR;
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

export async function exportMyData(): Promise<PrivacyResult> {
  try {
    const { data, error, response } = await supabase.functions.invoke<unknown>(
      'export-data',
      { body: {} },
    );

    if (error) {
      return {
        ok: false,
        message: messageForStatus(statusFromInvoke(error, response), isNetworkError(error), 'export'),
      };
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, message: GENTLE_ERROR };
    }

    let json: string;
    try {
      json = JSON.stringify(data, null, 2);
    } catch {
      return { ok: false, message: GENTLE_ERROR };
    }

    const dir = FileSystem.cacheDirectory;
    if (!dir) {
      return { ok: false, message: 'Could not save the export on this device.' };
    }

    const name = `dost-export-${new Date().toISOString().slice(0, 10)}.json`;
    const uri = `${dir}${name}`;
    try {
      await FileSystem.writeAsStringAsync(uri, json);
    } catch {
      return { ok: false, message: 'Could not save the export on this device.' };
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }

    try {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export my DOST data',
        UTI: 'public.json',
      });
    } catch (shareError) {
      const msg = shareError instanceof Error ? shareError.message : '';
      if (/cancel/i.test(msg)) return { ok: true };
      return { ok: false, message: 'Could not share the export.' };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: GENTLE_ERROR };
  }
}

export async function deleteMyConversations(): Promise<PrivacyResult> {
  try {
    const { error, response } = await supabase.functions.invoke('delete-conversations', {
      body: {},
    });

    if (error) {
      return {
        ok: false,
        message: messageForStatus(statusFromInvoke(error, response), isNetworkError(error), 'delete'),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: GENTLE_ERROR };
  }
}

export async function deleteMyAccount(): Promise<PrivacyResult> {
  try {
    const { error, response } = await supabase.functions.invoke('delete-account', {
      body: { confirm: 'DELETE' },
    });

    if (error) {
      return {
        ok: false,
        message: messageForStatus(statusFromInvoke(error, response), isNetworkError(error), 'delete'),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: GENTLE_ERROR };
  }
}
