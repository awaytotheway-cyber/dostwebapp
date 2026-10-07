import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useI18n, type TKey } from '../lib/i18n';
import { colors, fonts, radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import GentlePressable from './GentlePressable';
import GlassPanel from './GlassPanel';
import PaperGrain from './PaperGrain';

type Props = NativeStackScreenProps<ChatStackParamList, 'About'>;

const logoSource = require('../assets/dost-logo.png');

const SECTIONS: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: TKey;
  body: TKey;
}[] = [
  { icon: 'leaf-outline', title: 'about.whatTitle', body: 'about.whatBody' },
  { icon: 'lock-closed-outline', title: 'about.privacyTitle', body: 'about.privacyBody' },
  { icon: 'heart-outline', title: 'about.careTitle', body: 'about.careBody' },
  { icon: 'text-outline', title: 'about.fontsTitle', body: 'about.fontsBody' },
];

export default function AboutScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.container}>
      <Glow />
      <PaperGrain />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing['4xl'] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.goBack')}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.sand} />
          <Text style={styles.backLabel}>{t('common.backPlain')}</Text>
        </GentlePressable>

        <GlassPanel style={styles.hero}>
          <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          <Text accessibilityRole="header" style={styles.title}>
            DOST
          </Text>
          <Text style={styles.tagline}>{t('about.tagline')}</Text>
          <View style={styles.versionPill}>
            <Text style={styles.versionText}>{t('about.version', { version })}</Text>
          </View>
        </GlassPanel>

        {SECTIONS.map((section) => (
          <GlassPanel key={section.title} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconWell}>
                <Ionicons name={section.icon} size={18} color={colors.gold} />
              </View>
              <Text style={styles.cardTitle}>{t(section.title)}</Text>
            </View>
            <Text style={styles.cardBody}>{t(section.body)}</Text>
          </GlassPanel>
        ))}
      </ScrollView>
    </View>
  );
}

/** Soft terracotta and gold light behind the glass. */
function Glow() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="warm" cx="15%" cy="12%" r="60%">
          <Stop offset="0" stopColor={colors.terracotta} stopOpacity={0.55} />
          <Stop offset="1" stopColor={colors.terracotta} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="gold" cx="90%" cy="55%" r="55%">
          <Stop offset="0" stopColor={colors.gold} stopOpacity={0.32} />
          <Stop offset="1" stopColor={colors.gold} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="olive" cx="20%" cy="95%" r="50%">
          <Stop offset="0" stopColor={colors.olive} stopOpacity={0.45} />
          <Stop offset="1" stopColor={colors.olive} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#warm)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#gold)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#olive)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
    gap: 2,
  },
  backLabel: { ...typography.label, color: colors.sand, fontSize: 15 },
  pressed: { opacity: 0.7 },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: spacing.sm },
  title: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 4,
    color: colors.cream,
  },
  tagline: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 28,
    color: colors.sand,
    textAlign: 'center',
  },
  versionPill: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217, 168, 87, 0.45)',
    backgroundColor: 'rgba(217, 168, 87, 0.1)',
  },
  versionText: { ...typography.caption, color: colors.gold },
  card: { padding: spacing.xl, gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(217, 168, 87, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217, 168, 87, 0.3)',
  },
  cardTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 17,
    lineHeight: 24,
    color: colors.cream,
  },
  cardBody: { ...typography.body, color: colors.sand },
});
