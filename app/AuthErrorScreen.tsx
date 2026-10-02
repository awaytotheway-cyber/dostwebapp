import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import { useI18n } from '../lib/i18n';

type Props = {
  kind: 'anonymous_disabled' | 'other';
  onRetry: () => void;
};

export default function AuthErrorScreen({ kind, onRetry }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const copy =
    kind === 'anonymous_disabled' ? t('authError.copyShort') : t('authError.copyLong');

  return (
    <ScrollView
      style={[
        styles.container,
        { paddingTop: insets.top },
      ]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.content}>
        <Text style={styles.brand}>DOST</Text>
        <View style={styles.statusLine} />
        <Text style={styles.eyebrow}>{t('authError.eyebrow')}</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('authError.heading')}
        </Text>
        <Text style={styles.copy}>{copy}</Text>
        <GentlePressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>{t('common.tryAgain')}</Text>
        </GentlePressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.base,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing['2xl'],
    paddingTop: theme.spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing['3xl'],
  },
  brand: {
    ...theme.type.heading,
    color: theme.colors.cream,
    letterSpacing: 2,
    marginBottom: theme.spacing.md,
  },
  statusLine: {
    width: theme.spacing['3xl'],
    height: theme.spacing.xxs,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
    marginBottom: theme.spacing.lg,
  },
  eyebrow: {
    ...theme.type.label,
    color: theme.colors.error,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.sm,
  },
  heading: {
    ...theme.type.heading,
    color: theme.colors.cream,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  copy: {
    ...theme.type.body,
    color: theme.colors.sand,
    textAlign: 'center',
    marginBottom: theme.spacing['2xl'],
  },
  button: {
    minHeight: theme.spacing['5xl'],
    minWidth: 148,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.md,
  },
  buttonPressed: {
    backgroundColor: theme.colors.goldSoft,
  },
  buttonText: {
    ...theme.type.label,
    color: theme.colors.onPrimary,
    fontSize: theme.type.body.fontSize,
  },
});
