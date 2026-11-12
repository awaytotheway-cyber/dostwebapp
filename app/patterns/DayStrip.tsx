import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type as typography } from '../../lib/theme';
import { useI18n } from '../../lib/i18n';
import type { DayCell } from '../../lib/patterns/dayStrip';
import GentlePressable from '../GentlePressable';
import { dawn, TONE_COLORS } from './dawn';

const CELL_WIDTH = 44;
const GAP = 6;
const STEP = CELL_WIDTH + GAP;

/** Noon on that local day, so no time zone can tip it onto another date. */
export function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

type Props = {
  cells: DayCell[];
  selected: string;
  onSelect: (day: string) => void;
  reduceMotion: boolean;
};

/**
 * The last 30 days, today on the right. A dot per day: the day's tone
 * colour once summarised, a soft filled dot for a day you chatted, a faint
 * ring for a day you didn't. The selected day stays in view.
 */
export default function DayStrip({ cells, selected, onSelect, reduceMotion }: Props) {
  const { t, locale } = useI18n();
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const index = cells.findIndex((c) => c.day === selected);

  useEffect(() => {
    if (!scroller.current || width <= 0 || index < 0) return;
    const x = Math.max(0, index * STEP - (width - CELL_WIDTH) / 2);
    scroller.current.scrollTo({ x, animated: !reduceMotion });
  }, [index, width, reduceMotion]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={styles.row}
    >
      {cells.map((cell) => {
        const date = dateOf(cell.day);
        const isSelected = cell.day === selected;
        const state = !cell.hasChats
          ? t('journey.cellNoChat')
          : cell.tone
          ? t(cell.tone === 'light' ? 'journey.toneLight' : cell.tone === 'mixed' ? 'journey.toneMixed' : 'journey.toneHeavy')
          : t('journey.cellChat');
        return (
          <GentlePressable
            key={cell.day}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={t('journey.cellA11y', {
              date: date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
              state,
            })}
            onPress={() => onSelect(cell.day)}
            style={[styles.cell, isSelected && styles.cellSelected]}
          >
            <Text style={[styles.weekday, isSelected && styles.textSelected]}>
              {date.toLocaleDateString(locale, { weekday: 'narrow' })}
            </Text>
            <Text style={[styles.dateNumber, isSelected && styles.textSelected]}>{date.getDate()}</Text>
            <View
              style={[
                styles.dot,
                cell.tone
                  ? { backgroundColor: TONE_COLORS[cell.tone], borderColor: TONE_COLORS[cell.tone] }
                  : cell.hasChats
                  ? styles.dotChatted
                  : styles.dotEmpty,
              ]}
            />
          </GentlePressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: GAP, paddingVertical: 2 },
  cell: {
    width: CELL_WIDTH,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  cellSelected: {
    backgroundColor: dawn.card,
    borderColor: dawn.selectedBorder,
  },
  weekday: { ...typography.caption, fontSize: 11, lineHeight: 14, color: dawn.clay },
  dateNumber: { ...typography.label, color: dawn.sand },
  textSelected: { color: dawn.cream },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  dotChatted: { backgroundColor: dawn.clay, borderColor: dawn.clay, opacity: 0.55 },
  dotEmpty: { backgroundColor: 'transparent', borderColor: dawn.border },
});
