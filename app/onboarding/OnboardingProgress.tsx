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
  skipRemainingPersonalityModules,
  type PersonalityModule,
} from '../../lib/personalityProfile';
import { onboardingStyles as styles } from './styles';
import type { OnboardingStackParamList } from './types';

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
  'Rhythm',
  'Hobbies',
  'SocialEnergy',
  'Confirm',
] as const;

/** Name through MBTI — the stretch with a defined end before rhythm. */
const COUNTED_THROUGH_MBTI = 9;

const PERSONALITY_STEP_ROUTES = ['Enneagram', 'Numerology', 'TCM', 'MBTI'] as const;

const MODULE_BY_ROUTE: Record<(typeof PERSONALITY_STEP_ROUTES)[number], PersonalityModule> = {
  Enneagram: ENNEAGRAM_MODULE,
  Numerology: NUMEROLOGY_MODULE,
  TCM: TCM_MODULE,
  MBTI: MBTI_MODULE,
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

  const standaloneEdit = Boolean(
    (route.params as { standalone?: boolean } | undefined)?.standalone,
  );

  if (current < 0 || standaloneEdit) {
    return (
      <View style={styles.progressSection}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel="Back"
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
  const stepLabel = `Step ${current + 1} of ${COUNTED_THROUGH_MBTI}`;
  const showCountedLabel = onPersonalityStep;

  const skipAllRemaining = async () => {
    if (!onPersonalityStep || skippingAll) return;
    setSkippingAll(true);
    try {
      const skipped = await skipRemainingPersonalityModules(MODULE_BY_ROUTE[route.name]);
      if (!skipped.ok) {
        Alert.alert('Could not save', skipped.message);
      }
    } finally {
      setSkippingAll(false);
      const params = route.params as OnboardingStackParamList['Rhythm'] | undefined;
      navigation.navigate('Rhythm', params as OnboardingStackParamList['Rhythm']);
    }
  };

  return (
    <View style={styles.progressSection}>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
        hitSlop={10}
        style={styles.backButton}
      >
        <Ionicons name="chevron-back" size={22} color={colors.inkMuted} />
      </GentlePressable>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={showCountedLabel ? stepLabel : `Step ${current + 1} of ${STEPS.length}`}
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
          accessibilityLabel="Skip all remaining personality steps"
          onPress={() => {
            void skipAllRemaining();
          }}
          disabled={skippingAll}
          style={styles.skipRemainingWrap}
        >
          <Text style={styles.skipRemainingText}>Skip all remaining personality steps</Text>
        </GentlePressable>
      ) : null}
    </View>
  );
}
