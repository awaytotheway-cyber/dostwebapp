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
import { enneagramTypeName } from './onboarding/EnneagramScreen';
import { hasMessage, t as translate, useI18n, type TKey } from '../lib/i18n';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import BreathingDot from './BreathingDot';

type Props = NativeStackScreenProps<ChatStackParamList, 'PersonalityProfile'>;

type RowStatus = 'complete' | 'skipped' | 'empty';

function capitalize(value: string): string {
  if (!value) return value;
  const key = `dosha.${value.toLowerCase()}`;
  if (hasMessage(key)) return translate(key as TKey);
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
  const { t } = useI18n();

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
      Alert.alert(t('personality.birthDateNeeded'), t('personality.birthDateNeededBody'));
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
          accessibilityLabel={t('common.goBack')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.back}>{t('common.backPlain')}</Text>
        </GentlePressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['4xl'] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{t('personality.eyebrow')}</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('personality.heading')}
        </Text>
        <Text style={styles.intro}>{t('personality.intro')}</Text>

        {loading ? (
          <View style={styles.loadingRow} accessibilityLabel={t('personality.loadingA11y')}>
            <BreathingDot size={10} color={colors.gold} />
            <Text style={styles.loadingText}>{t('personality.loading')}</Text>
          </View>
        ) : null}

        {loadFailed ? (
          <Text style={styles.errorCopy}>{t('personality.loadFailed')}</Text>
        ) : null}

        {!loading ? (
          <View style={styles.card}>
            <ProfileModuleRow
              status={doshaComplete ? 'complete' : 'empty'}
              title={t('personality.dosha')}
              value={doshaComplete && doshaLabel ? doshaLabel : t('personality.notSet')}
              action={t('personality.tapToEdit')}
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
              title={t('personality.enneagram')}
              value={
                enneagramComplete && personality?.enneagram_type
                  ? t('enneagram.typeName', {
                      type: personality.enneagram_type,
                      name: enneagramTypeName(personality.enneagram_type) ?? '',
                    })
                  : moduleIsSkipped(personality, ENNEAGRAM_MODULE)
                    ? t('personality.skipped')
                    : t('personality.notSet')
              }
              action={
                enneagramComplete ? t('personality.tapToEdit') : t('personality.tapToComplete')
              }
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
              title={t('personality.numerology')}
              value={
                numerologyComplete && personality?.life_path_number != null
                  ? t('numerology.lifePathNumber', { number: personality.life_path_number })
                  : t('personality.notCalculated')
              }
              action={
                numerologyComplete ? t('personality.tapToEdit') : t('personality.tapToReveal')
              }
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
              title={t('personality.tcmElement')}
              value={
                tcmComplete && personality?.tcm_element
                  ? hasMessage(`tcm.elements.${personality.tcm_element}`)
                    ? t(`tcm.elements.${personality.tcm_element}` as TKey)
                    : personality.tcm_element
                  : moduleIsSkipped(personality, TCM_MODULE)
                    ? t('personality.skipped')
                    : t('personality.notSet')
              }
              action={tcmComplete ? t('personality.tapToEdit') : t('personality.tapToComplete')}
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
              title={t('personality.mbti')}
              value={
                mbtiComplete && personality?.mbti_type
                  ? personality.mbti_type
                  : t('personality.notProvided')
              }
              action={mbtiComplete ? t('personality.tapToEdit') : t('personality.tapToAdd')}
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
      accessibilityLabel={translate('personality.rowA11y', { title, value, action })}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.pressed]}
    >
      <Text style={[styles.mark, status === 'complete' && styles.markDone]}>{statusMark(status)}</Text>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{translate('personality.rowTitle', { title, value })}</Text>
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
