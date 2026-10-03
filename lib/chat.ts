import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { recordApiError } from './diagnostics';
import type { ConversationStage } from './emotionalStates';
import { ensureAnonymousSession } from './session';
import { getAppLanguage, t as translate } from './i18n';
import { supabase } from './supabase';

const MAX_MESSAGE_LEN = 2000;

const gentleError = () => translate('errors.gentle');
const slowDown = () => translate('errors.slowDown');
const sessionError = () => translate('errors.connect');
const sessionDisabledError = () => translate('errors.connectDisabled');

export type StoredChatRow = {
  id: string;
  message: string;
  role: 'user' | 'assistant';
  created_at: string;
};

export type ChatTurnMetadata = {
  suggested_emotions: string[];
  suggested_needs: string[];
  conversation_stage: ConversationStage;
};

export type ChatSendResult =
  | ({ ok: true; reply: string } & ChatTurnMetadata)
  | { ok: false; message: string };

const CONVERSATION_STAGES = new Set<ConversationStage>([
  'meeting',
  'naming_emotion',
  'naming_need',
  'exploring_origin',
  'surfacing_myth',
  'challenging_belief',
  'integration',
  'closed',
]);

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function parseConversationStage(value: unknown): ConversationStage {
  if (typeof value === 'string' && CONVERSATION_STAGES.has(value as ConversationStage)) {
    return value as ConversationStage;
  }
  return 'meeting';
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

const offlineError = () => translate('errors.offline');

function messageForStatus(status: number | undefined, isNetwork: boolean): string {
  if (status === 429) return slowDown();
  if (status === 401) {
    return sessionError();
  }
  if (isNetwork) return offlineError();
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

async function parseInvokeFailure(
  error: unknown,
  response?: { status?: number } | null,
): Promise<{
  status: number | undefined;
  isNetwork: boolean;
  errorName: string;
  isHttp: boolean;
  serverError?: string;
  step?: string;
  pgCode?: string;
}> {
  const status = statusFromInvoke(error, response);
  const isNetwork = isNetworkError(error);
  const errorName =
    error instanceof Error
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : 'unknown';
  const isHttp =
    error instanceof FunctionsHttpError ||
    (error as { name?: string })?.name === 'FunctionsHttpError';

  let serverError: string | undefined;
  let step: string | undefined;
  let pgCode: string | undefined;
  if (error instanceof FunctionsHttpError && error.context) {
    try {
      const body = (await error.context.clone().json()) as {
        error?: unknown;
        step?: unknown;
        code?: unknown;
      };
      if (typeof body?.error === 'string' && body.error.trim()) {
        serverError = body.error.trim().slice(0, 200);
      }
      if (typeof body?.step === 'string' && body.step.trim()) {
        step = body.step.trim().slice(0, 40);
      }
      if (typeof body?.code === 'string' && body.code.trim()) {
        pgCode = body.code.trim().slice(0, 32);
      }
    } catch {
      // Response body not JSON — ignore.
    }
  }

  return { status, isNetwork, errorName, isHttp, serverError, step, pgCode };
}

/** Prefer server-provided copy; hide raw SDK / HTTP noise. */
function userFacingChatError(
  status: number | undefined,
  isNetwork: boolean,
  serverError?: string,
): string {
  const fromServer = serverError?.trim();
  if (
    fromServer &&
    getAppLanguage() === 'en' &&
    !/\b500\b|\b502\b|\b503\b|non-2xx|FunctionsHttp|Edge Function/i.test(fromServer)
  ) {
    return fromServer.slice(0, 280);
  }
  return messageForStatus(status, isNetwork);
}

/** Never surface raw HTTP codes like "500" or FunctionsHttpError text to the user. */
function sanitizeUserFacingMessage(raw: unknown): string {
  if (typeof raw !== 'string') return gentleError();
  const trimmed = raw.trim();
  if (!trimmed) return gentleError();
  if (/\b500\b|\b502\b|\b503\b|non-2xx|FunctionsHttp|Edge Function/i.test(trimmed)) {
    return gentleError();
  }
  if (
    trimmed === slowDown() ||
    trimmed === gentleError() ||
    trimmed === offlineError()
  ) {
    return trimmed;
  }
  if (trimmed.toLowerCase().includes('slow down')) return slowDown();
  return gentleError();
}

export function formatChatErrorForUi(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return gentleError();
  if (/\b500\b|\b502\b|\b503\b|non-2xx|FunctionsHttp|Edge Function/i.test(trimmed)) {
    return gentleError();
  }
  return trimmed;
}

export async function sendChatMessage(
  raw: unknown,
  options?: {
    emotionalState?: string | null;
    selected_emotion?: string | null;
    selected_need?: string | null;
  },
): Promise<ChatSendResult> {
  if (typeof raw !== 'string') {
    return { ok: false, message: translate('errors.invalidMessage') };
  }

  const text = raw.trim();
  if (!text || text.length > MAX_MESSAGE_LEN) {
    return { ok: false, message: translate('errors.invalidMessage') };
  }

  const body: {
    message: string;
    emotional_state?: string;
    selected_emotion?: string;
    selected_need?: string;
  } = { message: text };
  const emotion =
    typeof options?.emotionalState === 'string'
      ? options.emotionalState.trim()
      : '';
  if (emotion) {
    body.emotional_state = emotion;
  }
  const selectedEmotion =
    typeof options?.selected_emotion === 'string'
      ? options.selected_emotion.trim()
      : '';
  if (selectedEmotion) {
    body.selected_emotion = selectedEmotion;
  }
  const selectedNeed =
    typeof options?.selected_need === 'string'
      ? options.selected_need.trim()
      : '';
  if (selectedNeed) {
    body.selected_need = selectedNeed;
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

  try {
    const { data, error, response } = await supabase.functions.invoke<{
      reply?: unknown;
      suggested_emotions?: unknown;
      suggested_needs?: unknown;
      conversation_stage?: unknown;
    }>(
      'chat',
      { body },
    );

    if (error) {
      const { status, isNetwork, errorName, isHttp, serverError, step, pgCode } =
        await parseInvokeFailure(error, response);
      const errorCode = isNetwork
        ? 'network'
        : isHttp
          ? `http-${status ?? 'unknown'}`
          : `invoke-${errorName}`;

      await recordApiError({
        source: 'chat',
        code: errorCode,
        httpStatus: status,
        serverError,
        step,
        errorName,
        detail: pgCode ? `pg:${pgCode}` : undefined,
      });

      if (isHttp) {
        return {
          ok: false,
          message: userFacingChatError(status, isNetwork, serverError),
        };
      }
      return {
        ok: false,
        message: sanitizeUserFacingMessage(
          userFacingChatError(status, isNetwork, serverError),
        ),
      };
    }

    const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';
    if (!reply) {
      await recordApiError({
        source: 'chat',
        code: 'empty-reply',
        detail: 'chat returned 200 but reply field empty',
      });
      return { ok: false, message: gentleError() };
    }

    return {
      ok: true,
      reply,
      suggested_emotions: parseStringArray(data?.suggested_emotions),
      suggested_needs: parseStringArray(data?.suggested_needs),
      conversation_stage: parseConversationStage(data?.conversation_stage),
    };
  } catch (caught) {
    const caughtName =
      caught instanceof Error
        ? caught.name
        : typeof caught === 'object' && caught !== null && 'name' in caught
          ? String((caught as { name?: unknown }).name)
          : 'unknown';
    await recordApiError({
      source: 'chat',
      code: caught instanceof FunctionsHttpError ? 'http-catch' : `catch-${caughtName}`,
      errorName: caughtName,
    });
    return { ok: false, message: gentleError() };
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
