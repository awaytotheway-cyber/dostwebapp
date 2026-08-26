import { FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';

const MAX_MESSAGE_LEN = 2000;

const GENTLE_ERROR = "Something's off on my end. Try again in a moment.";
const SLOW_DOWN = "Let's slow down together — take a breath.";

export type StoredChatRow = {
  id: string;
  message: string;
  role: 'user' | 'assistant';
  created_at: string;
};

export type ChatSendResult =
  | { ok: true; reply: string }
  | { ok: false; message: string };

function messageForStatus(status: number | undefined, isNetwork: boolean): string {
  if (status === 429) return SLOW_DOWN;
  if (isNetwork) return GENTLE_ERROR;
  return GENTLE_ERROR;
}

export async function sendChatMessage(raw: unknown): Promise<ChatSendResult> {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Invalid message.' };
  }

  const text = raw.trim();
  if (!text || text.length > MAX_MESSAGE_LEN) {
    return { ok: false, message: 'Invalid message.' };
  }

  try {
    const { data, error, response } = await supabase.functions.invoke<{ reply?: unknown }>(
      'chat',
      { body: { message: text } },
    );

    if (error) {
      const contextStatus =
        error &&
        typeof error === 'object' &&
        'context' in error &&
        error.context &&
        typeof (error.context as { status?: unknown }).status === 'number'
          ? (error.context as { status: number }).status
          : undefined;
      const status =
        typeof response?.status === 'number' ? response.status : contextStatus;
      const isNetwork =
        error instanceof FunctionsFetchError ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: string }).name === 'FunctionsFetchError');
      return { ok: false, message: messageForStatus(status, isNetwork) };
    }

    const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';
    if (!reply) {
      return { ok: false, message: GENTLE_ERROR };
    }

    return { ok: true, reply };
  } catch {
    return { ok: false, message: GENTLE_ERROR };
  }
}

export async function loadChatMessages(): Promise<StoredChatRow[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, content, role, created_at')
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) {
    return [];
  }

  const rows: StoredChatRow[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id : '';
    const message = typeof row.content === 'string' ? row.content : '';
    const role = row.role === 'user' || row.role === 'assistant' ? row.role : null;
    const created_at = typeof row.created_at === 'string' ? row.created_at : '';
    if (!id || !message || !role || !created_at) continue;
    rows.push({ id, message, role, created_at });
  }
  return rows;
}
