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
  saveTcmResult,
  skipTcmModule,
  type TcmElement,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'TCM'>;

type ViewMode = 'emotion' | 'climate' | 'result';

export const TCM_EMOTIONAL_STATES: Array<{ label: string; element: TcmElement }> = [
  { label: 'I tend to feel anger or frustration first', element: 'Wood' },
  { label: 'I tend to feel joy or overexcitement first', element: 'Fire' },
  { label: 'I tend to feel worry or overthinking first', element: 'Earth' },
  { label: 'I tend to feel grief or sadness first', element: 'Metal' },
  { label: 'I tend to feel fear or anxiety first', element: 'Water' },
];

export const TCM_CLIMATE_PREFERENCES: Array<{ label: string; element: TcmElement }> = [
  { label: 'Warm and dry', element: 'Fire' },
  { label: 'Cool and breezy', element: 'Wood' },
  { label: 'Humid and mild', element: 'Earth' },
  { label: 'Crisp and clear', element: 'Metal' },
  { label: 'Cold, I run warm naturally', element: 'Water' },
];

export const TCM_ELEMENT_LENS: Record<TcmElement, string> = {
  Wood: 'growing, driven, and quick to feel anger or frustration when blocked, but capable of remarkable direction when given space to move',
  Fire: 'expressive, warm, and quick to feel joy, but prone to burning out when overextended',
  Earth: 'centering, thoughtful, and quick to worry or overthink, but deeply steady when they feel nourished and held',
  Metal: 'precise, discerning, and quick to feel grief or letting-go, but clear and principled when they have room to refine',
  Water: 'deep, quiet, and quick to feel fear or anxiety, but wise and resilient when they can rest in their own depth',
};

export function scoreTCM(emotionalStateElement: TcmElement, _climateElement: TcmElement): TcmElement {
  return emotionalStateElement;
}

function resultCopy(element: TcmElement): string {
  return `Your dominant element is ${element} — ${TCM_ELEMENT_LENS[element]}. This isn't a box — just one lens DOST can use to understand you better.`;
}

export default function TCMScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ViewMode>('emotion');
  const [emotionalState, setEmotionalState] = useState<(typeof TCM_EMOTIONAL_STATES)[number] | null>(
    null,
  );
  const [climatePreference, setClimatePreference] = useState<
    (typeof TCM_CLIMATE_PREFERENCES)[number] | null
  >(null);
  const [saving, setSaving] = useState(false);

  const resultElement =
    emotionalState != null && climatePreference != null
      ? scoreTCM(emotionalState.element, climatePreference.element)
      : null;

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate('MBTI', { ...route.params });
  });

  const onSkip = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await skipTcmModule();
    } finally {
      setSaving(false);
      exitStep();
    }
  };

  const onContinueFromResult = async () => {
    if (saving || emotionalState == null || climatePreference == null || resultElement == null) {
      return;
    }
    setSaving(true);
    try {
      const saved = await saveTcmResult({
        tcm_element: resultElement,
        tcm_emotional_state: emotionalState.label,
        tcm_climate_preference: climatePreference.label,
      });
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

  const showSkip = mode === 'emotion' || mode === 'climate';

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
        {mode === 'emotion' ? (
          <>
            <Text style={styles.eyebrow}>1 of 2</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              When a feeling arrives first, which one is it usually?
            </Text>
            <Text style={styles.screenLead}>
              There is no right answer — pick the one that feels most familiar.
            </Text>
            {TCM_EMOTIONAL_STATES.map((option) => {
              const selected = emotionalState?.label === option.label;
              return (
                <GentlePressable
                  key={option.element}
                  onPress={() => {
                    setEmotionalState(option);
                    setMode('climate');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'climate' ? (
          <>
            <Text style={styles.eyebrow}>2 of 2</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              Which climate feels most like home?
            </Text>
            <Text style={styles.screenLead}>
              Think of where your body settles, not where you live right now.
            </Text>
            {TCM_CLIMATE_PREFERENCES.map((option) => {
              const selected = climatePreference?.label === option.label;
              return (
                <GentlePressable
                  key={option.element}
                  onPress={() => {
                    setClimatePreference(option);
                    setMode('result');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'result' && resultElement != null ? (
          <>
            <Text style={styles.eyebrow}>{resultElement}</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              A lens, not a box
            </Text>
            <Text style={styles.copyLeft}>{resultCopy(resultElement)}</Text>
          </>
        ) : null}
      </ScrollView>

      {showSkip ? (
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
