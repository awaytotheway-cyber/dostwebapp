import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import { useI18n, type TKey } from '../lib/i18n';
import { loadMyProfile } from '../lib/profile';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import BreathingDot from './BreathingDot';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';

const logoSource = require('../assets/dost-logo.png');

/** Dark home surface */
const home = {
  base: '#1A1614',
  tile: '#241E1B',
  tileEmphasized: '#2D2218',
  title: '#EDE4D3',
  description: '#C9B79C',
  muted: '#9A8878',
  border: 'rgba(237, 228, 211, 0.10)',
} as const;

type TimeOfDay = 'morning' | 'afternoon' | 'evening';
type Props = NativeStackScreenProps<ChatStackParamList, 'Home'>;

function getTimeOfDay(date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}


export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState<string | null>(null);
  const [pastChatCount, setPastChatCount] = useState<number | null>(null);
  const timeOfDay = useMemo(() => getTimeOfDay(), []);
  const { t, tn } = useI18n();
  const trimmedName = name?.trim();
  const greeting = trimmedName
    ? t(`home.greetingNamed.${timeOfDay}` as TKey, { name: trimmedName })
    : t(`home.greeting.${timeOfDay}` as TKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profileLoad = await loadMyProfile();
      if (cancelled) return;
      if (profileLoad.ok) {
        setName(profileLoad.profile?.name?.trim() || null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <PaperGrain />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing['2xl'],
          },
        ]}
      >
        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Image source={logoSource} style={styles.logoMark} resizeMode="contain" />
            <Text style={styles.brandName}>Dost</Text>
            <BreathingDot size={7} color={colors.terracottaDot} />
          </View>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('home.profile')}
            onPress={() => navigation.navigate('Profile')}
            hitSlop={10}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
          >
            <Ionicons name="person-outline" size={22} color={home.description} />
          </GentlePressable>
        </View>

        {/* ── Greeting ── */}
        <View style={styles.greetingBlock}>
          <Text accessibilityRole="header" style={styles.greeting}>
            {greeting}
          </Text>
          <Text style={styles.subGreeting}>{t(`home.subGreeting.${timeOfDay}` as TKey)}</Text>
        </View>

        {/* ── Main card: Talk to Dost ── */}
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={`${t('home.talkTitle')}. ${t('home.talkBody')}`}
          onPress={() => navigation.navigate('Chat', { newSession: true })}
          style={({ pressed }) => [styles.mainCard, pressed && styles.cardPressed]}
        >
          <View style={styles.mainCardHeader}>
            <Text style={styles.mainCardTitle}>{t('home.talkTitle')}</Text>
            <BreathingDot size={8} color={colors.terracottaDot} />
          </View>
          <Text style={styles.mainCardBody}>{t('home.talkBody')}</Text>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('home.startChat')}
            onPress={() => navigation.navigate('Chat', { newSession: true })}
            style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          >
            <Text style={styles.startButtonText}>{t('home.startChatArrow')}</Text>
          </GentlePressable>
        </GentlePressable>

        {/* ── Secondary tiles ── */}
        <View style={styles.tileRow}>
          {/* Voice note */}
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('home.voiceNoteA11y')}
            onPress={() => navigation.navigate('VoiceNoteRecord')}
            style={({ pressed }) => [styles.tile, pressed && styles.cardPressed]}
          >
            <View style={styles.tileIconWrap}>
              <Svg width={22} height={22} viewBox="0 0 28 28" accessible={false} focusable={false}>
                <Path
                  d="M14 5.5c-1.9 0-3.4 1.5-3.4 3.4v6.2c0 1.9 1.5 3.4 3.4 3.4s3.4-1.5 3.4-3.4V8.9c0-1.9-1.5-3.4-3.4-3.4Z"
                  fill="none"
                  stroke={home.description}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M8.2 13.2a5.8 5.8 0 0 0 11.6 0"
                  fill="none"
                  stroke={home.description}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Line
                  x1="14" y1="19" x2="14" y2="22.5"
                  stroke={home.description}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
            <Text style={styles.tileTitle}>{t('home.voiceNoteTitle')}</Text>
            <Text style={styles.tileDescription}>{t('home.voiceNoteBody')}</Text>
          </GentlePressable>

          {/* Past chats */}
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('home.pastChatsTitle')}
            onPress={() => navigation.navigate('PastReflections')}
            style={({ pressed }) => [styles.tile, pressed && styles.cardPressed]}
          >
            <View style={styles.tileIconWrap}>
              <Svg width={22} height={22} viewBox="0 0 28 28" accessible={false} focusable={false}>
                <Line x1="5" y1="8" x2="23" y2="8" stroke={home.description} strokeWidth={1.6} strokeLinecap="round" />
                <Line x1="5" y1="14" x2="20" y2="14" stroke={home.description} strokeWidth={1.6} strokeLinecap="round" />
                <Line x1="5" y1="20" x2="16" y2="20" stroke={home.description} strokeWidth={1.6} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.tileTitle}>{t('home.pastChatsTitle')}</Text>
            <Text style={styles.tileDescription}>
              {pastChatCount != null
                ? tn('home.pastChatsCount', pastChatCount)
                : t('home.pastChatsBody')}
            </Text>
          </GentlePressable>
        </View>

        {/* ── Listening session ── */}
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('home.listeningSessionA11y')}
          onPress={() => navigation.navigate('ListeningSession')}
          style={({ pressed }) => [styles.journeyRow, pressed && styles.cardPressed]}
        >
          <View style={styles.journeyLeft}>
            <Svg width={22} height={22} viewBox="0 0 28 28" accessible={false} focusable={false}>
              <Path
                d="M14 6c-2 0-3.6 1.6-3.6 3.6v6.8c0 2 1.6 3.6 3.6 3.6s3.6-1.6 3.6-3.6V9.6C17.6 7.6 16 6 14 6Z"
                fill="none"
                stroke={home.muted}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M8 14a6 6 0 0 0 12 0"
                fill="none"
                stroke={home.muted}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Line x1="14" y1="20" x2="14" y2="23" stroke={home.muted} strokeWidth={1.5} strokeLinecap="round" />
            </Svg>
            <Text style={styles.journeyLabel}>{t('home.listeningSession')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={home.muted} />
        </GentlePressable>

        {/* ── Your Journey ── */}
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('home.yourJourney')}
          onPress={() => navigation.navigate('YourJourney')}
          style={({ pressed }) => [styles.journeyRow, pressed && styles.cardPressed]}
        >
          <View style={styles.journeyLeft}>
            <Svg width={22} height={22} viewBox="0 0 28 28" accessible={false} focusable={false}>
              <Path
                d="M4 18.5c4.2-6.2 7.8-9.4 10-9.4s5.8 3.2 10 9.4"
                fill="none"
                stroke={home.muted}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Line x1="3.5" y1="18.5" x2="24.5" y2="18.5" stroke={home.muted} strokeWidth={1.5} strokeLinecap="round" />
            </Svg>
            <Text style={styles.journeyLabel}>{t('home.yourJourney')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={home.muted} />
        </GentlePressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: home.base,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    gap: spacing.lg,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 9,
  },
  brandName: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 17,
    lineHeight: 22,
    color: home.title,
    letterSpacing: 0.2,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    padding: spacing.xs,
  },
  iconPressed: {
    opacity: 0.65,
  },

  // Greeting
  greetingBlock: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  greeting: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 32,
    lineHeight: 38,
    color: home.title,
  },
  subGreeting: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: home.description,
  },

  // Main card
  mainCard: {
    backgroundColor: home.tileEmphasized,
    borderRadius: radius['2xl'],
    padding: spacing['2xl'],
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: home.border,
  },
  mainCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mainCardTitle: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 20,
    lineHeight: 26,
    color: home.title,
  },
  mainCardBody: {
    ...typography.body,
    color: home.description,
  },
  startButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    backgroundColor: colors.terracotta,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
  },
  startButtonPressed: {
    backgroundColor: colors.terracottaSoft,
  },
  startButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: colors.onTerracotta,
  },
  cardPressed: {
    opacity: 0.88,
  },

  // Secondary tiles
  tileRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tile: {
    flex: 1,
    backgroundColor: home.tile,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: home.border,
    minHeight: 120,
  },
  tileIconWrap: {
    marginBottom: spacing.xs,
  },
  tileTitle: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 15,
    lineHeight: 20,
    color: home.title,
  },
  tileDescription: {
    ...typography.caption,
    color: home.description,
    lineHeight: 18,
  },

  // Journey row
  journeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: home.tile,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: home.border,
  },
  journeyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  journeyLabel: {
    ...typography.label,
    fontSize: 16,
    lineHeight: 22,
    color: home.muted,
  },
});
