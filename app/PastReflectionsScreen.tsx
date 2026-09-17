import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import BreathingDot from './BreathingDot';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';

type Props = NativeStackScreenProps<ChatStackParamList, 'PastReflections'>;

type Filter = 'all' | 'chats' | 'voice';

type ChatSessionItem = {
  kind: 'chat';
  id: string;
  created_at: string;
  preview: string;
  focusMessageId: string;
  focusCreatedAt: string;
};

type VoiceNoteItem = {
  kind: 'voice';
  id: string;
  created_at: string;
  preview: string;
  duration_seconds: number;
  transcript: string;
  dost_response: string | null;
  primary_emotion: string | null;
  secondary_emotions: string[] | null;
  underlying_need: string | null;
  audio_storage_path: string | null;
};

type ReflectionItem = ChatSessionItem | VoiceNoteItem;

const dawn = {
  base: '#1A1614',
  card: '#241E1B',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  gold: '#D9A857',
  muted: '#9A8878',
  border: 'rgba(237, 228, 211, 0.10)',
  segmentIdle: 'rgba(36, 30, 27, 0.9)',
} as const;

/** Soft boundary between chat sessions when no explicit session id exists. */
const SESSION_GAP_MS = 4 * 60 * 60 * 1000;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'chats', label: 'Chats' },
  { key: 'voice', label: 'Voice Notes' },
];

