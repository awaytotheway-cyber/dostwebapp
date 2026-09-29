import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import theme from '../lib/theme';
import { supabase } from '../lib/supabase';
import { deleteEnrollment, isEnrolled } from '../lib/hearing/enrollment';
import type { ChatStackParamList } from './chatTypes';

type NavProp = NativeStackNavigationProp<ChatStackParamList>;

/**
 * Settings block for the hearing feature. Shows total listening time
 * across all sessions and a destructive button that deletes every
 * voice_sessions and voice_signals row for the current user.
 *
 * Kept as its own component so SettingsScreen.tsx stays roughly the
 * same shape as before and the hearing feature's delete flow is
 * self-contained.
 */
export default function HearingSettingsSection() {
  const navigation = useNavigation<NavProp>();
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTotals = useCallback(async () => {
    const { data, error } = await supabase
      .from('voice_sessions')
      .select('total_duration_seconds');
    if (error || !data) return;
    let sum = 0;
    for (const row of data) {
      const n = Number(row.total_duration_seconds ?? 0);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    setTotalMs(sum * 1000);
    setSessionCount(data.length);
  }, []);

  const refreshEnrollment = useCallback(async () => {
    setEnrolled(await isEnrolled());
  }, []);

  useEffect(() => {
    void loadTotals();
    void refreshEnrollment();
    // Refresh on focus so the row reflects a fresh enrollment done
    // via the Listening screen or the row itself.
    const unsub = navigation.addListener('focus', () => {
      void refreshEnrollment();
    });
    return unsub;
  }, [loadTotals, refreshEnrollment, navigation]);

  const onDeleteEnrollment = () => {
    Alert.alert(
      'Delete voice enrollment',
      'This removes only the voiceprint DOST uses to recognize you. Past listening data is untouched. You’ll need to re-enroll before starting a new session.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void performDeleteEnrollment(),
        },
      ],
    );
  };

  const performDeleteEnrollment = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteEnrollment();
      await refreshEnrollment();
      Alert.alert('Deleted', 'Voice enrollment has been removed.');
    } catch (e) {
      Alert.alert(
        'Could not delete',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAll = () => {
    Alert.alert(
      'Delete all voice signal data',
      'This removes every listening-session row and every signal DOST captured. Your reflections and voice notes are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const performDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in and try again.');
        return;
      }
      // Deleting sessions cascades to signals via the FK constraint.
      const { error: sessErr } = await supabase
        .from('voice_sessions')
        .delete()
        .eq('user_id', userId);
      if (sessErr) {
        Alert.alert('Could not delete', sessErr.message);
        return;
      }
      // Belt-and-braces: also delete any orphan signals in case cascade fails.
      await supabase.from('voice_signals').delete().eq('user_id', userId);
      await loadTotals();
      Alert.alert('Deleted', 'All voice signal data has been removed.');
    } catch (e) {
      Alert.alert(
        'Could not delete',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Listening</Text>
      <Text style={styles.sectionIntro}>
        Signals from your listening sessions live only here — nothing else in
        DOST reads them yet.
      </Text>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Sessions</Text>
          <Text style={styles.statValue}>{sessionCount}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Total time</Text>
          <Text style={styles.statValue}>
            {totalMs === null ? '—' : formatTotal(totalMs)}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => navigation.navigate('SpeakerEnrollment', { returnTo: undefined })}
        accessibilityRole="button"
        accessibilityLabel={enrolled ? 'Re-record my voice' : 'Set up voice enrollment'}
        style={({ pressed }) => [styles.enrollRow, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.enrollTitle}>
            {enrolled === false ? 'Set up voice enrollment' : 'Re-record my voice'}
          </Text>
          <Text style={styles.enrollHint}>
            {enrolled === false
              ? 'Required before you can start a listening session.'
              : 'Do this if the gate is missing your voice too often, or if you’ve changed rooms.'}
          </Text>
        </View>
        <Text style={styles.enrollChevron}>›</Text>
      </Pressable>

      {enrolled && (
        <Pressable
          onPress={onDeleteEnrollment}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Delete voice enrollment"
          style={({ pressed }) => [
            styles.dangerOutlineButton,
            pressed && { opacity: 0.7 },
            busy && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.dangerOutlineText}>Delete voice enrollment</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onDeleteAll}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Delete all voice signal data"
        style={({ pressed }) => [
          styles.dangerButton,
          pressed && { opacity: 0.7 },
          busy && { opacity: 0.5 },
        ]}
      >
        <Text style={styles.dangerButtonText}>
          {busy ? 'Deleting…' : 'Delete all voice signal data'}
        </Text>
      </Pressable>
    </View>
  );
}

function formatTotal(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const styles = StyleSheet.create({
  section: {
    marginTop: theme.spacing['2xl'],
    marginBottom: theme.spacing['2xl'],
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    paddingTop: theme.spacing['2xl'],
  },
  sectionTitle: {
    ...theme.type.heading,
    fontSize: 20,
    lineHeight: 24,
    color: theme.colors.cream,
    marginBottom: theme.spacing.xs,
  },
  sectionIntro: {
    ...theme.type.body,
    color: theme.colors.sand,
    marginBottom: theme.spacing.lg,
  },
  statRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  statLabel: { ...theme.type.caption, color: theme.colors.clay },
  statValue: {
    ...theme.type.heading,
    fontSize: 18,
    lineHeight: 22,
    color: theme.colors.cream,
    marginTop: 4,
  },
  dangerButton: {
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.error,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
    backgroundColor: 'transparent',
  },
  dangerButtonText: {
    ...theme.type.label,
    color: theme.colors.error,
    fontSize: 14,
  },
  enrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  enrollTitle: { ...theme.type.label, color: theme.colors.cream, fontSize: 15 },
  enrollHint: {
    ...theme.type.caption,
    color: theme.colors.clay,
    marginTop: 2,
  },
  enrollChevron: {
    ...theme.type.heading,
    fontSize: 24,
    color: theme.colors.sand,
    marginLeft: theme.spacing.md,
  },
  dangerOutlineButton: {
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.error,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
    backgroundColor: 'transparent',
    marginBottom: theme.spacing.md,
  },
  dangerOutlineText: {
    ...theme.type.label,
    color: theme.colors.error,
    fontSize: 14,
  },
});
