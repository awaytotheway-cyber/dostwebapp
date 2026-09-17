import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { saveMyProfile } from '../../lib/profile';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Confirm'> & {
  onFinished: () => void;
};

export default function ConfirmScreen({ route, onFinished }: Props) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const {
    name,
    intention,
    dob,
    dobTime,
    birthCity,
    birthDistrict,
    birthState,
    birthCountry,
    dosha,
    doshaScores,
    dailyRhythm,
    hobbies,
    socialStyle,
  } = route.params;

  const onStart = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveMyProfile({
        name,
        intention,
        dob,
        dobTime,
        birthCity,
        birthDistrict,
        birthState,
        birthCountry,
        dosha,
        doshaScores,
        dailyRhythm,
        hobbies,
        socialStyle,
      });
      if (!result.ok) {
        Alert.alert('Could not save', result.message);
        return;
      }
      onFinished();
    } catch {
      Alert.alert('Could not save', 'Please try again.');
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
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Namaste, {name}. Whenever you're ready.
        </Text>
        <GentlePressable
          onPress={() => {
            void onStart();
          }}
          disabled={saving}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            saving && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Start'}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
