import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';
import GentlePressable from './GentlePressable';

type Props = {
  options: string[];
  onSelect: (value: string) => void;
  label: string;
  labelForOption?: (token: string) => string;
  disabled?: boolean;
};

export function SuggestionChips({
  options,
  onSelect,
  label,
  labelForOption,
  disabled = false,
}: Props) {
  const reduceMotion = useReducedMotion();
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    fade.stopAnimation();
    if (reduceMotion || disabled) {
      fade.setValue(disabled ? 0.42 : 1);
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [disabled, fade, reduceMotion]);

  if (!options || options.length === 0) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity: fade }]}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => (
          <GentlePressable
            key={option}
            style={styles.chip}
            onPress={() => onSelect(option)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              labelForOption ? labelForOption(option) : option
            }
          >
            <Text style={styles.chipText}>
              {labelForOption ? labelForOption(option) : option}
            </Text>
          </GentlePressable>
        ))}
        <GentlePressable
          style={[styles.chip, styles.chipMuted]}
          onPress={() => onSelect('__skip__')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Something else"
        >
          <Text style={styles.chipTextMuted}>Something else</Text>
        </GentlePressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.clay,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  chipText: {
    ...typography.label,
    color: colors.cream,
  },
  chipMuted: {
    borderColor: colors.clay,
    opacity: 0.85,
  },
  chipTextMuted: {
    ...typography.label,
    color: colors.sand,
  },
});
