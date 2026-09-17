import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadMyProfile, type Dosha } from '../lib/profile';
import {
  ENNEAGRAM_MODULE,
  MBTI_MODULE,
  NUMEROLOGY_MODULE,
  TCM_MODULE,
  loadPersonalityProfile,
  moduleIsComplete,
  moduleIsSkipped,
  type PersonalityProfileRow,
} from '../lib/personalityProfile';
import { ENNEAGRAM_TYPE_NAMES } from './onboarding/EnneagramScreen';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import BreathingDot from './BreathingDot';

type Props = NativeStackScreenProps<ChatStackParamList, 'PersonalityProfile'>;

type RowStatus = 'complete' | 'skipped' | 'empty';

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function doshaFromProfile(dosha: Dosha | null | undefined): string | null {
  if (!dosha) return null;
  return capitalize(dosha);
}

function doshaFromPersonality(row: PersonalityProfileRow | null): string | null {
  if (!row) return null;
  const body = row.dosha_body?.trim();
  const mind = row.dosha_mind?.trim();
  if (body && mind && body.toLowerCase() !== mind.toLowerCase()) {
    return `${capitalize(body)}-${capitalize(mind)}`;
  }
  if (body) return capitalize(body);
  if (mind) return capitalize(mind);
  return null;
}

function statusMark(status: RowStatus): string {
  return status === 'complete' ? '✓' : '○';
}

