import React from 'react';
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from '../lib/useReducedMotion';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
};

export default function GentlePressable({ style, ...props }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <Pressable
      {...props}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && styles.pressed,
        state.pressed && !reduceMotion && styles.pressedMotion,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.94,
  },
  pressedMotion: {
    transform: [{ scale: 0.97 }],
  },
});
