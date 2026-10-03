import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';
import { useI18n } from '../lib/i18n';

export const HEARING_DISCLOSURE_ACK_KEY = 'dost.hearing.disclosure.ack.v1';

type Props = NativeStackScreenProps<ChatStackParamList, 'HearingDisclosure'>;

export default function HearingDisclosureScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const returnTo = route.params?.returnTo;

  const onContinue = async () => {
    try {
      await AsyncStorage.setItem(HEARING_DISCLOSURE_ACK_KEY, new Date().toISOString());
    } catch {
      // ignore — user can re-ack next time
    }
    if (returnTo === 'ListeningSession') {
      navigation.replace('ListeningSession');
    } else {
      navigation.goBack();
    }
  };

  const onDecline = () => {
    navigation.goBack();
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{t('disclosure.eyebrow')}</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('disclosure.heading')}
        </Text>
        <Text style={styles.copy}>{t('disclosure.copy')}</Text>

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>{t('disclosure.sectionLabel')}</Text>
        <View style={styles.bulletList}>
          <Bullet>
            {t('disclosure.bullet1')}
          </Bullet>
          <Bullet>
            {t('disclosure.bullet2')}
          </Bullet>
          <Bullet>
            {t('disclosure.bullet3')}
          </Bullet>
          <Bullet>
            {t('disclosure.bullet4')}
          </Bullet>
        </View>

        <View style={styles.divider} />

        <Text style={styles.notice}>
          {t('disclosure.notice')}
        </Text>

        <View style={styles.actions}>
          <GentlePressable
            accessibilityRole="button"
            onPress={onContinue}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>{t('disclosure.continue')}</Text>
          </GentlePressable>
          <GentlePressable
            accessibilityRole="button"
            onPress={onDecline}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>{t('disclosure.notNow')}</Text>
          </GentlePressable>
        </View>
      </View>
    </ScrollView>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
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
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing['3xl'],
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
    marginBottom: theme.spacing.md,
  },
  copy: {
    ...theme.type.body,
    color: theme.colors.sand,
  },
  sectionLabel: {
    ...theme.type.label,
    color: theme.colors.cream,
    marginBottom: theme.spacing.md,
  },
  bulletList: {
    gap: theme.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletDot: {
    ...theme.type.body,
    color: theme.colors.gold,
    width: theme.spacing.lg,
    lineHeight: theme.type.body.lineHeight,
  },
  bulletText: {
    ...theme.type.body,
    color: theme.colors.sand,
    flex: 1,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: theme.colors.divider,
    marginVertical: theme.spacing['2xl'],
  },
  notice: {
    ...theme.type.body,
    color: theme.colors.clay,
    fontStyle: 'italic',
  },
  actions: {
    marginTop: theme.spacing['2xl'],
    gap: theme.spacing.md,
  },
  primaryButton: {
    minHeight: theme.spacing['5xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.md,
  },
  primaryButtonPressed: {
    backgroundColor: theme.colors.goldSoft,
  },
  primaryButtonText: {
    ...theme.type.label,
    color: theme.colors.onPrimary,
    fontSize: theme.type.body.fontSize,
  },
  secondaryButton: {
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
  },
  secondaryButtonPressed: {
    backgroundColor: theme.colors.logoutWash,
  },
  secondaryButtonText: {
    ...theme.type.label,
    color: theme.colors.sand,
    fontSize: theme.type.body.fontSize,
  },
});
