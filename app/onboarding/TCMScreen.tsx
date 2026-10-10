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
import { t as translate, useI18n, type TKey } from '../../lib/i18n';
import { nextOnboardingRoute } from '../../lib/onboardingConfig';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'TCM'>;

type ViewMode = 'emotion' | 'climate' | 'result';

// `label` is the English text stored in the profile; `key` is what is shown.
export const TCM_EMOTIONAL_STATES: Array<{ label: string; key: TKey; element: TcmElement }> = [
  { label: 'I tend to feel anger or frustration first', key: 'tcm.emotion.Wood', element: 'Wood' },
  { label: 'I tend to feel joy or overexcitement first', key: 'tcm.emotion.Fire', element: 'Fire' },
  { label: 'I tend to feel worry or overthinking first', key: 'tcm.emotion.Earth', element: 'Earth' },
  { label: 'I tend to feel grief or sadness first', key: 'tcm.emotion.Metal', element: 'Metal' },
  { label: 'I tend to feel fear or anxiety first', key: 'tcm.emotion.Water', element: 'Water' },
];

export const TCM_CLIMATE_PREFERENCES: Array<{ label: string; key: TKey; element: TcmElement }> = [
  { label: 'Warm and dry', key: 'tcm.climate.Fire', element: 'Fire' },
  { label: 'Cool and breezy', key: 'tcm.climate.Wood', element: 'Wood' },
  { label: 'Humid and mild', key: 'tcm.climate.Earth', element: 'Earth' },
  { label: 'Crisp and clear', key: 'tcm.climate.Metal', element: 'Metal' },
  { label: 'Cold, I run warm naturally', key: 'tcm.climate.Water', element: 'Water' },
];

export function scoreTCM(emotionalStateElement: TcmElement, _climateElement: TcmElement): TcmElement {
  return emotionalStateElement;
}

function resultCopy(element: TcmElement): string {
  return translate('tcm.resultCopy', {
    element: translate(`tcm.elements.${element}` as TKey),
    lens: translate(`tcm.lens.${element}` as TKey),
  });
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
  const { t } = useI18n();

  const resultElement =
    emotionalState != null && climatePreference != null
      ? scoreTCM(emotionalState.element, climatePreference.element)
      : null;

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate(...([nextOnboardingRoute('TCM'), { ...route.params }] as never));
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
            <Text style={styles.eyebrow}>{t('tcm.step', { current: 1, total: 2 })}</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t('tcm.emotionHeading')}
            </Text>
            <Text style={styles.screenLead}>{t('tcm.emotionLead')}</Text>
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
                  accessibilityLabel={t(option.key)}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{t(option.key)}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'climate' ? (
          <>
            <Text style={styles.eyebrow}>{t('tcm.step', { current: 2, total: 2 })}</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t('tcm.climateHeading')}
            </Text>
            <Text style={styles.screenLead}>{t('tcm.climateLead')}</Text>
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
                  accessibilityLabel={t(option.key)}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    styles.optionCard,
                    (selected || pressed) && styles.optionSelected,
                  ]}
                >
                  <Text style={styles.optionText}>{t(option.key)}</Text>
                </GentlePressable>
              );
            })}
          </>
        ) : null}

        {mode === 'result' && resultElement != null ? (
          <>
            <Text style={styles.eyebrow}>{t(`tcm.elements.${resultElement}` as TKey)}</Text>
            <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
              {t('enneagram.lensNotBox')}
            </Text>
            <Text style={styles.copyLeft}>{resultCopy(resultElement)}</Text>
          </>
        ) : null}
      </ScrollView>

      {showSkip ? (
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
