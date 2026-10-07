import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { colors, fonts, type as typography } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

const SIZE = typography.body.fontSize * 3;
const FADE_IN_MS = 900;
const BREATH_MS = 2200;

/** The large "Starting gently…" line on the launch screen. */
export default function StartingText({ children }: { children: string }) {
  const reduceMotion = useReducedMotion();
  const appear = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(1);
      breath.setValue(0);
      return;
    }
    const fadeIn = Animated.timing(appear, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    fadeIn.start(() => breathe.start());
    return () => {
      fadeIn.stop();
      breathe.stop();
    };
  }, [appear, breath, reduceMotion]);

  const opacity = Animated.multiply(
    appear,
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }),
  );
  const translateY = appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <Animated.Text
      accessibilityLiveRegion="polite"
      numberOfLines={3}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      style={[styles.text, { opacity, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.display,
    fontSize: SIZE,
    lineHeight: Math.round(SIZE * 1.2),
    letterSpacing: 0.5,
    color: colors.cream,
    textAlign: 'center',
    textShadowColor: 'rgba(217, 168, 87, 0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
});
