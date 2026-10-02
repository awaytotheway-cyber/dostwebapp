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
import { useI18n, type TKey } from '../../lib/i18n';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Rhythm'>;

const OPTIONS: DailyRhythm[] = ['day', 'flexible', 'night'];

export default function RhythmScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
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
        <Text style={styles.eyebrow}>{t('onboarding.rhythmEyebrow')}</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          {t('onboarding.rhythmHeading')}
        </Text>
        <Text style={styles.screenLead}>{t('onboarding.rhythmLead')}</Text>
        {OPTIONS.map((value) => {
          const option = {
            value,
            label: t(`rhythm.${value}.label` as TKey),
            description: t(`rhythm.${value}.description` as TKey),
          };
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
          <Text style={styles.buttonText}>{t('common.continue')}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
