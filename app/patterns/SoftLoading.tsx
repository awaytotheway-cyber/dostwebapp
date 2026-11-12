import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, type as typography } from '../../lib/theme';
import BreathingDot from '../BreathingDot';
import { dawn } from './dawn';

/** The breathing-dot loading line used across Your Patterns. */
export default function SoftLoading({ label }: { label: string }) {
  return (
    <View style={styles.loadingRow} accessibilityLabel={label}>
      <BreathingDot size={10} color={dawn.clay} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: dawn.sand,
    fontStyle: 'italic',
  },
});
