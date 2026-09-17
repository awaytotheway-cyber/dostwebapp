import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  EMOTIONAL_STATES,
  EMOTIONAL_STATE_HINTS,
  type EmotionalStateToken,
} from '../lib/emotionalStates';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import GentlePressable from './GentlePressable';

type Props = {
  selected: EmotionalStateToken | null;
  onSelect: (token: EmotionalStateToken | null) => void;
  collapsed?: boolean;
  onToggle?: () => void;
};

export default function EmotionPicker({
  selected,
  onSelect,
  collapsed = false,
  onToggle,
}: Props) {
  const selectedLabel =
    selected == null
      ? null
      : EMOTIONAL_STATES.find((s) => s.token === selected)?.label;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={
          collapsed
            ? 'Show how you are feeling options'
            : 'Hide how you are feeling options'
        }
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>How are you feeling?</Text>
          <Text style={styles.subtitle}>
            {selectedLabel
              ? `Now: ${selectedLabel}`
              : 'Optional — helps DOST meet you gently'}
          </Text>
        </View>
        <Text style={styles.chevron}>{collapsed ? '+' : '–'}</Text>
      </Pressable>

      {!collapsed ? (
        <>
          <Text style={styles.note}>
            Optional covering patterns — not diagnoses. Auto-tagging still runs
            on each message. Clear or change anytime.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <GentlePressable
              onPress={() => onSelect(null)}
              style={[styles.chip, selected == null && styles.chipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: selected == null }}
              accessibilityLabel="No emotional state selected"
            >
              <Text
                style={[
                  styles.chipLabel,
                  selected == null && styles.chipLabelSelected,
                ]}
              >
                None
              </Text>
            </GentlePressable>
            {EMOTIONAL_STATES.map((state) => {
              const active = selected === state.token;
              return (
                <GentlePressable
                  key={state.token}
                  onPress={() => onSelect(active ? null : state.token)}
                  style={[styles.chip, active && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={state.label}
                  accessibilityHint={EMOTIONAL_STATE_HINTS[state.token]}
                >
                  <Text
                    style={[styles.chipLabel, active && styles.chipLabelSelected]}
                  >
                    {state.label}
                  </Text>
                </GentlePressable>
              );
            })}
          </ScrollView>
          {selected ? (
            <Text style={styles.hint}>{EMOTIONAL_STATE_HINTS[selected]}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surfaceRaised,
    paddingBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerText: { flex: 1 },
  title: { ...typography.label, color: colors.cream },
  subtitle: { ...typography.caption, color: colors.sand, marginTop: spacing.xxs },
  chevron: {
    ...typography.label,
    color: colors.gold,
    fontSize: 18,
    lineHeight: 20,
    width: 20,
    textAlign: 'center',
  },
  note: {
    ...typography.caption,
    color: colors.sand,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  chips: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.olive,
    backgroundColor: colors.oliveWash,
  },
  chipLabel: { ...typography.label, color: colors.cream },
  chipLabelSelected: { color: colors.oliveSoft },
  hint: {
    ...typography.caption,
    color: colors.clay,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
  },
});
