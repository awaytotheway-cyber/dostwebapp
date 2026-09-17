import { supabase } from './supabase';
import {
  deleteMessageById,
  findTemporaryDuplicate,
  getLastSyncedAt,
  insertMessage,
  type LocalDb,
  type LocalMessage,
} from './localDb';

export type SyncResult = {
  inserted: LocalMessage[];
};

type ServerRow = {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

function parseServerRow(row: unknown, fallbackUserId: string): ServerRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const user_id =
    typeof r.user_id === 'string' && r.user_id ? r.user_id : fallbackUserId;
  const role = r.role === 'user' || r.role === 'assistant' ? r.role : null;
  const content = typeof r.content === 'string' ? r.content : '';
  const created_at = typeof r.created_at === 'string' ? r.created_at : '';
  if (!id || !role || !content || !created_at) return null;
  return { id, user_id, role, content, created_at };
}

async function upsertServerRow(db: LocalDb, row: ServerRow): Promise<LocalMessage> {
  const dupId = await findTemporaryDuplicate(
    db,
    row.user_id,
    row.role,
    row.content,
    row.id,
    row.created_at,
  );
  if (dupId) {
    await deleteMessageById(db, dupId);
  }

  const message: LocalMessage = {
    ...row,
    synced: 1,
    delivery_status: 'sent',
    is_temporary: 0,
  };
  await insertMessage(db, message);
  return message;
}

export async function syncFromServer(
  userId: string,
  db: LocalDb,
): Promise<SyncResult> {
  try {
    const lastSyncedAt = await getLastSyncedAt(db, userId);
    let query = supabase
      .from('conversations')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (lastSyncedAt) {
      query = query.gt('created_at', lastSyncedAt);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return { inserted: [] };
    }

    const inserted: LocalMessage[] = [];
    for (const raw of data) {
      const row = parseServerRow(raw, userId);
      if (!row) continue;
      const saved = await upsertServerRow(db, row);
      inserted.push(saved);
    }
    return { inserted };
  } catch {
    return { inserted: [] };
  }
}

export async function seedFromServer(
  userId: string,
  db: LocalDb,
  limit = 50,
): Promise<LocalMessage[]> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return [];
    }

    const chronological = [...data].reverse();
    const saved: LocalMessage[] = [];
    for (const raw of chronological) {
      const row = parseServerRow(raw, userId);
      if (!row) continue;
      const message = await upsertServerRow(db, row);
      saved.push(message);
    }
    return saved;
  } catch {
    return [];
  }
}

export async function fetchOlderFromServer(
  userId: string,
  db: LocalDb,
  beforeCreatedAt: string,
  limit = 20,
): Promise<LocalMessage[]> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .lt('created_at', beforeCreatedAt)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return [];
    }

    const chronological = [...data].reverse();
    const saved: LocalMessage[] = [];
    for (const raw of chronological) {
      const row = parseServerRow(raw, userId);
      if (!row) continue;
      const message = await upsertServerRow(db, row);
      saved.push(message);
    }
    return saved;
  } catch {
    return [];
  }
}


export async function reconcileRecentAfterSend(
  userId: string,
  db: LocalDb,
  sinceIso: string,
): Promise<LocalMessage[]> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, user_id, role, content, created_at')
      .eq('user_id', userId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(20);

    if (error || !Array.isArray(data)) {
      return [];
    }

    const saved: LocalMessage[] = [];
    for (const raw of data) {
      const row = parseServerRow(raw, userId);
      if (!row) continue;
      const message = await upsertServerRow(db, row);
      saved.push(message);
    }
    return saved;
  } catch {
    return [];
  }
}
