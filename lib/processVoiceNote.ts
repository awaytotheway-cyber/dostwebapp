import NetInfo from '@react-native-community/netinfo';
import { sendChatMessage } from './chat';
import { ensureAnonymousSession } from './session';
import { supabase } from './supabase';
import { isBlankOrSilentTranscript } from './transcribeVoiceNote';

const SILENCE_ERROR =
  "I didn't catch any words. Hold a little longer and speak when you're ready.";
const OFFLINE_ERROR =
  "You're offline right now. Connect and try again.";
const SESSION_ERROR =
  "We couldn't connect right now. Check your internet and try again.";
const SESSION_DISABLED_ERROR =
  "We couldn't connect right now. If this keeps happening, the app may need a moment — try again in a few minutes.";
const SAVE_ERROR =
  "Couldn't save that note. Try again when you're ready.";

async function assertOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    return true;
  }
}

export type VoiceNoteRecord = {
  id: string;
  duration_seconds: number;
  transcript: string;
  dost_response: string | null;
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
  audio_storage_path: string | null;
  created_at: string;
};

export type ProcessVoiceNoteResult =
  | { ok: true; note: VoiceNoteRecord }
  | { ok: false; message: string };

export type ProcessVoiceNoteProgress =
  | 'reflecting'
  | 'sensing'
  | 'saving';

type EmotionFields = {
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
};

function createId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function asStringArray(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const token = item.trim().toLowerCase();
    if (!token || out.includes(token)) continue;
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

function mapEmotionRow(row: Record<string, unknown> | null): EmotionFields {
  if (!row) {
    return {
      primary_emotion: null,
      secondary_emotions: null,
      underlying_need: null,
    };
  }

  const primaries = asStringArray(row.primary_emotions, 2);
  const legacyPrimary =
    typeof row.primary_emotion === 'string' ? row.primary_emotion.trim() : '';
  const primary = primaries[0] || legacyPrimary || null;

  const secondary = asStringArray(row.secondary_emotions, 3).filter(
    (token) => token !== primary,
  );

  const needs = asStringArray(row.needs, 3);
  const legacyNeed =
    typeof row.underlying_need === 'string' ? row.underlying_need.trim() : '';
  const need = needs[0] || legacyNeed || null;

  return {
    primary_emotion: primary,
    secondary_emotions: secondary.length > 0 ? secondary : null,
    underlying_need: need,
  };
}

async function findLatestUserMessageId(
  userId: string,
  transcript: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'user')
    .eq('content', transcript)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || typeof data.id !== 'string') return null;
  return data.id;
}

async function loadEmotionsForMessage(
  messageId: string,
): Promise<EmotionFields | null> {
  const { data, error } = await supabase
    .from('message_emotions')
    .select(
      'primary_emotion, primary_emotions, secondary_emotions, underlying_need, needs',
    )
    .eq('message_id', messageId)
    .maybeSingle();

  if (error || !data || typeof data !== 'object') return null;
  return mapEmotionRow(data as Record<string, unknown>);
}

/**
 * extract-emotions requires an owned conversations row. Chat creates that row
 * (service role) and usually extracts before the reply. If the row is missing
 * (timeout), invoke extract-emotions directly for voice_notes labels.
 */
async function ensureEmotions(
  userId: string,
  messageId: string,
  transcript: string,
): Promise<EmotionFields> {
  const existing = await loadEmotionsForMessage(messageId);
  if (existing?.primary_emotion || existing?.underlying_need) {
    return existing;
  }

  try {
    const { data, error } = await supabase.functions.invoke<
      Record<string, unknown>
    >('extract-emotions', {
      body: {
        message_id: messageId,
        message_text: transcript,
        user_id: userId,
      },
    });

    if (!error && data && typeof data === 'object') {
      return mapEmotionRow(data);
    }
  } catch {
    // Labels are optional for saving the note.
  }

  const retried = await loadEmotionsForMessage(messageId);
  return (
    retried ?? {
      primary_emotion: null,
      secondary_emotions: null,
      underlying_need: null,
    }
  );
}

