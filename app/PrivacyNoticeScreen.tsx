import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';

type Props = {
  onContinue: () => void;
};

export default function PrivacyNoticeScreen({ onContinue }: Props) {
  const insets = useSafeAreaInsets();

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
        <Text style={styles.eyebrow}>Private by design</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          A space that stays yours
        </Text>
        <Text style={styles.copy}>
          Your reflections are stored securely and used only to make DOST more helpful to you. You can delete everything anytime.
        </Text>
        <View style={styles.divider} />
        <GentlePressable
          accessibilityRole="button"
          onPress={onContinue}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Continue</Text>
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
    marginBottom: theme.spacing['2xl'],
  },
  eyebrow: {
    ...theme.type.label,
    color: theme.colors.gold,
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
  },
  divider: {
    width: theme.spacing['5xl'],
    height: 1,
    backgroundColor: theme.colors.divider,
    marginVertical: theme.spacing['2xl'],
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
