import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, type as typography } from '../lib/theme';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import { useI18n } from '../lib/i18n';

type Props = {
  title: string;
  onBack: () => void;
};

/** Minimal Dawn Earth placeholder until the real screen is built. */
export default function RouteStubScreen({ title, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      <PaperGrain />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.backPlain')}
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.back}>{t('common.backPlain')}</Text>
        </GentlePressable>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  back: {
    ...typography.label,
    color: colors.sand,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    ...typography.heading,
    color: colors.cream,
    textAlign: 'center',
  },
});