function previewText(content: string, max = 100): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round(
    (startToday.getTime() - startThat.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;

  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type UserMessageRow = {
  id: string;
  content: string;
  created_at: string;
};

type VoiceFingerprint = { transcript: string; created_at: string };

function isVoiceBackedMessage(
  row: UserMessageRow,
  voices: VoiceFingerprint[],
): boolean {
  const content = row.content.trim();
  if (!content) return false;
  const t = new Date(row.created_at).getTime();
  for (const voice of voices) {
    if (voice.transcript !== content) continue;
    const vt = new Date(voice.created_at).getTime();
    if (Number.isNaN(t) || Number.isNaN(vt)) continue;
    // Same transcript within a few minutes → the voice-note pipeline wrote this turn.
    if (Math.abs(t - vt) <= 5 * 60 * 1000) return true;
  }
  return false;
}

function groupChatSessions(
  rows: UserMessageRow[],
  voices: VoiceFingerprint[],
): ChatSessionItem[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const sessions: ChatSessionItem[] = [];
  let current: UserMessageRow[] = [];

  const flush = () => {
    if (current.length === 0) return;
    // Voice notes also write to conversations — start the chat card at the first
    // non-voice user turn so the mic card owns that moment without hiding later chat.
    const opening = current.find((row) => !isVoiceBackedMessage(row, voices));
    if (!opening) {
      current = [];
      return;
    }
    sessions.push({
      kind: 'chat',
      id: `chat-${opening.id}`,
      created_at: opening.created_at,
      preview: previewText(opening.content),
      focusMessageId: opening.id,
      focusCreatedAt: opening.created_at,
    });
    current = [];
  };

  for (const row of sorted) {
    if (current.length === 0) {
      current.push(row);
      continue;
    }
    const prev = current[current.length - 1];
    const gap =
      new Date(row.created_at).getTime() - new Date(prev.created_at).getTime();
    if (gap > SESSION_GAP_MS) {
      flush();
      current.push(row);
    } else {
      current.push(row);
    }
  }
  flush();

  return sessions;
}

export default function PastReflectionsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ReflectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        setItems([]);
        setError('Could not open your reflections right now.');
        return;
      }

      const [voiceRes, chatRes] = await Promise.all([
        supabase
          .from('voice_notes')
          .select(
            'id, duration_seconds, transcript, dost_response, primary_emotion, secondary_emotions, underlying_need, audio_storage_path, created_at',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('conversations')
          .select('id, content, created_at')
          .eq('user_id', userId)
          .eq('role', 'user')
          .order('created_at', { ascending: true })
          .limit(400),
      ]);

      const voiceItems: VoiceNoteItem[] = [];
      const voiceFingerprints: VoiceFingerprint[] = [];

      if (!voiceRes.error && Array.isArray(voiceRes.data)) {
        for (const row of voiceRes.data) {
          if (!row || typeof row !== 'object') continue;
          const id = typeof row.id === 'string' ? row.id : '';
          const transcript = typeof row.transcript === 'string' ? row.transcript : '';
          const created_at =
            typeof row.created_at === 'string' ? row.created_at : '';
          if (!id || !transcript || !created_at) continue;
          voiceFingerprints.push({
            transcript: transcript.trim(),
            created_at,
          });
          voiceItems.push({
            kind: 'voice',
            id,
            created_at,
            preview: previewText(transcript),
            duration_seconds:
              typeof row.duration_seconds === 'number'
                ? row.duration_seconds
                : Number(row.duration_seconds) || 0,
            transcript,
            dost_response:
              typeof row.dost_response === 'string' ? row.dost_response : null,
            primary_emotion:
              typeof row.primary_emotion === 'string' ? row.primary_emotion : null,
            secondary_emotions: Array.isArray(row.secondary_emotions)
              ? row.secondary_emotions.filter(
                  (t): t is string => typeof t === 'string',
                )
              : null,
            underlying_need:
              typeof row.underlying_need === 'string' ? row.underlying_need : null,
            audio_storage_path:
              typeof row.audio_storage_path === 'string'
                ? row.audio_storage_path
                : null,
          });
        }
      }

      const userRows: UserMessageRow[] = [];
      if (!chatRes.error && Array.isArray(chatRes.data)) {
        for (const row of chatRes.data) {
          if (!row || typeof row !== 'object') continue;
          const id = typeof row.id === 'string' ? row.id : '';
          const content = typeof row.content === 'string' ? row.content : '';
          const created_at =
            typeof row.created_at === 'string' ? row.created_at : '';
          if (!id || !content.trim() || !created_at) continue;
          userRows.push({ id, content, created_at });
        }
      }

      const chatItems = groupChatSessions(userRows, voiceFingerprints);
      const merged: ReflectionItem[] = [...chatItems, ...voiceItems].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setItems(merged);
    } catch {
      setItems([]);
      setError('Could not load reflections right now. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void (async () => {
        await load();
        if (!active) return;
      })();
      return () => {
        active = false;
      };
    }, [load]),
  );

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'chats') return items.filter((i) => i.kind === 'chat');
    return items.filter((i) => i.kind === 'voice');
  }, [filter, items]);

  const openItem = useCallback(
    (item: ReflectionItem) => {
      if (item.kind === 'chat') {
        navigation.navigate('Chat', {
          focusMessageId: item.focusMessageId,
          focusCreatedAt: item.focusCreatedAt,
        });
        return;
      }
      navigation.navigate('VoiceNoteDetail', {
        id: item.id,
        transcript: item.transcript,
        dost_response: item.dost_response,
        primary_emotion: item.primary_emotion,
        secondary_emotions: item.secondary_emotions,
        underlying_need: item.underlying_need,
        duration_seconds: item.duration_seconds,
        audio_storage_path: item.audio_storage_path,
        created_at: item.created_at,
      });
    },
    [navigation],
  );

  const emptyMessage =
    filter === 'chats'
      ? 'No chat reflections yet.'
      : filter === 'voice'
        ? 'No voice notes yet.'
        : 'Nothing here yet — when you reflect, it will gather.';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PaperGrain />
      {/* Header: ← Past chats */}
      <View style={styles.header}>
        <GentlePressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={dawn.sand} />
          <Text accessibilityRole="header" style={styles.title}>Past chats</Text>
        </GentlePressable>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={dawn.muted} />
          <Text style={styles.searchPlaceholder}>Search what you've said</Text>
        </View>
      </View>

      <View style={styles.segments}>
        {FILTERS.map(({ key, label }) => {
          const selected = filter === key;
          return (
            <GentlePressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => setFilter(key)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text
                style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}
              >
                {label}
              </Text>
            </GentlePressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <View style={styles.loadingRow} accessibilityLabel="Gathering reflections">
            <BreathingDot size={10} color={dawn.gold} />
            <Text style={styles.loadingText}>Gathering reflections…</Text>
          </View>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing['4xl'] },
            visible.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>{emptyMessage}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <GentlePressable
              accessibilityRole="button"
              accessibilityLabel={
                item.kind === 'chat'
                  ? `Chat from ${formatWhen(item.created_at)}`
                  : `Voice note from ${formatWhen(item.created_at)}, ${formatDuration(item.duration_seconds)}`
              }
              onPress={() => openItem(item)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.preview || (item.kind === 'chat' ? 'A quiet exchange' : 'A voice note')}
                </Text>
                <Text style={styles.when}>
                  {new Date(item.created_at).toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
              </View>
              {item.kind === 'chat' && (
                <Text style={styles.preview} numberOfLines={2}>
                  "{item.preview}"
                </Text>
              )}
              {item.kind === 'voice' && (
                <Text style={styles.duration}>
                  {formatDuration(item.duration_seconds)} · written up by Dost
                </Text>
              )}
            </GentlePressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dawn.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  back: {
    ...typography.label,
    color: dawn.sand,
    width: 56,
  },
  backSpacer: { width: 56 },
  title: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 22,
    lineHeight: 28,
    color: dawn.cream,
  },
  pressed: { opacity: 0.7 },

  // Search bar
  searchRow: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: dawn.card,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: dawn.border,
  },
  searchPlaceholder: {
    ...typography.body,
    color: dawn.muted,
    flex: 1,
  },

  // Filter segments
  segments: {
    flexDirection: 'row',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: dawn.segmentIdle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dawn.border,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  segmentSelected: {
    backgroundColor: dawn.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184, 76, 48, 0.35)',
  },
  segmentLabel: {
    ...typography.label,
    fontSize: 12,
    color: dawn.sand,
  },
  segmentLabelSelected: {
    color: dawn.cream,
  },

  // List + cards
  list: {
    paddingHorizontal: spacing.xl,
  },
  listEmpty: {
    flexGrow: 1,
  },
  card: {
    backgroundColor: dawn.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dawn.border,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.88,
  },
  cardTitle: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 16,
    lineHeight: 22,
    color: dawn.cream,
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  when: {
    ...typography.caption,
    color: dawn.muted,
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  duration: {
    ...typography.caption,
    color: dawn.sand,
  },
  preview: {
    ...typography.body,
    color: dawn.sand,
    fontSize: 13,
    lineHeight: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: dawn.sand,
    fontStyle: 'italic',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing['5xl'],
    paddingHorizontal: spacing.xl,
  },
  empty: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: dawn.sand,
    textAlign: 'center',
  },
});
