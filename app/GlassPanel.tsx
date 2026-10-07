import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { radius } from '../lib/theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Live-blur what sits behind the panel. Worth it over busy content (the
   * menu over Home); leave off over static backgrounds to spare old phones.
   */
  blur?: boolean;
  intensity?: number;
};

/** Frosted-glass surface: blur, a warm translucent tint, a soft sheen and a hairline edge. */
export default function GlassPanel({ children, style, blur = false, intensity = 50 }: Props) {
  return (
    <View style={[styles.frame, style]}>
      {blur ? (
        <BlurView
          intensity={intensity}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, blur ? styles.tintOverBlur : styles.tint]} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.16} />
            <Stop offset="0.4" stopColor="#FFFFFF" stopOpacity={0.04} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheen)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius['2xl'],
    borderWidth: 1,
    borderColor: 'rgba(237, 228, 211, 0.2)',
  },
  // Warm surfaceRaised (#2E2723) at partial opacity.
  tintOverBlur: { backgroundColor: 'rgba(46, 39, 35, 0.38)' },
  tint: { backgroundColor: 'rgba(46, 39, 35, 0.55)' },
});
