import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { saveMyProfile } from '../../lib/profile';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';

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
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.content}>
        <Text style={styles.heading}>Namaste, {name}. Whenever you're ready.</Text>
        <Pressable
          onPress={() => {
            void onStart();
          }}
          disabled={saving}
          style={[styles.button, saving && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Start'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
