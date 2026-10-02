import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { APP_LANGUAGES, NATIVE_LANGUAGE_NAMES, useI18n } from '../../lib/i18n';
import { colors, radius, spacing, type } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

const logoSource = require('../../assets/dost-logo.png');

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, setLanguage } = useI18n();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const presenceBreath = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    logoOpacity.stopAnimation();
    presenceBreath.stopAnimation();

    if (reduceMotion !== false) {
      logoOpacity.setValue(1);
      presenceBreath.setValue(0.45);
      return;
    }

    logoOpacity.setValue(0);
    presenceBreath.setValue(0);

    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 1800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(presenceBreath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(presenceBreath, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    breathing.start();

    return () => {
      breathing.stop();
      logoOpacity.stopAnimation();
    };
  }, [logoOpacity, presenceBreath, reduceMotion]);

  const presenceScale = presenceBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1.03],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      {/* Blush gradient blob at top */}
      <View style={styles.blushBlob} pointerEvents="none" />

      <View style={styles.content}>
        {/* Logo mark */}
        <Animated.View
          style={[
            styles.logoWrap,
            {
              opacity: logoOpacity,
              transform: [{ scale: presenceScale }],
            },
          ]}
          importantForAccessibility="no-hide-descendants"
        >
          <Image
            source={logoSource}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        <Text accessibilityRole="header" style={styles.heading}>
          {t('welcome.headingBefore')}
          <Text style={styles.dostName}>Dost</Text>
          {t('welcome.headingAfter')}
        </Text>
        <Text style={styles.copy}>{t('welcome.copy')}</Text>
        <View style={styles.langRow} accessibilityLabel={t('language.title')}>
          {APP_LANGUAGES.map((code) => (
            <GentlePressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: lang === code }}
              onPress={() => void setLanguage(code)}
              style={({ pressed }) => [
                styles.langChip,
                lang === code && styles.langChipActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.langChipText, lang === code && styles.langChipTextActive]}>
                {NATIVE_LANGUAGE_NAMES[code]}
              </Text>
            </GentlePressable>
          ))}
        </View>
        <GentlePressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Name')}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>{t('welcome.begin')}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.parchment,
    paddingHorizontal: spacing['2xl'],
  },
  blushBlob: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: colors.blush,
    opacity: 0.38,
    borderBottomLeftRadius: 120,
    borderBottomRightRadius: 120,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  logoWrap: {
    width: 88,
    height: 88,
    marginBottom: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius['2xl'],
  },
  heading: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 32,
    lineHeight: 38,
    color: colors.inkDark,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  dostName: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 32,
    lineHeight: 38,
    color: colors.terracotta,
  },
  copy: {
    ...type.reflectivePrompt,
    color: colors.inkMuted,
    textAlign: 'center',
    maxWidth: 340,
    marginBottom: spacing['3xl'],
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing['3xl'],
  },
  langChip: {
    borderWidth: 1,
    borderColor: colors.blush,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  langChipActive: {
    borderColor: colors.terracotta,
    backgroundColor: colors.blush,
  },
  langChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkMuted,
  },
  langChipTextActive: {
    color: colors.inkDark,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 180,
    minHeight: 52,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing.md,
    borderRadius: radius.cta,
    alignSelf: 'stretch',
    backgroundColor: colors.terracotta,
    shadowColor: colors.terracottaSoft,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: radius.md,
    elevation: 3,
  },
  buttonPressed: {
    backgroundColor: colors.terracottaSoft,
  },
  buttonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 22,
    color: colors.onTerracotta,
    letterSpacing: 0.2,
  },
});
