import * as SQLite from 'expo-sqlite';

export type DeliveryStatus = 'pending' | 'failed' | 'sent';

export type LocalMessage = {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  synced: number;
  delivery_status: DeliveryStatus;
  is_temporary: number;
};

export type LocalDb = SQLite.SQLiteDatabase;

const openDbs = new Map<string, LocalDb>();

function dbNameForUser(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `dost_${safe}.db`;
}

async function ensureSchema(db: LocalDb): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 1,
      delivery_status TEXT NOT NULL DEFAULT 'sent',
      is_temporary INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_created
      ON conversations (user_id, created_at DESC);
  `);

  const columns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(conversations)',
  );
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('delivery_status')) {
    await db.execAsync(`
      ALTER TABLE conversations
        ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'sent';
      UPDATE conversations
        SET delivery_status = CASE WHEN synced = 0 THEN 'failed' ELSE 'sent' END;
    `);
  }
  if (!names.has('is_temporary')) {
    await db.execAsync(`
      ALTER TABLE conversations
        ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0;
      UPDATE conversations SET is_temporary = 1 WHERE synced = 0;
    `);
  }

  // No request is still in flight when a user database is opened afresh.
  await db.runAsync(
    `UPDATE conversations
     SET delivery_status = 'failed'
     WHERE synced = 0 AND delivery_status = 'pending'`,
  );
}

export async function getDb(userId: string): Promise<LocalDb> {
  const existing = openDbs.get(userId);
  if (existing) return existing;

  const db = await SQLite.openDatabaseAsync(dbNameForUser(userId));
  await ensureSchema(db);
  openDbs.set(userId, db);
  return db;
}

export async function closeDb(userId: string): Promise<void> {
  const db = openDbs.get(userId);
  if (!db) return;
  openDbs.delete(userId);
  try {
    await db.closeAsync();
  } catch {
    // Already closed.
  }
}

export async function insertMessage(
  db: LocalDb,
  message: {
    id: string;
    user_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
    synced?: number;
    delivery_status?: DeliveryStatus;
    is_temporary?: number;
  },
): Promise<void> {
  const synced = typeof message.synced === 'number' ? message.synced : 1;
  const deliveryStatus = message.delivery_status ?? (synced === 1 ? 'sent' : 'failed');
  const isTemporary =
    typeof message.is_temporary === 'number' ? message.is_temporary : 0;
  await db.runAsync(
    `INSERT OR REPLACE INTO conversations
       (id, user_id, role, content, created_at, synced, delivery_status, is_temporary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.user_id,
      message.role,
      message.content,
      message.created_at,
      synced,
      deliveryStatus,
      isTemporary,
    ],
  );
}

export async function updateMessageDelivery(
  db: LocalDb,
  userId: string,
  id: string,
  status: DeliveryStatus,
): Promise<void> {
  await db.runAsync(
    `UPDATE conversations
     SET synced = ?, delivery_status = ?
     WHERE user_id = ? AND id = ?`,
    [status === 'sent' ? 1 : 0, status, userId, id],
  );
}

export async function getRecentMessages(
  db: LocalDb,
  userId: string,
  limit = 50,
  afterCreatedAt?: string | null,
): Promise<LocalMessage[]> {
  if (afterCreatedAt) {
    const rows = await db.getAllAsync<LocalMessage>(
      `SELECT id, user_id, role, content, created_at, synced,
              delivery_status, is_temporary
       FROM conversations
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, afterCreatedAt, limit],
    );
    return rows.reverse();
  }
  const rows = await db.getAllAsync<LocalMessage>(
    `SELECT id, user_id, role, content, created_at, synced,
            delivery_status, is_temporary
     FROM conversations
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit],
  );
  return rows.reverse();
}

export async function getMessagesBefore(
  db: LocalDb,
  userId: string,
  beforeCreatedAt: string,
  limit = 20,
  afterCreatedAt?: string | null,
): Promise<LocalMessage[]> {
  if (afterCreatedAt) {
    const rows = await db.getAllAsync<LocalMessage>(
      `SELECT id, user_id, role, content, created_at, synced,
              delivery_status, is_temporary
       FROM conversations
       WHERE user_id = ? AND created_at < ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, beforeCreatedAt, afterCreatedAt, limit],
    );
    return rows.reverse();
  }
  const rows = await db.getAllAsync<LocalMessage>(
    `SELECT id, user_id, role, content, created_at, synced,
            delivery_status, is_temporary
     FROM conversations
     WHERE user_id = ? AND created_at < ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, beforeCreatedAt, limit],
  );
  return rows.reverse();
}

export type MessageSearchHit = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

/** Search local message text (user messages preferred for “your chats”). */
export async function searchLocalMessages(
  db: LocalDb,
  userId: string,
  query: string,
  limit = 40,
): Promise<MessageSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const like = `%${trimmed.replace(/[%_]/g, '')}%`;
  const rows = await db.getAllAsync<MessageSearchHit>(
    `SELECT id, role, content, created_at
     FROM conversations
     WHERE user_id = ?
       AND role = 'user'
       AND content LIKE ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, like, limit],
  );
  return rows;
}

export async function clearAllLocalData(db: LocalDb): Promise<void> {
  await db.execAsync('DELETE FROM conversations;');
}

export async function getLastSyncedAt(
  db: LocalDb,
  userId: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ max_created: string | null }>(
    `SELECT MAX(created_at) AS max_created
     FROM conversations
     WHERE user_id = ? AND synced = 1 AND is_temporary = 0`,
    [userId],
  );
  return row?.max_created ?? null;
}

export async function deleteMessageById(db: LocalDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function findTemporaryDuplicate(
  db: LocalDb,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  excludeId: string,
  serverCreatedAt: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM conversations
     WHERE user_id = ?
       AND role = ?
       AND content = ?
       AND id != ?
       AND is_temporary = 1
       AND ABS(julianday(created_at) - julianday(?)) <= (15.0 / 1440.0)
     ORDER BY ABS(julianday(created_at) - julianday(?)) ASC
     LIMIT 1`,
    [userId, role, content, excludeId, serverCreatedAt, serverCreatedAt],
  );
  return row?.id ?? null;
}

export async function purgeUserDatabase(userId: string): Promise<void> {
  await closeDb(userId);
  try {
    await SQLite.deleteDatabaseAsync(dbNameForUser(userId));
  } catch {
    // File may not exist yet.
  }
}
