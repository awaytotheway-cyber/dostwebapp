import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import { labelForExtractedEmotion } from '../../lib/emotionalStates';
import { useI18n, type TKey } from '../../lib/i18n';
import type { DayResult } from '../../lib/patterns/daySummaryClient';
import type { Tone } from '../../lib/patterns/dayStrip';
import { colors, radius, spacing, type as typography } from '../../lib/theme';
import GentlePressable from '../GentlePressable';
import { dawn, TONE_COLORS } from './dawn';
import { dateOf } from './DayStrip';
import SoftLoading from './SoftLoading';

const SLIDE_PX = 24;
const DURATION_MS = 220;
const SWIPE_PX = 50;
// The native driver is unavailable on web; there it falls back to JS.
const NATIVE = Platform.OS !== 'web';

const TONE_KEYS: Record<Tone, TKey> = {
  light: 'journey.toneLight',
  mixed: 'journey.toneMixed',
  heavy: 'journey.toneHeavy',
};

type Props = {
  day: string;
  /** null while the first answer for this day is on its way. */
  result: DayResult | null;
  /** Which way the day changed, for the slide; null on first show. */
  direction: 'older' | 'newer' | null;
  reduceMotion: boolean;
  onSwipe: (direction: 'older' | 'newer') => void;
  onRetry: () => void;
};

/**
 * One day on Your Patterns: its date, feelings, tone and a few lines.
 * Changing day slides the card a little and cross-fades it; a summary
 * arriving fades in. With Reduce Motion on, it simply switches.
 */
export default function DayCard({ day, result, direction, reduceMotion, onSwipe, onRetry }: Props) {
  const { t, locale } = useI18n();
  const opacity = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion || !direction) {
      opacity.setValue(1);
      shift.setValue(0);
      return;
    }
    // Newer days come in from the right, older from the left.
    shift.setValue(direction === 'newer' ? SLIDE_PX : -SLIDE_PX);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
      Animated.timing(shift, { toValue: 0, duration: DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
    ]).start();
    // Only a change of day starts the slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const status = result?.status ?? 'loading';
  useEffect(() => {
    if (reduceMotion || status === 'loading') {
      contentOpacity.setValue(1);
      return;
    }
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: NATIVE }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, day]);

  // Read the latest handler at gesture time, not the one from first render.
  const swipeRef = useRef(onSwipe);
  swipeRef.current = onSwipe;
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only clearly horizontal drags, so the page still scrolls.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -SWIPE_PX) swipeRef.current('newer');
          else if (g.dx >= SWIPE_PX) swipeRef.current('older');
        },
      }),
    [],
  );

  const date = dateOf(day);
  const heading = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <Animated.View
      {...pan.panHandlers}
      accessibilityHint={t('journey.swipeHint')}
      style={[styles.card, { opacity, transform: [{ translateX: shift }] }]}
    >
      <View style={styles.headerRow}>
        <Text accessibilityRole="header" style={styles.date}>
          {heading}
        </Text>
        {result?.status === 'ok' ? <ToneMarker tone={result.tone} /> : null}
      </View>

      <Animated.View style={[styles.body, { opacity: contentOpacity }]}>
        {result === null ? (
          <SoftLoading label={t('journey.dayLoading')} />
        ) : result.status === 'ok' ? (
          <>
            <Feelings tokens={result.feelings} />
            <Text style={styles.summary}>{result.summary}</Text>
            <Text style={styles.provenance}>
              {t(result.isToday ? 'journey.daySoFar' : 'journey.dayFromMessages')}
            </Text>
            {result.safety ? (
              <View style={styles.support} accessibilityRole="alert">
                <Text style={styles.supportText}>{t('journey.daySupport')}</Text>
              </View>
            ) : null}
          </>
        ) : result.status === 'sparse' ? (
          <>
            <Feelings tokens={result.feelings} />
            <Text style={styles.quiet}>{t('journey.daySparse')}</Text>
          </>
        ) : result.status === 'empty' ? (
          <Text style={styles.quiet}>{t('journey.dayNoChat')}</Text>
        ) : result.status === 'capped' ? (
          <Text style={styles.quiet}>{t('journey.dayCapped')}</Text>
        ) : result.status === 'offline' ? (
          <Text style={styles.quiet}>{t('journey.dayOffline')}</Text>
        ) : (
          <View style={styles.errorWrap}>
            <Text style={styles.quiet}>{t('journey.dayError')}</Text>
            <GentlePressable
              accessibilityRole="button"
              accessibilityLabel={t('common.tryAgain')}
              onPress={onRetry}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryLabel}>{t('common.tryAgain')}</Text>
            </GentlePressable>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function ToneMarker({ tone }: { tone: Tone }) {
  const { t } = useI18n();
  const label = t(TONE_KEYS[tone]);
  return (
    <View style={styles.tone} accessibilityLabel={t('journey.toneA11y', { tone: label })}>
      <View style={[styles.toneDot, { backgroundColor: TONE_COLORS[tone] }]} />
      <Text style={styles.toneLabel}>{label}</Text>
    </View>
  );
}

function Feelings({ tokens }: { tokens: string[] }) {
  const { t } = useI18n();
  if (tokens.length === 0) return null;
  const labels = tokens.map((token) => labelForExtractedEmotion(token));
  return (
    <View style={styles.chips} accessibilityLabel={t('journey.feelingsA11y', { feelings: labels.join(', ') })}>
      {labels.map((label) => (
        <View key={label} style={styles.chip}>
          <Text style={styles.chipText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: dawn.card,
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dawn.border,
    padding: spacing.xl,
    gap: spacing.md,
    minHeight: 168,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  date: {
    flexShrink: 1,
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 18,
    lineHeight: 24,
    color: dawn.cream,
  },
  tone: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toneDot: { width: 10, height: 10, borderRadius: 5 },
  toneLabel: { ...typography.caption, color: dawn.sand },
  body: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dawn.border,
    backgroundColor: dawn.chipFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: { ...typography.caption, color: dawn.cream },
  summary: { ...typography.body, fontSize: 16, lineHeight: 26, color: dawn.cream },
  provenance: { ...typography.caption, color: dawn.clay, fontStyle: 'italic' },
  quiet: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: dawn.sand,
  },
  support: {
    borderWidth: 1,
    borderColor: colors.terracottaDash,
    backgroundColor: colors.terracottaWash,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  supportText: { ...typography.caption, color: dawn.cream, lineHeight: 18 },
  errorWrap: { gap: spacing.md },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: dawn.gold,
  },
  retryLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: dawn.gold,
    textAlign: 'center',
  },
  pressed: { opacity: 0.7 },
});
