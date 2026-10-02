import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { hasMessage, t as translate, useI18n, type TKey } from '../../lib/i18n';
import { spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';
import {
  saveEnneagramResult,
  skipEnneagramModule,
  type EnneagramSource,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Enneagram'>;

type ViewMode = 'quiz' | 'self_report' | 'result';

export const ENNEAGRAM_QUESTIONS: Array<{
  id: string;
  prompt: TKey;
  options: Array<{ text: TKey; type: number }>;
}> = [
  {
    id: 'q1',
    prompt: 'enneagram.questions.q1.prompt',
    options: [
      { text: 'enneagram.questions.q1.o1', type: 1 },
      { text: 'enneagram.questions.q1.o2', type: 2 },
      { text: 'enneagram.questions.q1.o3', type: 3 },
    ],
  },
  {
    id: 'q2',
    prompt: 'enneagram.questions.q2.prompt',
    options: [
      { text: 'enneagram.questions.q2.o1', type: 4 },
      { text: 'enneagram.questions.q2.o2', type: 5 },
      { text: 'enneagram.questions.q2.o3', type: 6 },
    ],
  },
  {
    id: 'q3',
    prompt: 'enneagram.questions.q3.prompt',
    options: [
      { text: 'enneagram.questions.q3.o1', type: 4 },
      { text: 'enneagram.questions.q3.o2', type: 7 },
      { text: 'enneagram.questions.q3.o3', type: 8 },
    ],
  },
  {
    id: 'q4',
    prompt: 'enneagram.questions.q4.prompt',
    options: [
      { text: 'enneagram.questions.q4.o1', type: 9 },
      { text: 'enneagram.questions.q4.o2', type: 8 },
      { text: 'enneagram.questions.q4.o3', type: 6 },
    ],
  },
  {
    id: 'q5',
    prompt: 'enneagram.questions.q5.prompt',
    options: [
      { text: 'enneagram.questions.q5.o1', type: 1 },
      { text: 'enneagram.questions.q5.o2', type: 2 },
      { text: 'enneagram.questions.q5.o3', type: 3 },
    ],
  },
  {
    id: 'q6',
    prompt: 'enneagram.questions.q6.prompt',
    options: [
      { text: 'enneagram.questions.q6.o1', type: 5 },
      { text: 'enneagram.questions.q6.o2', type: 7 },
      { text: 'enneagram.questions.q6.o3', type: 9 },
    ],
  },
  {
    id: 'q7',
    prompt: 'enneagram.questions.q7.prompt',
    options: [
      { text: 'enneagram.questions.q7.o1', type: 4 },
      { text: 'enneagram.questions.q7.o2', type: 5 },
      { text: 'enneagram.questions.q7.o3', type: 8 },
    ],
  },
  {
    id: 'q8',
    prompt: 'enneagram.questions.q8.prompt',
    options: [
      { text: 'enneagram.questions.q8.o1', type: 1 },
      { text: 'enneagram.questions.q8.o2', type: 7 },
      { text: 'enneagram.questions.q8.o3', type: 9 },
    ],
  },
];

export const ENNEAGRAM_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function enneagramTypeName(type: number): string | null {
  const key = `enneagram.types.${type}`;
  return hasMessage(key) ? translate(key as TKey) : null;
}

export function scoreEnneagram(answers: Record<string, number>): number {
  const counts: Record<number, number> = {};
  const firstEncountered: number[] = [];
  for (const question of ENNEAGRAM_QUESTIONS) {
    const type = answers[question.id];
    if (type == null) continue;
    if (counts[type] == null) firstEncountered.push(type);
    counts[type] = (counts[type] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  return firstEncountered.find((type) => counts[type] === max) ?? 9;
}

function resultCopy(type: number): string {
  const lensType = hasMessage(`enneagram.lens.${type}`) ? type : 9;
  return translate('enneagram.resultCopy', {
    type,
    lens: translate(`enneagram.lens.${lensType}` as TKey),
  });
}

export default function EnneagramScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ViewMode>('quiz');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [resultType, setResultType] = useState<number | null>(null);
  const [resultSource, setResultSource] = useState<EnneagramSource>('quiz');
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const question = ENNEAGRAM_QUESTIONS[questionIndex];
  const isFirstQuestion = mode === 'quiz' && questionIndex === 0;

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate('Numerology', { ...route.params });
  });

  const showResult = (type: number, source: EnneagramSource) => {
    setResultType(type);
    setResultSource(source);
    setMode('result');
  };

  const onPickOption = (type: number) => {
    if (!question) return;
    const nextAnswers = { ...answers, [question.id]: type };
    setAnswers(nextAnswers);
    if (questionIndex < ENNEAGRAM_QUESTIONS.length - 1) {
      setQuestionIndex(questionIndex + 1);
      return;
    }
    showResult(scoreEnneagram(nextAnswers), 'quiz');
  };

  const onSkip = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await skipEnneagramModule();
    } finally {
      setSaving(false);
      exitStep();
    }
  };

  const onContinueFromResult = async () => {
    if (saving || resultType == null) return;
    setSaving(true);
    try {
      const saved = await saveEnneagramResult(resultType, resultSource);
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
        {mode === 'quiz' && question ? (
          <>
            <GentlePressable
              accessibilityRole="button"
              accessibilityLabel={t('enneagram.alreadyKnow')}
              onPress={() => setMode('self_report')}
              hitSlop={8}
              style={styles.textLinkStartWrap}
            >
              <Text style={styles.textLinkStart}>{t('enneagram.alreadyKnow')}</Text>
            </GentlePressable>
            <Text style={styles.eyebrow}>
              {t('enneagram.progress', {
                current: questionIndex + 1,
                total: ENNEAGRAM_QUESTIONS.length,
              })}
            </Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t(question.prompt)}
            </Text>
            {question.options.map((option) => {
              const selected = answers[question.id] === option.type;
              return (
                <GentlePressable
                  key={`${question.id}-${option.type}`}
                  onPress={() => onPickOption(option.type)}
                  accessibilityRole="button"
                  accessibilityLabel={t(option.text)}
                  accessibilityState={{ selected }}
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
          </>
        ) : null}

        {mode === 'self_report' ? (
          <>
            <Text style={styles.eyebrow}>{t('enneagram.ifYouKnow')}</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t('enneagram.whichType')}
            </Text>
            <Text style={styles.screenLead}>{t('enneagram.whichTypeLead')}</Text>
            {ENNEAGRAM_TYPES.map((type) => {
              const label = t('enneagram.typeName', { type, name: enneagramTypeName(type) ?? '' });
              return (
                <GentlePressable
                  key={type}
                  onPress={() => showResult(type, 'self_report')}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    pressed && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{label}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'result' && resultType != null ? (
          <>
            <Text style={styles.eyebrow}>
              {t('enneagram.typeName', {
                type: resultType,
                name: enneagramTypeName(resultType) ?? '',
              })}
            </Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t('enneagram.lensNotBox')}
            </Text>
            <Text style={styles.copyLeft}>{resultCopy(resultType)}</Text>
          </>
        ) : null}
      </ScrollView>

      {isFirstQuestion ? (
        <View style={styles.footer}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('enneagram.skipForNow')}
            onPress={() => {
              void onSkip();
            }}
            disabled={saving}
            style={styles.textLinkWrap}
          >
            <Text style={styles.textLink}>{t('enneagram.skipForNow')}</Text>
          </GentlePressable>
        </View>
      ) : null}

      {mode === 'result' ? (
        <View style={styles.footer}>
          <GentlePressable
            onPress={() => {
              void onContinueFromResult();
            }}
            disabled={saving}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              saving && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {saving ? t('common.saving') : standalone ? t('common.save') : t('common.continue')}
            </Text>
          </GentlePressable>
        </View>
      ) : null}
    </View>
  );
}
