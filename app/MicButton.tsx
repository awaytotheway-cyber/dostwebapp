import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';
import GentlePressable from './GentlePressable';

export type MicUiState = 'idle' | 'starting' | 'listening' | 'processing';

type Props = {
  state: MicUiState;
  disabled?: boolean;
  onPress: () => void;
};

export default function MicButton({ state, disabled, onPress }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const listening = state === 'listening';
  const busy = state === 'starting' || state === 'processing';

  useEffect(() => {
    if (!listening || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [listening, pulse, reduceMotion]);

  useEffect(() => {
    if (listening) {
      AccessibilityInfo.announceForAccessibility('Listening');
    } else if (state === 'processing') {
      AccessibilityInfo.announceForAccessibility('Finishing voice input');
    }
  }, [listening, state]);

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.35],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });

  const label =
    state === 'listening'
      ? 'Stop listening'
      : state === 'processing' || state === 'starting'
        ? 'Voice input busy'
        : 'Voice input';

  return (
    <View style={styles.wrap}>
      {listening && !reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { opacity, transform: [{ scale }] }]}
        />
      ) : null}
      <GentlePressable
        onPress={onPress}
        disabled={disabled || busy}
        style={[
          styles.button,
          listening && styles.buttonActive,
          (disabled || busy) && styles.buttonDisabled,
        ]}
        accessibilityLabel={label}
        accessibilityHint="Tap to start speaking, tap again to stop. Only text is used — nothing is recorded."
        accessibilityState={{
          disabled: Boolean(disabled || busy),
          busy: listening || busy,
        }}
        hitSlop={8}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.olive} />
        ) : (
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={22}
            color={listening ? colors.onPrimary : colors.olive}
          />
        )}
      </GentlePressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.olive,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  buttonActive: {
    backgroundColor: colors.olive,
    borderColor: colors.olive,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
