import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Dosha } from '../../lib/profile';
import type { DoshaPick, OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import DoshaGlyph from './DoshaGlyph';
import { useI18n, type TKey } from '../../lib/i18n';
import { spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Dosha'>;

export type Question = {
  key: string;
  prompt: TKey;
  options: Array<{ label: TKey; value: DoshaPick }>;
};

export const DOSHA_QUESTIONS: Question[] = [
  {
    key: 'body_frame',
    prompt: 'doshaQuiz.body_frame.prompt',
    options: [
      { label: 'doshaQuiz.body_frame.vata', value: 'vata' },
      { label: 'doshaQuiz.body_frame.pitta', value: 'pitta' },
      { label: 'doshaQuiz.body_frame.kapha', value: 'kapha' },
    ],
  },
  {
    key: 'stress',
    prompt: 'doshaQuiz.stress.prompt',
    options: [
      { label: 'doshaQuiz.stress.vata', value: 'vata' },
      { label: 'doshaQuiz.stress.pitta', value: 'pitta' },
      { label: 'doshaQuiz.stress.kapha', value: 'kapha' },
    ],
  },
  {
    key: 'energy',
    prompt: 'doshaQuiz.energy.prompt',
    options: [
      { label: 'doshaQuiz.energy.vata', value: 'vata' },
      { label: 'doshaQuiz.energy.pitta', value: 'pitta' },
      { label: 'doshaQuiz.energy.kapha', value: 'kapha' },
    ],
  },
  {
    key: 'sleep',
    prompt: 'doshaQuiz.sleep.prompt',
    options: [
      { label: 'doshaQuiz.sleep.vata', value: 'vata' },
      { label: 'doshaQuiz.sleep.pitta', value: 'pitta' },
      { label: 'doshaQuiz.sleep.kapha', value: 'kapha' },
    ],
  },
  {
    key: 'learning',
    prompt: 'doshaQuiz.learning.prompt',
    options: [
      { label: 'doshaQuiz.learning.vata', value: 'vata' },
      { label: 'doshaQuiz.learning.pitta', value: 'pitta' },
      { label: 'doshaQuiz.learning.kapha', value: 'kapha' },
    ],
  },
];

export function scoreDosha(answers: Record<string, DoshaPick>): Dosha {
  const counts = { vata: 0, pitta: 0, kapha: 0 };
  for (const value of Object.values(answers)) {
    counts[value] += 1;
  }
  const max = Math.max(counts.vata, counts.pitta, counts.kapha);
  const winners = (['vata', 'pitta', 'kapha'] as const).filter((d) => counts[d] === max);
  return winners.length === 1 ? winners[0] : 'mixed';
}

export default function DoshaScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Partial<Record<string, DoshaPick>>>({});

  const complete = useMemo(
    () => DOSHA_QUESTIONS.every((q) => answers[q.key]),
    [answers],
  );

  const onContinue = () => {
    if (!complete) return;
    const filled = answers as Record<string, DoshaPick>;
    navigation.navigate('Enneagram', {
      ...route.params,
      dosha: scoreDosha(filled),
      doshaScores: filled,
    });
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
        {DOSHA_QUESTIONS.map((question) => (
          <View key={question.key}>
            <Text style={styles.question}>{t(question.prompt)}</Text>
            {question.options.map((option) => {
              const selected = answers[question.key] === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() =>
                    setAnswers((prev) => ({ ...prev, [question.key]: option.value }))
                  }
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(option.label)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.optionSelected,
                    pressed && styles.optionSelected,
                  ]}
                >
                  <View style={styles.doshaGlyphFrame}>
                    <DoshaGlyph dosha={option.value} selected={selected} />
                  </View>
                  <Text style={styles.optionText}>{t(option.label)}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={onContinue}
          disabled={!complete}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            !complete && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>{t('common.continue')}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