async function uploadAudioOptional(
  userId: string,
  voiceNoteId: string,
  audioUri: string,
): Promise<string | null> {
  const path = `${userId}/${voiceNoteId}.m4a`;
  try {
    const response = await fetch(audioUri);
    if (!response.ok) return null;
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('voice-notes-audio')
      .upload(path, blob, {
        contentType: 'audio/mp4',
        upsert: false,
      });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * After Whisper transcript: get a DOST reflection (via existing chat edge —
 * which awaits extract-emotions server-side), resolve emotion labels, optionally
 * upload audio, and insert into voice_notes.
 */
export async function processVoiceNoteAfterTranscript(opts: {
  transcript: string;
  audioUri: string;
  durationMs: number;
  onProgress?: (step: ProcessVoiceNoteProgress) => void;
}): Promise<ProcessVoiceNoteResult> {
  const transcript =
    typeof opts.transcript === 'string' ? opts.transcript.trim() : '';
  if (isBlankOrSilentTranscript(transcript)) {
    return { ok: false, message: SILENCE_ERROR };
  }

  const online = await assertOnline();
  if (!online) {
    return { ok: false, message: OFFLINE_ERROR };
  }

  const session = await ensureAnonymousSession();
  if (!session.ok) {
    return {
      ok: false,
      message:
        session.kind === 'anonymous_disabled'
          ? SESSION_DISABLED_ERROR
          : SESSION_ERROR,
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: SESSION_ERROR };
  }

  opts.onProgress?.('reflecting');

  // Lightest valid chat path: one-shot sendChatMessage (no client conversation_id).
  // Chat inserts the user turn, awaits extract-emotions, then returns the reply.
  const chat = await sendChatMessage(transcript);
  if (!chat.ok) {
    const stillOnline = await assertOnline();
    if (!stillOnline) {
      return { ok: false, message: OFFLINE_ERROR };
    }
    return { ok: false, message: chat.message };
  }

  opts.onProgress?.('sensing');

  let emotions: EmotionFields = {
    primary_emotion: null,
    secondary_emotions: null,
    underlying_need: null,
  };

  const messageId = await findLatestUserMessageId(userId, transcript);
  if (messageId) {
    emotions = await ensureEmotions(userId, messageId, transcript);
  }

  opts.onProgress?.('saving');

  const voiceNoteId = createId();
  const audioPath = await uploadAudioOptional(
    userId,
    voiceNoteId,
    opts.audioUri,
  );

  const durationSeconds = Math.max(1, Math.round(opts.durationMs / 1000));
  const row = {
    id: voiceNoteId,
    user_id: userId,
    duration_seconds: durationSeconds,
    transcript,
    dost_response: chat.reply,
    primary_emotion: emotions.primary_emotion,
    secondary_emotions: emotions.secondary_emotions,
    underlying_need: emotions.underlying_need,
    audio_storage_path: audioPath,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('voice_notes')
    .insert(row)
    .select(
      'id, duration_seconds, transcript, dost_response, primary_emotion, secondary_emotions, underlying_need, audio_storage_path, created_at',
    )
    .single();

  if (insertError || !inserted || typeof inserted !== 'object') {
    return { ok: false, message: SAVE_ERROR };
  }

  const note = inserted as VoiceNoteRecord;
  if (typeof note.id !== 'string' || typeof note.transcript !== 'string') {
    return { ok: false, message: SAVE_ERROR };
  }

  return { ok: true, note };
}

export async function loadVoiceNoteById(
  id: string,
): Promise<VoiceNoteRecord | null> {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('voice_notes')
    .select(
      'id, duration_seconds, transcript, dost_response, primary_emotion, secondary_emotions, underlying_need, audio_storage_path, created_at',
    )
    .eq('id', trimmed)
    .maybeSingle();

  if (error || !data || typeof data !== 'object') return null;
  if (typeof data.id !== 'string' || typeof data.transcript !== 'string') {
    return null;
  }
  return data as VoiceNoteRecord;
}

export async function getVoiceNoteAudioUrl(
  storagePath: string,
): Promise<string | null> {
  const path = typeof storagePath === 'string' ? storagePath.trim() : '';
  if (!path) return null;

  try {
    const { data, error } = await supabase.storage
      .from('voice-notes-audio')
      .createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function deleteVoiceNote(opts: {
  id: string;
  audio_storage_path?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = typeof opts.id === 'string' ? opts.id.trim() : '';
  if (!id) {
    return { ok: false, message: "Couldn't delete that note." };
  }

  const audioPath =
    typeof opts.audio_storage_path === 'string'
      ? opts.audio_storage_path.trim()
      : '';

  if (audioPath) {
    try {
      await supabase.storage.from('voice-notes-audio').remove([audioPath]);
    } catch {
      // Row delete still proceeds — orphan audio is preferable to a stuck note.
    }
  }

  const { error } = await supabase.from('voice_notes').delete().eq('id', id);
  if (error) {
    return { ok: false, message: "Couldn't delete that note. Try again." };
  }
  return { ok: true };
}
