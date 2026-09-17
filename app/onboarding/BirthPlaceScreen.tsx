import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DEFAULT_BIRTH_COUNTRY, emptyBirthPlace } from '../../lib/birthPlace';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import OnboardingCountryPicker from './OnboardingCountryPicker';
import { colors, spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

const FIELD_MAX = 80;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'BirthPlace'>;

export default function BirthPlaceScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [place, setPlace] = useState(emptyBirthPlace);

  const onContinue = () => {
    navigation.navigate('Dosha', {
      name: route.params.name,
      intention: route.params.intention,
      dob: route.params.dob,
      dobTime: route.params.dobTime,
      birthCity: place.birthCity.trim(),
      birthDistrict: place.birthDistrict.trim(),
      birthState: place.birthState.trim(),
      birthCountry: place.birthCountry.trim() || DEFAULT_BIRTH_COUNTRY,
    });
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.contentTop}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text accessibilityRole="header" style={styles.headingLeft}>
            Where were you born?
          </Text>
          <Text style={styles.helper}>
            Optional, but it helps. You can skip any field and change this later in Settings.
          </Text>

          <Text style={styles.fieldLabel}>City</Text>
          <TextInput
            style={styles.input}
            value={place.birthCity}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthCity: value.slice(0, FIELD_MAX) }))
            }
            placeholder="City"
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>District</Text>
          <TextInput
            style={styles.input}
            value={place.birthDistrict}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthDistrict: value.slice(0, FIELD_MAX) }))
            }
            placeholder="District"
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>State</Text>
          <TextInput
            style={styles.input}
            value={place.birthState}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthState: value.slice(0, FIELD_MAX) }))
            }
            placeholder="State"
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>Country</Text>
          <OnboardingCountryPicker
            value={place.birthCountry}
            onChange={(birthCountry) => setPlace((prev) => ({ ...prev, birthCountry }))}
          />
        </ScrollView>
        <View style={styles.footer}>
          <GentlePressable
            onPress={onContinue}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </GentlePressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
