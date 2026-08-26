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

export async function ensureAnonymousSession(): Promise<SessionResult> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return { ok: false, kind: 'other' };
  }
  if (data.session) {
    return { ok: true };
  }

  const { error } = await supabase.auth.signInAnonymously();
  if (!error) {
    return { ok: true };
  }

  return {
    ok: false,
    kind: isAnonymousDisabled(error) ? 'anonymous_disabled' : 'other',
  };
}
