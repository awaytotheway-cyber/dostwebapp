import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';
import {
  VARNA_TYPES,
  saveVarna,
  skipVarnaModule,
  type Varna,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';
import { useI18n, type TKey } from '../../lib/i18n';
import { nextOnboardingRoute } from '../../lib/onboardingConfig';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Varna'>;

type Question = {
  id: string;
  prompt: TKey;
  options: Array<{ text: TKey; varna: Varna }>;
};

/**
 * Four short questions, each with four options mapped to one of the four
 * varna dispositions. The varna with the highest tally wins; ties fall back
 * to the user's first pick. Mentor's doc: "derived through questioning".
 */
export const VARNA_QUESTIONS: Question[] = [
  {
    id: 'q1',
    prompt: 'varna.questions.q1.prompt',
    options: [
      { text: 'varna.questions.q1.o1', varna: 'brahmana' },
      { text: 'varna.questions.q1.o2', varna: 'kshatriya' },
      { text: 'varna.questions.q1.o3', varna: 'vaishya' },
      { text: 'varna.questions.q1.o4', varna: 'shudra' },
    ],
  },
  {
    id: 'q2',
    prompt: 'varna.questions.q2.prompt',
    options: [
      { text: 'varna.questions.q2.o1', varna: 'brahmana' },
      { text: 'varna.questions.q2.o2', varna: 'kshatriya' },
      { text: 'varna.questions.q2.o3', varna: 'vaishya' },
      { text: 'varna.questions.q2.o4', varna: 'shudra' },
    ],
  },
  {
    id: 'q3',
    prompt: 'varna.questions.q3.prompt',
    options: [
      { text: 'varna.questions.q3.o1', varna: 'brahmana' },
      { text: 'varna.questions.q3.o2', varna: 'kshatriya' },
      { text: 'varna.questions.q3.o3', varna: 'vaishya' },
      { text: 'varna.questions.q3.o4', varna: 'shudra' },
    ],
  },
  {
    id: 'q4',
    prompt: 'varna.questions.q4.prompt',
    options: [
      { text: 'varna.questions.q4.o1', varna: 'brahmana' },
      { text: 'varna.questions.q4.o2', varna: 'kshatriya' },
      { text: 'varna.questions.q4.o3', varna: 'vaishya' },
      { text: 'varna.questions.q4.o4', varna: 'shudra' },
    ],
  },
];

function dominantVarna(answers: Array<Varna | null>): Varna | null {
  const picks = answers.filter((v): v is Varna => v !== null);
  if (picks.length === 0) return null;
  const counts: Record<Varna, number> = {
    brahmana: 0,
    kshatriya: 0,
    vaishya: 0,
    shudra: 0,
  };
  for (const v of picks) counts[v]++;
  // Highest tally, breaking ties toward the first-picked option.
  let best: Varna = picks[0];
  for (const v of VARNA_TYPES) {
    if (counts[v] > counts[best]) best = v;
  }
  return best;
}

export default function VarnaScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Array<Varna | null>>(() =>
    VARNA_QUESTIONS.map(() => null),
  );
  const [saving, setSaving] = useState(false);

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate(...([nextOnboardingRoute('Varna'), { ...route.params }] as never));
  });

  const dominant = useMemo(() => dominantVarna(answers), [answers]);
  const answered = answers.filter((a) => a !== null).length;
  const canSave = answered >= 2; // need at least two picks to call a disposition

  const choose = (questionIndex: number, varna: Varna) => {
    setAnswers((prev) => {
      const next = prev.slice();
      next[questionIndex] = varna;
      return next;
    });
  };

  const onSkip = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await skipVarnaModule();
    } finally {
      setSaving(false);
      exitStep();
    }
  };

  const onSave = async () => {
    if (saving) return;
    if (!canSave || !dominant) {
      await onSkip();
      return;
    }
    setSaving(true);
    try {
      const saved = await saveVarna(dominant);
      if (!saved.ok) {
        Alert.alert(t('common.couldNotSave'), saved.message);
      }
      exitStep();
    } catch {
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
      exitStep();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <ScrollView
        style={styles.contentTop}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>{t('varna.optional')}</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          {t('varna.heading')}
        </Text>
        <Text style={styles.screenLead}>{t('varna.lead')}</Text>

        {VARNA_QUESTIONS.map((question, qIndex) => (
          <View key={question.id}>
            <Text style={styles.question}>{t(question.prompt)}</Text>
            {question.options.map((option) => {
              const selected = answers[qIndex] === option.varna;
              return (
                <GentlePressable
                  key={option.text}
                  accessibilityRole="button"
                  accessibilityLabel={t(option.text)}
                  accessibilityState={{ selected }}
                  onPress={() => choose(qIndex, option.varna)}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{t(option.text)}</Text>
                </GentlePressable>
              );
            })}
          </View>
        ))}

        {dominant && canSave ? (
          <Text style={[styles.fieldHint, { marginTop: spacing.lg }]}>
            {t('varna.leaning', { varna: t(`varna.labels.${dominant}` as TKey) })}
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.skip')}
          onPress={() => {
            void onSkip();
          }}
          disabled={saving}
          style={styles.textLinkWrap}
        >
          <Text style={styles.textLink}>{t('common.skip')}</Text>
        </GentlePressable>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={standalone ? t('common.save') : t('common.continue')}
          onPress={() => {
            void onSave();
          }}
          disabled={saving || !canSave}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            (saving || !canSave) && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {saving ? t('common.saving') : standalone ? t('common.save') : t('common.continue')}
          </Text>
        </GentlePressable>
      </View>
    </View>
  );
}
