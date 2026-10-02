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
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { colors, spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';
import { useI18n } from '../../lib/i18n';

const MAX_INTENTION = 200;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Intention'>;

export default function IntentionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [intention, setIntention] = useState('');

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
          contentContainerStyle={styles.centeredScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View>
            <Text accessibilityRole="header" style={styles.headingLeft}>
              {t('onboarding.intentionHeading')}
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={intention}
              onChangeText={(value) => setIntention(value.slice(0, MAX_INTENTION))}
              placeholder={t('onboarding.intentionPlaceholder')}
              placeholderTextColor={colors.clay}
              maxLength={MAX_INTENTION}
              multiline
              numberOfLines={3}
              blurOnSubmit={false}
              textAlignVertical="top"
              underlineColorAndroid="transparent"
            />
            <Text style={styles.helper}>{t('onboarding.intentionHelper')}</Text>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <GentlePressable
            onPress={() =>
              navigation.navigate('Birth', {
                name: route.params.name,
                intention: intention.trim(),
              })
            }
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{t('common.continue')}</Text>
          </GentlePressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
