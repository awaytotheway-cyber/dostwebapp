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
  calculateLifePathNumber,
  LIFE_PATH_THEMES,
  lifePathRevealCopy,
} from '../../lib/personality/numerology';
import {
  saveLifePathNumber,
  skipNumerologyModule,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Numerology'>;

export default function NumerologyScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);

  const lifePathNumber = useMemo(() => {
    const dob = (route.params as { dob?: string } | undefined)?.dob;
    if (!dob) return null;
    const computed = calculateLifePathNumber(dob);
    return LIFE_PATH_THEMES[computed] != null ? computed : null;
  }, [route.params]);

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate('TCM', { ...route.params });
  });

  const onSkip = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await skipNumerologyModule();
    } finally {
      setSaving(false);
      exitStep();
    }
  };

  const onContinue = async () => {
    if (saving) return;
    if (lifePathNumber == null) {
      await onSkip();
      return;
    }
    setSaving(true);
    try {
      const saved = await saveLifePathNumber(lifePathNumber);
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
        <Text style={styles.eyebrow}>From your birth date</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          {lifePathNumber != null ? `Life Path ${lifePathNumber}` : 'Life Path'}
        </Text>
        <Text style={styles.copyLeft}>
          {lifePathNumber != null
            ? lifePathRevealCopy(lifePathNumber)
            : 'We could not read a life path from this birth date. You can skip this and continue.'}
        </Text>
        <Text style={styles.screenLead}>
          This is just one lens — not a prediction, and not something you have to keep.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel="Skip / I'd rather not see this"
          onPress={() => {
            void onSkip();
          }}
          disabled={saving}
          style={styles.textLinkWrap}
        >
          <Text style={styles.textLink}>Skip / I'd rather not see this</Text>
        </GentlePressable>
        {lifePathNumber != null ? (
          <GentlePressable
            onPress={() => {
              void onContinue();
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
        ) : null}
      </View>
    </View>
  );
}
