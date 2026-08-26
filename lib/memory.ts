import { FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';

const GENTLE_ERROR = "Something's off on my end. Try again in a moment.";

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
        return { ok: false, message: 'Too many refreshes. Please wait a bit.' };
      }
      if (status === 401) {
        return {
          ok: false,
          message: "Couldn't verify your session. Close the app and open it again.",
        };
      }
      return { ok: false, message: isNetwork ? GENTLE_ERROR : GENTLE_ERROR };
    }

    const status = data?.status === 'skipped' ? 'skipped' : 'ok';
    return { ok: true, status };
  } catch {
    return { ok: false, message: GENTLE_ERROR };
  }
}

export async function updateUserMemory(): Promise<void> {
  try {
    await refreshUserMemory();
  } catch {
    // Background refresh must never crash the app.
  }
}
