import { FunctionsFetchError } from '@supabase/supabase-js';
import { t as translate } from './i18n';
import { supabase } from './supabase';

const gentleError = () => translate('errors.gentle');

export type MemoryRefreshResult =
  | { ok: true; status: 'ok' | 'skipped' }
  | { ok: false; message: string };

export async function loadMemorySummary(): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_memory')
    .select('summary')
    .maybeSingle();

  if (error || !data || typeof data !== 'object') return null;
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  return summary || null;
}

export async function refreshUserMemory(): Promise<MemoryRefreshResult> {
  try {
    const { data, error, response } = await supabase.functions.invoke<{ status?: unknown }>(
      'update-memory',
      { body: {} },
    );

    if (error) {
      const status =
        typeof response?.status === 'number'
          ? response.status
          : error &&
              typeof error === 'object' &&
              'context' in error &&
              error.context &&
              typeof (error.context as { status?: unknown }).status === 'number'
            ? (error.context as { status: number }).status
            : undefined;
      const isNetwork =
        error instanceof FunctionsFetchError ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: string }).name === 'FunctionsFetchError');
      if (status === 429) {
        return { ok: false, message: translate('errors.tooManyRefreshes') };
      }
      if (status === 401) {
        return {
          ok: false,
          message: translate('errors.verifySession'),
        };
      }
      return { ok: false, message: isNetwork ? gentleError() : gentleError() };
    }

    const status = data?.status === 'skipped' ? 'skipped' : 'ok';
    return { ok: true, status };
  } catch {
    return { ok: false, message: gentleError() };
  }
}

export async function updateUserMemory(): Promise<void> {
  try {
    await refreshUserMemory();
  } catch {
    // Background refresh must never crash the app.
  }
}
