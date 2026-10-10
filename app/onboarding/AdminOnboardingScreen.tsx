import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useI18n } from '../../lib/i18n';
import {
  fetchActiveAdminScreens,
  saveAdminAnswers,
  type AdminOnboardingAnswer,
  type AdminOnboardingScreen,
} from '../../lib/customOnboarding';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'AdminExtra'>;

/**
 * Paginates through every active admin-authored onboarding screen in
 * position order. If there are none, this step auto-advances to Confirm
 * so the user doesn't see an empty screen.
 *
 * Each screen stores its own answer locally; everything is upserted to
 * admin_onboarding_answers right before advancing to the next admin
 * screen, so partial progress survives a back-navigate.
 */
export default function AdminOnboardingScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const [screens, setScreens] = useState<AdminOnboardingScreen[] | null>(null);
  const [index, setIndex] = useState(0);
  const [textValue, setTextValue] = useState('');
  const [optionValue, setOptionValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const goToConfirm = useCallback(() => {
    navigation.navigate('Confirm', { ...route.params });
  }, [navigation, route.params]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveAdminScreens()
      .then((rows) => {
        if (cancelled) return;
        if (rows.length === 0) {
          goToConfirm();
          return;
        }
        setScreens(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadErr(err instanceof Error ? err.message : 'Could not load extra questions.');
      });
    return () => {
      cancelled = true;
    };
  }, [goToConfirm]);

  // Reset per-screen input when the index moves.
  useEffect(() => {
    setTextValue('');
    setOptionValue(null);
  }, [index]);

  const current = screens ? screens[index] : null;

  const canContinue = useMemo(() => {
    if (!current) return false;
    if (!current.is_required) return true;
    if (current.question_type === 'short_text') return textValue.trim().length > 0;
    return optionValue !== null;
  }, [current, textValue, optionValue]);

  const buildAnswer = (): AdminOnboardingAnswer | null => {
    if (!current) return null;
    if (current.question_type === 'short_text') {
      const trimmed = textValue.trim();
      if (!trimmed) return null;
      return { screen_id: current.id, answer_text: trimmed.slice(0, 500) };
    }
    if (!optionValue) return null;
    return { screen_id: current.id, answer_option: optionValue };
  };

  const onNext = async () => {
    if (!screens || !current || saving) return;
    setSaving(true);
    try {
      const answer = buildAnswer();
      if (answer) {
        const result = await saveAdminAnswers([answer]);
        if (!result.ok) {
          Alert.alert(t('common.couldNotSave'), result.message);
          return;
        }
      } else if (current.is_required) {
        return; // guard — shouldn't happen since canContinue blocks
      }

      if (index + 1 >= screens.length) {
        goToConfirm();
      } else {
        setIndex(index + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  const onSkip = async () => {
    if (!screens || !current || saving || current.is_required) return;
    if (index + 1 >= screens.length) {
      goToConfirm();
    } else {
      setIndex(index + 1);
    }
  };

  if (loadErr) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <OnboardingProgress />
        <View style={styles.content}>
          <Text style={styles.heading}>{t('common.couldNotSave')}</Text>
          <Text style={styles.copy}>{loadErr}</Text>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.continue')}
            onPress={goToConfirm}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{t('common.continue')}</Text>
          </GentlePressable>
        </View>
      </View>
    );
  }

  if (!current) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <OnboardingProgress />
        <View style={styles.content}>
          <Text style={styles.copy}>{t('common.saving')}</Text>
        </View>
      </View>
    );
  }

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
          <Text style={styles.eyebrow}>
            {screens && screens.length > 1
              ? `${index + 1} / ${screens.length}`
              : ' '}
          </Text>
          <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
            {current.title}
          </Text>
          {current.subtitle ? (
            <Text style={styles.screenLead}>{current.subtitle}</Text>
          ) : null}

          {current.question_type === 'short_text' ? (
            <TextInput
              style={styles.input}
              value={textValue}
              onChangeText={(v) => setTextValue(v.slice(0, 500))}
              placeholder=""
              placeholderTextColor={colors.clay}
              multiline={false}
              autoCorrect
              autoCapitalize="sentences"
              underlineColorAndroid="transparent"
            />
          ) : null}

          {current.question_type === 'single_choice' && current.options ? (
            <View style={{ marginTop: spacing.md }}>
              {current.options.map((opt) => {
                const selected = optionValue === opt.label;
                return (
                  <GentlePressable
                    key={opt.label}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected }}
                    onPress={() => setOptionValue(opt.label)}
                    style={({ pressed }) => [
                      styles.option,
                      styles.optionCard,
                      (selected || pressed) && styles.optionSelected,
                    ]}
                  >
                    <Text style={styles.optionText}>{opt.label}</Text>
                  </GentlePressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {!current.is_required ? (
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
          ) : null}
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.continue')}
            onPress={() => {
              void onNext();
            }}
            disabled={saving || !canContinue}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              (saving || !canContinue) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {saving ? t('common.saving') : t('common.continue')}
            </Text>
          </GentlePressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
