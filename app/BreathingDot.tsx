import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

type Props = {
  size?: number;
  color?: string;
};

export default function BreathingDot({ size = 8, color = colors.gold }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    breath.stopAnimation();
    if (reduceMotion) {
      breath.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduceMotion]);

  const opacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48, 1],
  });
  const scale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1.12],
  });

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      pointerEvents="none"
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
