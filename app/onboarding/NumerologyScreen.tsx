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
  LIFE_PATH_NUMBERS,
  lifePathRevealCopy,
} from '../../lib/personality/numerology';
import {
  saveLifePathNumber,
  skipNumerologyModule,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';
import { useI18n } from '../../lib/i18n';
import { nextOnboardingRoute } from '../../lib/onboardingConfig';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Numerology'>;

export default function NumerologyScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const lifePathNumber = useMemo(() => {
    const dob = (route.params as { dob?: string } | undefined)?.dob;
    if (!dob) return null;
    const computed = calculateLifePathNumber(dob);
    return LIFE_PATH_NUMBERS.includes(computed) ? computed : null;
  }, [route.params]);

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate(...([nextOnboardingRoute('Numerology'), { ...route.params }] as never));
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
        <Text style={styles.eyebrow}>{t('numerology.eyebrow')}</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          {lifePathNumber != null
            ? t('numerology.lifePathNumber', { number: lifePathNumber })
            : t('numerology.lifePath')}
        </Text>
        <Text style={styles.copyLeft}>
          {lifePathNumber != null
            ? lifePathRevealCopy(lifePathNumber)
            : t('numerology.unreadable')}
        </Text>
        <Text style={styles.screenLead}>{t('numerology.lensNote')}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('numerology.skip')}
          onPress={() => {
            void onSkip();
          }}
          disabled={saving}
          style={styles.textLinkWrap}
        >
          <Text style={styles.textLink}>{t('numerology.skip')}</Text>
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
              {saving ? t('common.saving') : standalone ? t('common.save') : t('common.continue')}
            </Text>
          </GentlePressable>
        ) : null}
      </View>
    </View>
  );
}
