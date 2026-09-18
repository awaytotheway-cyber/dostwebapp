import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import type { ChatStackParamList } from './chatTypes';

type Props = NativeStackScreenProps<ChatStackParamList, 'Understanding'>;

type UnderstandingRow = {
  understanding_text: string;
  recurring_themes: string[];
  effective_approaches: string[];
  ineffective_approaches: string[];
  pacing_preference: string | null;
  unresolved_threads: string[];
  message_count_considered: number;
  created_at: string;
  version: number;
};

export default function UnderstandingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [understanding, setUnderstanding] = useState<UnderstandingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_understanding')
        .select('understanding_text, recurring_themes, effective_approaches, ineffective_approaches, pacing_preference, unresolved_threads, message_count_considered, created_at, version')
        .eq('user_id', user.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      setUnderstanding(data ?? null);
    } catch {
      setUnderstanding(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleReset = () => {
    Alert.alert(
      'Start fresh',
      "This will clear everything DOST has noticed about your patterns so far. It can't be undone — DOST will start learning again from scratch.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear everything',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              await supabase
                .from('user_understanding')
                .delete()
                .eq('user_id', user.id);
              setUnderstanding(null);
            } catch {
              Alert.alert('Something went wrong', 'Please try again.');
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <PaperGrain />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.cream} />
        </Pressable>
        <Text style={styles.headerTitle}>What DOST has noticed</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <Text style={styles.intro}>
          This isn't a diagnosis or a score — just a quiet, evolving sense of how you tend to move through things, so DOST can meet you better.
        </Text>

        {loading ? (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>Loading...</Text>
          </View>
        ) : !understanding ? (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>
              DOST is still getting to know you. This will grow richer as you talk more.
            </Text>
          </View>
        ) : (
          <>
            {/* Main understanding prose */}
            <View style={styles.card}>
              <Text style={styles.proseText}>{understanding.understanding_text}</Text>
            </View>

            {/* Recurring themes */}
            {understanding.recurring_themes.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Recurring themes</Text>
                <View style={styles.chipRow}>
                  {understanding.recurring_themes.map((theme, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{theme}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Unresolved threads */}
            {understanding.unresolved_threads.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Still unfolding</Text>
                <View style={styles.chipRow}>
                  {understanding.unresolved_threads.map((thread, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{thread}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Meta info */}
            <Text style={styles.meta}>
              Last updated {formatDate(understanding.created_at)} · based on {understanding.message_count_considered} exchanges · version {understanding.version}
            </Text>

            {/* Reset */}
            <GentlePressable
              onPress={handleReset}
              disabled={resetting}
              style={styles.resetButton}
            >
              <Text style={styles.resetText}>
                {resetting ? 'Clearing...' : 'Start fresh'}
              </Text>
            </GentlePressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    ...typography.label,
    color: colors.sand,
    fontSize: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  intro: {
    ...typography.body,
    color: colors.sand,
    marginBottom: spacing['2xl'],
    opacity: 0.85,
  },
  placeholderCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing['2xl'],
    alignItems: 'center',
  },
  placeholderText: {
    ...typography.body,
    color: colors.sand,
    textAlign: 'center',
    opacity: 0.7,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  proseText: {
    ...typography.body,
    color: colors.cream,
    lineHeight: 24,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.sand,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  chipText: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 13,
  },
  meta: {
    ...typography.caption,
    color: colors.clay,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing['3xl'],
  },
  resetButton: {
    alignSelf: 'center',
    backgroundColor: 'rgba(199, 123, 90, 0.12)',
    borderRadius: radius.cta,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  resetText: {
    ...typography.label,
    color: colors.error,
    fontSize: 14,
  },
});
