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
import { useI18n } from '../../lib/i18n';
import { nextOnboardingRoute } from '../../lib/onboardingConfig';

const FIELD_MAX = 80;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'BirthPlace'>;

export default function BirthPlaceScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [place, setPlace] = useState(emptyBirthPlace);

  const onContinue = () => {
    navigation.navigate(...([nextOnboardingRoute('BirthPlace'), {
      ...route.params,
      birthCity: place.birthCity.trim(),
      birthDistrict: place.birthDistrict.trim(),
      birthState: place.birthState.trim(),
      birthCountry: place.birthCountry.trim() || DEFAULT_BIRTH_COUNTRY,
    }] as never));
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
            {t('onboarding.birthPlaceHeading')}
          </Text>
          <Text style={styles.helper}>{t('onboarding.birthPlaceHelper')}</Text>

          <Text style={styles.fieldLabel}>{t('settings.city')}</Text>
          <TextInput
            style={styles.input}
            value={place.birthCity}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthCity: value.slice(0, FIELD_MAX) }))
            }
            placeholder={t('settings.city')}
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>{t('settings.district')}</Text>
          <TextInput
            style={styles.input}
            value={place.birthDistrict}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthDistrict: value.slice(0, FIELD_MAX) }))
            }
            placeholder={t('settings.district')}
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>{t('settings.state')}</Text>
          <TextInput
            style={styles.input}
            value={place.birthState}
            onChangeText={(value) =>
              setPlace((prev) => ({ ...prev, birthState: value.slice(0, FIELD_MAX) }))
            }
            placeholder={t('settings.state')}
            placeholderTextColor={colors.clay}
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.fieldLabel}>{t('settings.country')}</Text>
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
            <Text style={styles.buttonText}>{t('common.continue')}</Text>
          </GentlePressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
