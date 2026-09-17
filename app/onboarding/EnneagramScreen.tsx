import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
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

export const ENNEAGRAM_QUESTIONS = [
  {
    id: 'q1',
    prompt: 'When something goes wrong, my first instinct is to...',
    options: [
      { text: 'Figure out what I did wrong and fix it', type: 1 },
      { text: 'Make sure everyone else is okay first', type: 2 },
      { text: 'Find a way to still come out looking good', type: 3 },
    ],
  },
  {
    id: 'q2',
    prompt: 'I feel most myself when...',
    options: [
      { text: "I'm creating something meaningful, even if it's messy", type: 4 },
      { text: 'I understand something deeply before acting', type: 5 },
      { text: 'I know exactly what to expect next', type: 6 },
    ],
  },
  {
    id: 'q3',
    prompt: 'My biggest fear is...',
    options: [
      { text: 'Being ordinary or forgettable', type: 4 },
      { text: 'Being trapped, controlled, or missing out', type: 7 },
      { text: 'Being weak or controlled by others', type: 8 },
    ],
  },
  {
    id: 'q4',
    prompt: 'In conflict, I tend to...',
    options: [
      { text: 'Avoid it and hope it resolves itself', type: 9 },
      { text: 'Confront it directly, head-on', type: 8 },
      { text: "Worry about it long after it's over", type: 6 },
    ],
  },
  {
    id: 'q5',
    prompt: "People who know me well would say I'm...",
    options: [
      { text: 'Principled, sometimes hard on myself', type: 1 },
      { text: 'Warm, always there for others', type: 2 },
      { text: 'Driven, always achieving something', type: 3 },
    ],
  },
  {
    id: 'q6',
    prompt: "When I'm stressed, I...",
    options: [
      { text: 'Withdraw and go quiet', type: 5 },
      { text: "Keep myself busy so I don't have to feel it", type: 7 },
      { text: 'Go along with whatever keeps the peace', type: 9 },
    ],
  },
  {
    id: 'q7',
    prompt: 'What I want most from others is...',
    options: [
      { text: 'To be truly understood, not just liked', type: 4 },
      { text: 'To be trusted and given space to think', type: 5 },
      { text: 'To be respected, not controlled', type: 8 },
    ],
  },
  {
    id: 'q8',
    prompt: 'My relationship with rules and structure is...',
    options: [
      { text: 'I hold myself to a high standard, often higher than others', type: 1 },
      { text: 'I like having options open, structure can feel confining', type: 7 },
      { text: "I go with the flow, structure doesn't matter much to me", type: 9 },
    ],
  },
];

export const ENNEAGRAM_TYPE_NAMES: Record<number, string> = {
  1: 'The Reformer',
  2: 'The Helper',
  3: 'The Achiever',
  4: 'The Individualist',
  5: 'The Investigator',
  6: 'The Loyalist',
  7: 'The Enthusiast',
  8: 'The Challenger',
  9: 'The Peacemaker',
};

const ENNEAGRAM_RESULT_LENS: Record<number, string> = {
  1: 'someone who holds a high inner standard, noticing what could be more true and wanting to make it right',
  2: 'someone whose first move is toward others, offering care and wanting to feel needed in return',
  3: 'someone who finds themselves in what they achieve, adapting so they still come through looking capable',
  4: 'someone who longs for depth and meaning, often feeling like an outsider looking in',
  5: 'someone who needs space to think, wanting to understand deeply before stepping into the world',
  6: 'someone who scans for what might go wrong, seeking loyalty and a sense of what comes next',
  7: 'someone who reaches for possibility, keeping options open so they never feel trapped or left out',
  8: 'someone who meets life head-on, protecting their strength and refusing to be controlled',
  9: 'someone who keeps the peace, going along more easily than they realize and setting themselves aside',
};

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
  const lens = ENNEAGRAM_RESULT_LENS[type] ?? ENNEAGRAM_RESULT_LENS[9];
  return `You show up most like Type ${type} — ${lens}. This isn't a box — just one lens DOST can use to understand you better.`;
}

export default function EnneagramScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ViewMode>('quiz');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [resultType, setResultType] = useState<number | null>(null);
  const [resultSource, setResultSource] = useState<EnneagramSource>('quiz');
  const [saving, setSaving] = useState(false);

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
        Alert.alert('Could not save', saved.message);
      }
      exitStep();
    } catch {
      Alert.alert('Could not save', 'Please try again.');
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
              accessibilityLabel="I already know my type"
              onPress={() => setMode('self_report')}
              hitSlop={8}
              style={styles.textLinkStartWrap}
            >
              <Text style={styles.textLinkStart}>I already know my type</Text>
            </GentlePressable>
            <Text style={styles.eyebrow}>
              {questionIndex + 1} of {ENNEAGRAM_QUESTIONS.length}
            </Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {question.prompt}
            </Text>
            {question.options.map((option) => {
              const selected = answers[question.id] === option.type;
              return (
                <GentlePressable
                  key={`${question.id}-${option.type}`}
                  onPress={() => onPickOption(option.type)}
                  accessibilityRole="button"
                  accessibilityLabel={option.text}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{option.text}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'self_report' ? (
          <>
            <Text style={styles.eyebrow}>If you already know</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              Which type feels most like you?
            </Text>
            <Text style={styles.screenLead}>
              Pick the one that already rings true. You can always change this later.
            </Text>
            {Object.entries(ENNEAGRAM_TYPE_NAMES).map(([key, name]) => {
              const type = parseInt(key, 10);
              return (
                <GentlePressable
                  key={key}
                  onPress={() => showResult(type, 'self_report')}
                  accessibilityRole="button"
                  accessibilityLabel={`Type ${type} — ${name}`}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    pressed && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>
                    Type {type} — {name}
                  </Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'result' && resultType != null ? (
          <>
            <Text style={styles.eyebrow}>
              Type {resultType} — {ENNEAGRAM_TYPE_NAMES[resultType]}
            </Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              A lens, not a box
            </Text>
            <Text style={styles.copyLeft}>{resultCopy(resultType)}</Text>
          </>
        ) : null}
      </ScrollView>

      {isFirstQuestion ? (
        <View style={styles.footer}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel="Skip this for now"
            onPress={() => {
              void onSkip();
            }}
            disabled={saving}
            style={styles.textLinkWrap}
          >
            <Text style={styles.textLink}>Skip this for now</Text>
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
              {saving ? 'Saving…' : standalone ? 'Save' : 'Continue'}
            </Text>
          </GentlePressable>
        </View>
      ) : null}
    </View>
  );
}
