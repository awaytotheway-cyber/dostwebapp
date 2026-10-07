import * as FileSystem from 'expo-file-system/legacy';

/**
 * Reads what the native service left in filesDir/voice/:
 *
 *   voice/session_log.jsonl                      one JSON event per line
 *   voice/recordings/YYYY-MM-DD/seg_<session>_<startMs>.m4a
 *
 * Step 7 moves this into SQLite; until then the log is read directly.
 */

export function voiceDir(): string {
  const doc = FileSystem.documentDirectory;
  if (!doc) throw new Error('App storage is unavailable');
  return `${doc}voice/`;
}

export type SavedClip = {
  file: string;
  path: string;
  uri: string;
  startTs: number;
  durationMs: number;
  sizeBytes: number;
  speakerLabel: string;
};

export type SessionSummary = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  /** Why it stopped; 'os_killed' when the log has no end line. */
  reason: string | null;
  policy: string | null;
  trigger: string | null;
  listenedMs: number;
  speechMsSaved: number;
  silenceDroppedMs: number;
  tooShortDroppedMs: number;
  micSilencedMs: number;
  captureGapMs: number;
  queueDroppedFrames: number;
  clips: SavedClip[];
};

type LogEvent = Record<string, unknown> & { t?: string; sessionId?: string; ts?: number };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Parses the session log, newest session first. */
export async function readSessions(runningSessionId?: string | null): Promise<SessionSummary[]> {
  const logUri = `${voiceDir()}session_log.jsonl`;
  const info = await FileSystem.getInfoAsync(logUri);
  if (!info.exists) return [];
  const text = await FileSystem.readAsStringAsync(logUri);

  const sessions = new Map<string, SessionSummary>();
  const get = (e: LogEvent): SessionSummary | null => {
    const id = str(e.sessionId);
    if (!id) return null;
    let s = sessions.get(id);
    if (!s) {
      s = {
        sessionId: id,
        startedAt: num(e.ts),
        endedAt: null,
        reason: null,
        policy: null,
        trigger: null,
        listenedMs: 0,
        speechMsSaved: 0,
        silenceDroppedMs: 0,
        tooShortDroppedMs: 0,
        micSilencedMs: 0,
        captureGapMs: 0,
        queueDroppedFrames: 0,
        clips: [],
      };
      sessions.set(id, s);
    }
    return s;
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: LogEvent;
    try {
      e = JSON.parse(line) as LogEvent;
    } catch {
      continue; // a half-written last line after a crash
    }
    const s = get(e);
    if (!s) continue;
    switch (e.t) {
      case 'session_start':
        s.startedAt = num(e.ts);
        s.policy = str(e.policy);
        s.trigger = str(e.trigger);
        break;
      case 'segment_saved':
      case 'chunk_closed': {
        // chunk_closed: format of the earlier capture phase, still accepted.
        const file = str(e.file) ?? '';
        const path = str(e.path) ?? file;
        s.clips.push({
          file,
          path,
          uri: `${voiceDir()}${path}`,
          startTs: num(e.startTs),
          durationMs: num(e.durationMs),
          sizeBytes: num(e.sizeBytes),
          speakerLabel: str(e.speakerLabel) ?? 'n/a',
        });
        break;
      }
      case 'stats':
        s.listenedMs = num(e.listenedMs);
        s.speechMsSaved = num(e.speechMsSaved);
        s.silenceDroppedMs = num(e.silenceDroppedMs);
        s.tooShortDroppedMs = num(e.tooShortDroppedMs);
        s.micSilencedMs = num(e.micSilencedMs);
        s.captureGapMs = num(e.captureGapMs);
        s.queueDroppedFrames = num(e.queueDroppedFrames);
        break;
      case 'session_end':
        s.endedAt = num(e.ts);
        s.reason = str(e.reason);
        break;
    }
  }

  for (const s of sessions.values()) {
    if (s.endedAt === null && s.sessionId !== runningSessionId) s.reason = 'os_killed';
  }
  return [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
}

async function listFiles(dirUri: string): Promise<{ uri: string; size: number }[]> {
  const info = await FileSystem.getInfoAsync(dirUri);
  if (!info.exists || !info.isDirectory) return [];
  const out: { uri: string; size: number }[] = [];
  for (const name of await FileSystem.readDirectoryAsync(dirUri)) {
    const uri = `${dirUri}${name}`;
    const child = await FileSystem.getInfoAsync(uri);
    if (!child.exists) continue;
    if (child.isDirectory) out.push(...(await listFiles(`${uri}/`)));
    else out.push({ uri, size: child.size ?? 0 });
  }
  return out;
}

export async function recordingsUsage(): Promise<{ files: number; bytes: number }> {
  const files = await listFiles(`${voiceDir()}recordings/`);
  return { files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
}

/**
 * Deletes every recording and the session log from disk, then lists the
 * folder again. Returns how many files remain (0 means it worked).
 * Stop any running session first.
 */
export async function deleteAllListeningData(): Promise<number> {
  const dir = voiceDir();
  await FileSystem.deleteAsync(`${dir}recordings`, { idempotent: true });
  await FileSystem.deleteAsync(`${dir}session_log.jsonl`, { idempotent: true });
  const left = await listFiles(dir);
  return left.filter((f) => !f.uri.includes('/voice/enrollment/')).length;
}
