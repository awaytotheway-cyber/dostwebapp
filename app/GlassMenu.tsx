import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../lib/i18n';
import { colors, fonts, spacing } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';
import GentlePressable from './GentlePressable';
import GlassPanel from './GlassPanel';

export type GlassMenuItem = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  items: GlassMenuItem[];
  /** Distance from the top of the screen to the panel's top edge. */
  top: number;
};

const OPEN_MS = 220;
const CLOSE_MS = 160;

/**
 * Drop-down glass menu, drawn over the current screen (not a Modal) so the
 * Android blur can see the content behind it.
 */
export default function GlassMenu({ visible, onClose, items, top }: Props) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? OPEN_MS : CLOSE_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => anim.stop();
  }, [progress, reduceMotion, visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, visible]);

  if (!mounted) return null;

  const panelMotion = {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('menu.closeA11y')}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[styles.anchor, { top }, panelMotion]}
      >
        <GlassPanel blur intensity={60} style={styles.panel}>
          <View accessibilityRole="menu">
            {items.map((item, index) => (
              <GentlePressable
                key={item.key}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.iconWell}>
                  <Ionicons name={item.icon} size={19} color={colors.gold} />
                </View>
                <Text style={styles.label} numberOfLines={1}>
                  {item.label}
                </Text>
              </GentlePressable>
            ))}
          </View>
        </GlassPanel>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(14, 11, 10, 0.5)',
  },
  anchor: {
    position: 'absolute',
    right: spacing.xl,
    transformOrigin: 'top right',
  },
  panel: {
    width: 284,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    // iOS only: Android's elevation shadow would show through the glass.
    shadowOffset: { width: 0, height: 12 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(237, 228, 211, 0.14)',
  },
  rowPressed: {
    backgroundColor: 'rgba(237, 228, 211, 0.08)',
  },
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
  label: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.cream,
  },
});
