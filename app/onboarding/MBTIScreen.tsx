import React, { useState } from 'react';
import {
  Alert,
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
import {
  isStandardMbtiType,
  saveMbtiType,
  skipMbtiModule,
} from '../../lib/personalityProfile';
import { usePersonalityStepExit } from './usePersonalityStepExit';
import { useI18n } from '../../lib/i18n';
import { nextOnboardingRoute } from '../../lib/onboardingConfig';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'MBTI'>;

export default function MBTIScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const trimmed = value.trim();
  const showNonstandardNote = trimmed.length > 0 && !isStandardMbtiType(trimmed);

  const { standalone, exitStep } = usePersonalityStepExit(() => {
    navigation.navigate(...([nextOnboardingRoute('MBTI'), { ...route.params }] as never));
  });
  const canSave = trimmed.length > 0;

  const onSkip = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await skipMbtiModule();
    } finally {
      setSaving(false);
      exitStep();
    }
  };

  const onSave = async () => {
    if (saving) return;
    if (!trimmed) {
      await onSkip();
      return;
    }
    setSaving(true);
    try {
      const saved = await saveMbtiType(trimmed.toUpperCase());
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
          <Text style={styles.eyebrow}>{t('mbti.optional')}</Text>
          <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
            {t('mbti.heading')}
          </Text>
          <Text style={styles.screenLead}>{t('mbti.lead')}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={(next) => setValue(next.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8))}
            placeholder="INFP"
            placeholderTextColor={colors.clay}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            accessibilityLabel={t('mbti.inputA11y')}
            accessibilityHint={t('mbti.inputHint')}
            underlineColorAndroid="transparent"
          />
          {showNonstandardNote ? (
            <Text style={styles.fieldHint}>{t('mbti.nonstandard')}</Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.skip')}
            onPress={() => {
              void onSkip();
            }}
            disabled={saving}
            style={styles.textLinkWrap}
          >
            <Text style={styles.textLink}>{t('common.skip')}</Text>
          </GentlePressable>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={standalone ? t('mbti.saveType') : t('common.continue')}
            onPress={() => {
              void onSave();
            }}
            disabled={saving || !canSave}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              (saving || !canSave) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {saving ? t('common.saving') : standalone ? t('common.save') : t('common.continue')}
            </Text>
          </GentlePressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
