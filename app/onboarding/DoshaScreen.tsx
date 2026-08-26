import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Dosha } from '../../lib/profile';
import type { DoshaPick, OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Dosha'>;

export type Question = {
  key: string;
  prompt: string;
  options: Array<{ label: string; value: DoshaPick }>;
};

export const DOSHA_QUESTIONS: Question[] = [
  {
    key: 'body_frame',
    prompt: 'My body frame is naturally:',
    options: [
      { label: 'Thin and light (V)', value: 'vata' },
      { label: 'Medium and muscular (P)', value: 'pitta' },
      { label: 'Broad and solid (K)', value: 'kapha' },
    ],
  },
  {
    key: 'stress',
    prompt: 'Under stress, I tend to become:',
    options: [
      { label: 'Anxious and scattered (V)', value: 'vata' },
      { label: 'Irritable and sharp (P)', value: 'pitta' },
      { label: 'Withdrawn and heavy (K)', value: 'kapha' },
    ],
  },
  {
    key: 'energy',
    prompt: 'My energy through the day is:',
    options: [
      { label: 'Comes in bursts, tires quickly (V)', value: 'vata' },
      { label: 'Strong and focused, then crashes (P)', value: 'pitta' },
      { label: 'Steady but slow to start (K)', value: 'kapha' },
    ],
  },
  {
    key: 'sleep',
    prompt: 'My sleep is usually:',
    options: [
      { label: 'Light, easily disturbed (V)', value: 'vata' },
      { label: 'Sound but shorter (P)', value: 'pitta' },
      { label: 'Deep and long (K)', value: 'kapha' },
    ],
  },
  {
    key: 'learning',
    prompt: 'When learning something new, I:',
    options: [
      { label: 'Grasp fast, forget fast (V)', value: 'vata' },
      { label: 'Grasp with sharp focus, remember well (P)', value: 'pitta' },
      { label: 'Slow to grasp, never forget (K)', value: 'kapha' },
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
  const [answers, setAnswers] = useState<Partial<Record<string, DoshaPick>>>({});

  const complete = useMemo(
    () => DOSHA_QUESTIONS.every((q) => answers[q.key]),
    [answers],
  );

  const onContinue = () => {
    if (!complete) return;
    const filled = answers as Record<string, DoshaPick>;
    navigation.navigate('Confirm', {
      ...route.params,
      dosha: scoreDosha(filled),
      doshaScores: filled,
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <ScrollView style={styles.contentTop} contentContainerStyle={{ paddingBottom: 24 }}>
        {DOSHA_QUESTIONS.map((question) => (
          <View key={question.key}>
            <Text style={styles.question}>{question.prompt}</Text>
            {question.options.map((option) => {
              const selected = answers[question.key] === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() =>
                    setAnswers((prev) => ({ ...prev, [question.key]: option.value }))
                  }
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={onContinue}
          disabled={!complete}
          style={[styles.button, !complete && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}
