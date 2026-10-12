import { AuthError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type SessionResult =
  | { ok: true }
  | { ok: false; kind: 'anonymous_disabled' | 'other' };

function isAnonymousDisabled(error: AuthError): boolean {
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  return (
    code === 'anonymous_provider_disabled' ||
    message.includes('anonymous')
  );
}

const STARTUP_REQUEST_TIMEOUT_MS = 8000;

async function withStartupTimeout<T>(request: Promise<T>): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), STARTUP_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function ensureAnonymousSession(): Promise<SessionResult> {
  const sessionResult = await withStartupTimeout(supabase.auth.getSession());
  if (!sessionResult || sessionResult.error) {
    return { ok: false, kind: 'other' };
  }
  if (sessionResult.data.session) {
    return { ok: true };
  }

  const signInResult = await withStartupTimeout(supabase.auth.signInAnonymously());
  if (!signInResult) {
    return { ok: false, kind: 'other' };
  }
  const { error } = signInResult;
  if (!error) {
    return { ok: true };
  }

  return {
    ok: false,
    kind: isAnonymousDisabled(error) ? 'anonymous_disabled' : 'other',
  };
}
