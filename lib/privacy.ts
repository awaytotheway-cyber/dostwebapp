import { FunctionsFetchError } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { t as translate } from './i18n';
import { supabase } from './supabase';

const gentleError = () => translate('errors.gentle');

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
  if (status === 401) return translate('errors.verifySession');
  if (status === 429 && kind === 'export') {
    return translate('errors.tooManyExports');
  }
  if (status === 400 && kind === 'delete') return translate('errors.typeDelete');
  if (isNetwork) return gentleError();
  // Never show raw HTTP codes (500) or FunctionsHttpError text.
  return gentleError();
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
      return { ok: false, message: gentleError() };
    }

    let json: string;
    try {
      json = JSON.stringify(data, null, 2);
    } catch {
      return { ok: false, message: gentleError() };
    }

    const dir = FileSystem.cacheDirectory;
    if (!dir) {
      return { ok: false, message: translate('errors.exportSaveFailed') };
    }

    const name = `dost-export-${new Date().toISOString().slice(0, 10)}.json`;
    const uri = `${dir}${name}`;
    try {
      await FileSystem.writeAsStringAsync(uri, json);
    } catch {
      return { ok: false, message: translate('errors.exportSaveFailed') };
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, message: translate('errors.sharingUnavailable') };
    }

    try {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: translate('errors.exportDialogTitle'),
        UTI: 'public.json',
      });
    } catch (shareError) {
      const msg = shareError instanceof Error ? shareError.message : '';
      if (/cancel/i.test(msg)) return { ok: true };
      return { ok: false, message: translate('errors.exportShareFailed') };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: gentleError() };
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
    return { ok: false, message: gentleError() };
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
    return { ok: false, message: gentleError() };
  }
}
