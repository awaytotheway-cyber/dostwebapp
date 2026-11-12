import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../lib/i18n';
import { fetchDaySummary, loadDayCells, type DayResult } from '../../lib/patterns/daySummaryClient';
import {
  defaultSelectedDay,
  localDayKey,
  neighbourDay,
  type DayCell,
} from '../../lib/patterns/dayStrip';
import { radius, spacing, type as typography } from '../../lib/theme';
import { useReducedMotion } from '../../lib/useReducedMotion';
import GentlePressable from '../GentlePressable';
import { dawn } from './dawn';
import DayCard from './DayCard';
import DayStrip from './DayStrip';
import SoftLoading from './SoftLoading';

/**
 * "Day by day" at the top of Your Patterns: the 30-day strip and the
 * selected day's card. A day's summary is fetched the first time it is
 * opened; today's is fetched again each time the screen comes back into
 * view, because it changes as you talk.
 */
export default function DayView() {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [cells, setCells] = useState<DayCell[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [direction, setDirection] = useState<'older' | 'newer' | null>(null);
  const [results, setResults] = useState<Record<string, DayResult>>({});
  const [stripFailed, setStripFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Days already asked for while this screen has been in view.
  const requested = useRef(new Set<string>());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      requested.current.delete(localDayKey(new Date()));
      void (async () => {
        let next: DayCell[];
        try {
          next = await loadDayCells();
        } catch {
          // Not "no chats": the days couldn't be read. Say so, offer a retry.
          if (active) setStripFailed(true);
          return;
        }
        if (!active) return;
        setStripFailed(false);
        setCells(next);
        setSelected((prev) => (prev && next.some((c) => c.day === prev) ? prev : defaultSelectedDay(next)));
      })();
      return () => {
        active = false;
      };
    }, [attempt]),
  );

  const load = useCallback(async (day: string) => {
    requested.current.add(day);
    const result = await fetchDaySummary(day, day === localDayKey(new Date()));
    setResults((prev) => ({ ...prev, [day]: result }));
    // Keep the strip's dot in step with what the card now shows.
    if (result.status === 'ok' || result.status === 'empty') {
      setCells((prev) =>
        prev?.map((c) =>
          c.day !== day
            ? c
            : result.status === 'ok'
            ? { ...c, hasChats: true, tone: result.tone }
            : { ...c, hasChats: false, tone: null },
        ) ?? prev,
      );
    }
  }, []);

  const selectedCell = cells?.find((c) => c.day === selected) ?? null;

  useEffect(() => {
    if (!selectedCell || !selectedCell.hasChats) return;
    if (requested.current.has(selectedCell.day)) return;
    void load(selectedCell.day);
  }, [selectedCell, load]);

  const select = useCallback(
    (day: string) => {
      if (!selected || day === selected) return;
      setDirection(day > selected ? 'newer' : 'older');
      setSelected(day);
    },
    [selected],
  );

  const swipe = useCallback(
    (dir: 'older' | 'newer') => {
      if (!cells || !selected) return;
      const next = neighbourDay(cells, selected, dir);
      if (next) select(next);
    },
    [cells, selected, select],
  );

  const retry = useCallback(() => {
    if (!selected) return;
    setResults((prev) => {
      const { [selected]: _dropped, ...rest } = prev;
      return rest;
    });
    void load(selected);
  }, [selected, load]);

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {t('journey.dayViewTitle')}
      </Text>
      <Text style={styles.sectionHint}>{t('journey.dayViewHint')}</Text>
      {stripFailed && !cells ? (
        <View style={styles.failed}>
          <Text style={styles.failedText}>{t('journey.daysLoadFailed')}</Text>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.tryAgain')}
            onPress={() => {
              setStripFailed(false);
              setAttempt((n) => n + 1);
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryLabel}>{t('common.tryAgain')}</Text>
          </GentlePressable>
        </View>
      ) : cells && selected && selectedCell ? (
        <>
          <DayStrip cells={cells} selected={selected} onSelect={select} reduceMotion={reduceMotion} />
          <DayCard
            day={selected}
            result={selectedCell.hasChats ? results[selected] ?? null : { status: 'empty', day: selected }}
            direction={direction}
            reduceMotion={reduceMotion}
            onSwipe={swipe}
            onRetry={retry}
          />
        </>
      ) : (
        <SoftLoading label={t('journey.dayLoading')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionTitle: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    color: dawn.cream,
  },
  sectionHint: {
    ...typography.caption,
    color: dawn.sand,
    marginTop: -spacing.xs,
  },
  failed: { gap: spacing.md },
  failedText: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: dawn.sand,
  },
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
