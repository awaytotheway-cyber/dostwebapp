import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { emptyBirthPlace } from '../../lib/birthPlace';
import CountryPicker from '../CountryPicker';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';

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
      birthCountry: place.birthCountry.trim() || 'India',
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.contentTop}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.headingLeft}>Where were you born?</Text>
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
            placeholderTextColor="#888"
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
            placeholderTextColor="#888"
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
            placeholderTextColor="#888"
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>Country</Text>
          <CountryPicker
            value={place.birthCountry}
            onChange={(birthCountry) => setPlace((prev) => ({ ...prev, birthCountry }))}
          />
        </ScrollView>
        <View style={styles.footer}>
          <Pressable onPress={onContinue} style={styles.button}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