export default function PersonalityProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dob, setDob] = useState<string | null>(null);
  const [doshaLabel, setDoshaLabel] = useState<string | null>(null);
  const [personality, setPersonality] = useState<PersonalityProfileRow | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const [account, personalityLoad] = await Promise.all([loadMyProfile(), loadPersonalityProfile()]);
    if (account.ok && account.profile) {
      setDob(account.profile.dob);
      setDoshaLabel(
        doshaFromPersonality(personalityLoad.ok ? personalityLoad.profile : null) ??
          doshaFromProfile(account.profile.dosha),
      );
    } else {
      setDob(null);
      setDoshaLabel(doshaFromPersonality(personalityLoad.ok ? personalityLoad.profile : null));
    }
    if (!personalityLoad.ok) {
      setPersonality(null);
      setLoadFailed(true);
    } else {
      setPersonality(personalityLoad.profile);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const enneagramComplete = moduleIsComplete(personality, ENNEAGRAM_MODULE);
  const numerologyComplete = moduleIsComplete(personality, NUMEROLOGY_MODULE);
  const tcmComplete = moduleIsComplete(personality, TCM_MODULE);
  const mbtiComplete = moduleIsComplete(personality, MBTI_MODULE);
  const doshaComplete = Boolean(doshaLabel);

  const openNumerology = () => {
    if (!dob) {
      Alert.alert(
        'Birth date needed',
        'Life Path is calculated from your birth date. Add it in Space Settings, then come back here.',
      );
      return;
    }
    navigation.navigate('PersonalityNumerology', { standalone: true, dob });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PaperGrain />
      <View style={styles.topBar}>
        <GentlePressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.back}>Back</Text>
        </GentlePressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['4xl'] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>YOUR SPACE</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          Personality profile
        </Text>
        <Text style={styles.intro}>
          Fill in anything you skipped, or change what you already shared. Nothing here is required.
        </Text>

        {loading ? (
          <View style={styles.loadingRow} accessibilityLabel="Loading personality profile">
            <BreathingDot size={10} color={colors.gold} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : null}

        {loadFailed ? (
          <Text style={styles.errorCopy}>
            Could not load this profile. If it keeps happening, run the personality_profile SQL in
            Supabase, then try again.
          </Text>
        ) : null}

        {!loading ? (
          <View style={styles.card}>
            <ProfileModuleRow
              status={doshaComplete ? 'complete' : 'empty'}
              title="Dosha"
              value={doshaComplete && doshaLabel ? doshaLabel : 'not set'}
              action="tap to edit"
              onPress={() => navigation.navigate('DoshaRetake')}
            />
            <ProfileModuleRow
              status={
                enneagramComplete
                  ? 'complete'
                  : moduleIsSkipped(personality, ENNEAGRAM_MODULE)
                    ? 'skipped'
                    : 'empty'
              }
              title="Enneagram"
              value={
                enneagramComplete && personality?.enneagram_type
                  ? `Type ${personality.enneagram_type}${
                      ENNEAGRAM_TYPE_NAMES[personality.enneagram_type]
                        ? ` — ${ENNEAGRAM_TYPE_NAMES[personality.enneagram_type]}`
                        : ''
                    }`
                  : moduleIsSkipped(personality, ENNEAGRAM_MODULE)
                    ? 'skipped'
                    : 'not set'
              }
              action={enneagramComplete ? 'tap to edit' : 'tap to complete'}
              onPress={() => navigation.navigate('PersonalityEnneagram', { standalone: true })}
            />
            <ProfileModuleRow
              status={
                numerologyComplete
                  ? 'complete'
                  : moduleIsSkipped(personality, NUMEROLOGY_MODULE)
                    ? 'skipped'
                    : 'empty'
              }
              title="Numerology"
              value={
                numerologyComplete && personality?.life_path_number != null
                  ? `Life Path ${personality.life_path_number}`
                  : moduleIsSkipped(personality, NUMEROLOGY_MODULE)
                    ? 'not calculated'
                    : 'not calculated'
              }
              action={numerologyComplete ? 'tap to edit' : 'tap to reveal'}
              onPress={openNumerology}
            />
            <ProfileModuleRow
              status={
                tcmComplete
                  ? 'complete'
                  : moduleIsSkipped(personality, TCM_MODULE)
                    ? 'skipped'
                    : 'empty'
              }
              title="TCM Element"
              value={
                tcmComplete && personality?.tcm_element
                  ? personality.tcm_element
                  : moduleIsSkipped(personality, TCM_MODULE)
                    ? 'skipped'
                    : 'not set'
              }
              action={tcmComplete ? 'tap to edit' : 'tap to complete'}
              onPress={() => navigation.navigate('PersonalityTCM', { standalone: true })}
            />
            <ProfileModuleRow
              last
              status={
                mbtiComplete
                  ? 'complete'
                  : moduleIsSkipped(personality, MBTI_MODULE)
                    ? 'skipped'
                    : 'empty'
              }
              title="MBTI"
              value={
                mbtiComplete && personality?.mbti_type
                  ? personality.mbti_type
                  : moduleIsSkipped(personality, MBTI_MODULE)
                    ? 'not provided'
                    : 'not provided'
              }
              action={mbtiComplete ? 'tap to edit' : 'tap to add'}
              onPress={() => navigation.navigate('PersonalityMBTI', { standalone: true })}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProfileModuleRow({
  status,
  title,
  value,
  action,
  onPress,
  last,
}: {
  status: RowStatus;
  title: string;
  value: string;
  action: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <GentlePressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}. ${action}`}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.pressed]}
    >
      <Text style={[styles.mark, status === 'complete' && styles.markDone]}>{statusMark(status)}</Text>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>
          {title}: {value}
        </Text>
        <Text style={styles.rowAction}>{action}</Text>
      </View>
    </GentlePressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  back: { ...typography.label, color: colors.gold, fontSize: 15 },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.gold,
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  heading: { ...typography.heading, color: colors.cream, fontSize: 32, lineHeight: 36 },
  intro: {
    ...typography.body,
    color: colors.sand,
    marginTop: spacing.sm,
    marginBottom: spacing['2xl'],
    maxWidth: 520,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  loadingText: { ...typography.body, color: colors.sand },
  errorCopy: {
    ...typography.body,
    color: colors.sand,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    minHeight: 72,
  },
  rowLast: { borderBottomWidth: 0 },
  mark: {
    ...typography.label,
    color: colors.clay,
    fontSize: 16,
    marginTop: 2,
    width: 18,
  },
  markDone: { color: colors.gold },
  rowCopy: { flex: 1 },
  rowTitle: {
    ...typography.body,
    color: colors.cream,
    fontSize: 16,
    lineHeight: 22,
  },
  rowAction: {
    ...typography.caption,
    color: colors.sand,
    marginTop: spacing.xs,
  },
  pressed: { opacity: 0.76 },
});
