import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as shared } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { colors, spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';
import { useI18n } from '../../lib/i18n';

const MAX_NAME = 40;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Name'>;

export default function NameScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const canContinue = name.trim().length > 0;

  return (
    <View
      style={[
        shared.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={shared.contentTop}
          contentContainerStyle={shared.centeredScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View>
            <Text accessibilityRole="header" style={shared.headingLeft}>
              {t('onboarding.nameHeading')}
            </Text>
            <Text style={styles.subCopy}>{t('onboarding.nameSub')}</Text>
            <TextInput
              style={shared.input}
              value={name}
              onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
              placeholder={t('onboarding.namePlaceholder')}
              placeholderTextColor={colors.inkLight}
              maxLength={MAX_NAME}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="name"
              autoComplete="name"
              underlineColorAndroid="transparent"
              autoFocus
            />
          </View>
        </ScrollView>
        <View style={shared.footer}>
          <GentlePressable
            onPress={() => navigation.navigate('Intention', { name: name.trim() })}
            disabled={!canContinue}
            style={({ pressed }) => [
              shared.button,
              pressed && shared.buttonPressed,
              !canContinue && shared.buttonDisabled,
            ]}
          >
            <Text style={shared.buttonText}>{t('common.continue')}</Text>
          </GentlePressable>
          <Text style={styles.privacyNote}>{t('onboarding.privacyNote')}</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  subCopy: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
    marginBottom: spacing.xl,
  },
  privacyNote: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkLight,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
