import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import {
  getDb,
  searchLocalMessages,
  type MessageSearchHit,
} from '../lib/localDb';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';

type Props = NativeStackScreenProps<ChatStackParamList, 'SearchChats'>;

function previewText(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}…`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function SearchChatsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const userIdRef = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        userIdRef.current = data?.user?.id ?? null;
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const userId = userIdRef.current;
    const q = raw.trim();
    if (!userId || q.length < 2) {
      setHits([]);
      setHint(q.length === 1 ? 'Type at least 2 characters.' : null);
      return;
    }

    setSearching(true);
    setHint(null);
    try {
      const db = await getDb(userId);
      let local = await searchLocalMessages(db, userId, q, 40);

      // Supplement from server (RLS-scoped) if local is thin.
      if (local.length < 10) {
        const { data, error } = await supabase
          .from('conversations')
          .select('id, role, content, created_at')
          .eq('user_id', userId)
          .eq('role', 'user')
          .ilike('content', `%${q.replace(/[%_]/g, '')}%`)
          .order('created_at', { ascending: false })
          .limit(40);

        if (!error && Array.isArray(data)) {
          const seen = new Set(local.map((h) => h.id));
          for (const row of data) {
            if (!row || typeof row !== 'object') continue;
            const id = typeof row.id === 'string' ? row.id : '';
            const content = typeof row.content === 'string' ? row.content : '';
            const created_at =
              typeof row.created_at === 'string' ? row.created_at : '';
            if (!id || !content || !created_at || seen.has(id)) continue;
            local.push({ id, role: 'user', content, created_at });
            seen.add(id);
          }
          local.sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
        }
      }

      setHits(local.slice(0, 40));
      if (local.length === 0) {
        setHint('No matching messages yet.');
      }
    } catch {
      setHits([]);
      setHint('Could not search right now. Try again in a moment.');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void runSearch(query);
    }, 280);
    return () => clearTimeout(timer);
  }, [query, ready, runSearch]);

  const openHit = useCallback(
    (hit: MessageSearchHit) => {
      navigation.navigate('Chat', {
        focusMessageId: hit.id,
        focusCreatedAt: hit.created_at,
      });
    },
    [navigation],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PaperGrain />
      <View style={styles.header}>
        <GentlePressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityLabel="Back"
        >
          <Text style={styles.back}>Back</Text>
        </GentlePressable>
        <Text style={styles.title}>Search chats</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.searchBox}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your messages…"
          placeholderTextColor={colors.sand}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <Text style={styles.help}>
        Finds words in messages you wrote. Tap a result to open that moment.
      </Text>

      {searching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.olive} />
        </View>
      ) : null}

      {hint && !searching ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}

      <FlatList
        data={hits}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <GentlePressable
            style={styles.row}
            onPress={() => openHit(item)}
            accessibilityLabel={`Open message from ${formatWhen(item.created_at)}`}
          >
            <Text style={styles.when}>{formatWhen(item.created_at)}</Text>
            <Text style={styles.preview}>{previewText(item.content)}</Text>
          </GentlePressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  back: { ...typography.label, color: colors.gold, width: 56 },
  backSpacer: { width: 56 },
  title: { ...typography.heading, fontSize: 20, lineHeight: 24, color: colors.cream },
  searchBox: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    color: colors.cream,
    ...typography.body,
  },
  help: {
    ...typography.caption,
    color: colors.sand,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  loading: { paddingVertical: spacing.md, alignItems: 'center' },
  hint: {
    ...typography.label,
    color: colors.clay,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['4xl'],
  },
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  when: { ...typography.caption, color: colors.clay, marginBottom: spacing.xs },
  preview: { ...typography.body, color: colors.cream },
});
