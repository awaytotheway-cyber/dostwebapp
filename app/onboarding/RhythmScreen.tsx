import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import GentlePressable from '../GentlePressable';
import { spacing } from '../../lib/theme';
import OnboardingProgress from './OnboardingProgress';
import PreferenceGlyph from './PreferenceGlyph';
import { onboardingStyles as styles } from './styles';
import type { DailyRhythm, OnboardingStackParamList } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Rhythm'>;

const OPTIONS: Array<{
  value: DailyRhythm;
  label: string;
  description: string;
}> = [
  {
    value: 'day',
    label: 'Early light',
    description: 'Mornings are when I feel clearest.',
  },
  {
    value: 'flexible',
    label: 'Through the day',
    description: 'My best hours shift with the day.',
  },
  {
    value: 'night',
    label: 'After dark',
    description: 'Evenings are when I come alive.',
  },
];

export default function RhythmScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [dailyRhythm, setDailyRhythm] = useState<DailyRhythm | null>(null);

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
        contentContainerStyle={styles.centeredScrollContent}
      >
        <Text style={styles.eyebrow}>Your natural rhythm</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          When do you feel most like yourself?
        </Text>
        <Text style={styles.screenLead}>Choose the part of the day that feels most naturally yours.</Text>
        {OPTIONS.map((option) => {
          const selected = dailyRhythm === option.value;
          return (
            <GentlePressable
              key={option.value}
              onPress={() => setDailyRhythm(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}. ${option.description}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                (selected || pressed) && styles.optionSelected,
              ]}
            >
              <View style={[styles.glyphFrame, selected && styles.glyphFrameSelected]}>
                <PreferenceGlyph name={option.value} selected={selected} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={styles.optionText}>{option.label}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
            </GentlePressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={() => {
            if (dailyRhythm) {
              navigation.navigate('Hobbies', { ...route.params, dailyRhythm });
            }
          }}
          disabled={!dailyRhythm}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            !dailyRhythm && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
