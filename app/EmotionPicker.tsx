import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  EMOTIONAL_STATES,
  hintForEmotionalState,
  labelForEmotionalState,
  type EmotionalStateToken,
} from '../lib/emotionalStates';
import { useI18n } from '../lib/i18n';
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
  const { t } = useI18n();
  const selectedLabel = selected == null ? null : labelForEmotionalState(selected);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={
          collapsed ? t('emotionPicker.showA11y') : t('emotionPicker.hideA11y')
        }
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('emotionPicker.title')}</Text>
          <Text style={styles.subtitle}>
            {selectedLabel
              ? t('emotionPicker.now', { label: selectedLabel })
              : t('emotionPicker.optional')}
          </Text>
        </View>
        <Text style={styles.chevron}>{collapsed ? '+' : '–'}</Text>
      </Pressable>

      {!collapsed ? (
        <>
          <Text style={styles.note}>{t('emotionPicker.note')}</Text>
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
              accessibilityLabel={t('emotionPicker.noneA11y')}
            >
              <Text
                style={[
                  styles.chipLabel,
                  selected == null && styles.chipLabelSelected,
                ]}
              >
                {t('emotionPicker.none')}
              </Text>
            </GentlePressable>
            {EMOTIONAL_STATES.map((token) => {
              const active = selected === token;
              const label = labelForEmotionalState(token);
              return (
                <GentlePressable
                  key={token}
                  onPress={() => onSelect(active ? null : token)}
                  style={[styles.chip, active && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                  accessibilityHint={hintForEmotionalState(token)}
                >
                  <Text
                    style={[styles.chipLabel, active && styles.chipLabelSelected]}
                  >
                    {label}
                  </Text>
                </GentlePressable>
              );
            })}
          </ScrollView>
          {selected ? (
            <Text style={styles.hint}>{hintForEmotionalState(selected)}</Text>
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
