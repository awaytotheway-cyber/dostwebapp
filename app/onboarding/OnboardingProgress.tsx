import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import GentlePressable from '../GentlePressable';
import { colors } from '../../lib/theme';
import {
  ENNEAGRAM_MODULE,
  MBTI_MODULE,
  NUMEROLOGY_MODULE,
  TCM_MODULE,
  VARNA_MODULE,
  skipRemainingPersonalityModules,
  type PersonalityModule,
} from '../../lib/personalityProfile';
import { onboardingStyles as styles } from './styles';
import type { OnboardingStackParamList } from './types';
import { useI18n } from '../../lib/i18n';

const STEPS = [
  'Name',
  'Intention',
  'Birth',
  'BirthPlace',
  'Dosha',
  'Enneagram',
  'Numerology',
  'TCM',
  'MBTI',
  'Varna',
  'AdminExtra',
  'Confirm',
] as const;

/** Name through Varna — the full counted stretch. */
const COUNTED_STEPS = 10;

const PERSONALITY_STEP_ROUTES = [
  'Enneagram',
  'Numerology',
  'TCM',
  'MBTI',
  'Varna',
] as const;

const MODULE_BY_ROUTE: Record<(typeof PERSONALITY_STEP_ROUTES)[number], PersonalityModule> = {
  Enneagram: ENNEAGRAM_MODULE,
  Numerology: NUMEROLOGY_MODULE,
  TCM: TCM_MODULE,
  MBTI: MBTI_MODULE,
  Varna: VARNA_MODULE,
};

function isPersonalityRoute(
  name: string,
): name is (typeof PERSONALITY_STEP_ROUTES)[number] {
  return (PERSONALITY_STEP_ROUTES as readonly string[]).includes(name);
}

export default function OnboardingProgress() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const route = useRoute();
  const current = STEPS.indexOf(route.name as (typeof STEPS)[number]);
  const [skippingAll, setSkippingAll] = useState(false);
  const { t } = useI18n();

  const standaloneEdit = Boolean(
    (route.params as { standalone?: boolean } | undefined)?.standalone,
  );

  if (current < 0 || standaloneEdit) {
    return (
      <View style={styles.progressSection}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.backPlain')}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.inkMuted} />
        </GentlePressable>
      </View>
    );
  }

  const onPersonalityStep = isPersonalityRoute(route.name);
  const stepLabel = t('onboarding.stepOf', { current: current + 1, total: COUNTED_STEPS });
  const showCountedLabel = onPersonalityStep;

  const skipAllRemaining = async () => {
    if (!onPersonalityStep || skippingAll) return;
    setSkippingAll(true);
    try {
      const skipped = await skipRemainingPersonalityModules(MODULE_BY_ROUTE[route.name]);
      if (!skipped.ok) {
        Alert.alert(t('common.couldNotSave'), skipped.message);
      }
    } finally {
      setSkippingAll(false);
      const params = route.params as OnboardingStackParamList['Confirm'] | undefined;
      navigation.navigate('AdminExtra', params as OnboardingStackParamList['AdminExtra']);
    }
  };

  return (
    <View style={styles.progressSection}>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('common.backPlain')}
        onPress={() => navigation.goBack()}
        hitSlop={10}
        style={styles.backButton}
      >
        <Ionicons name="chevron-back" size={22} color={colors.inkMuted} />
      </GentlePressable>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={
          showCountedLabel
            ? stepLabel
            : t('onboarding.stepOf', { current: current + 1, total: STEPS.length })
        }
        style={styles.progress}
      >
        {STEPS.map((step, index) => (
          <View
            key={step}
            style={[
              styles.progressDot,
              index <= current && styles.progressDotComplete,
              index === current && styles.progressDotCurrent,
            ]}
          />
        ))}
      </View>
      {showCountedLabel ? (
        <Text style={styles.progressCount} accessibilityElementsHidden>
          {stepLabel}
        </Text>
      ) : null}
      {onPersonalityStep ? (
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skipRemaining')}
          onPress={() => {
            void skipAllRemaining();
          }}
          disabled={skippingAll}
          style={styles.skipRemainingWrap}
        >
          <Text style={styles.skipRemainingText}>{t('onboarding.skipRemaining')}</Text>
        </GentlePressable>
      ) : null}
    </View>
  );
}
