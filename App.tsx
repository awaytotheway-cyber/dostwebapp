import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChatNavigator from './app/ChatNavigator';
import FontLoadingScreen from './app/FontLoadingScreen';
import PrivacyNoticeScreen from './app/PrivacyNoticeScreen';
import AuthScreen from './app/AuthScreen';
import AuthErrorScreen from './app/AuthErrorScreen';
import BreathingDot from './app/BreathingDot';
import OnboardingNavigator from './app/onboarding/OnboardingNavigator';
import { I18nProvider, initI18n, t } from './lib/i18n';
import { loadMyProfile } from './lib/profile';
import { ONBOARDING_COMPLETE_KEY } from './lib/onboardingStorage';
import { initNotificationRouting } from './lib/notifications';
import { ensureAnonymousSession } from './lib/session';
import { supabase } from './lib/supabase';
import theme from './lib/theme';

const PRIVACY_SEEN_KEY = '@dost/privacy_notice_seen';

/**
 * For now: skip Google sign-in. Silently obtain a Supabase session via
 * anonymous auth so edge functions still receive a JWT.
 * Flip to true later to restore AuthScreen as the landing gate.
 */
const REQUIRE_GOOGLE_AUTH = false;

type Gate =
  | 'loading'
  | 'privacy'
  | 'auth'
  | 'auth_error'
  | 'onboarding'
  | 'chat';

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [i18nReady, setI18nReady] = useState(false);
  const [gate, setGate] = useState<Gate>('loading');
  const [authErrorKind, setAuthErrorKind] = useState<
    'anonymous_disabled' | 'other'
  >('other');
  const privacyAcceptedRef = useRef(false);

  const routeAuthenticatedSession = useCallback(async () => {
    const profileLoad = await loadMyProfile();
    if (profileLoad.ok) {
      if (profileLoad.profile) {
        await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
        setGate('chat');
        return;
      }
      await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
      setGate('onboarding');
      return;
    }

    const flag = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
    setGate(flag === 'true' ? 'chat' : 'onboarding');
  }, []);

  const startSession = useCallback(async () => {
    setGate('loading');

    if (REQUIRE_GOOGLE_AUTH) {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setGate('auth');
        return;
      }
      await routeAuthenticatedSession();
      return;
    }

    const sessionResult = await ensureAnonymousSession();
    if (!sessionResult.ok) {
      setAuthErrorKind(sessionResult.kind);
      setGate('auth_error');
      return;
    }

    await routeAuthenticatedSession();
  }, [routeAuthenticatedSession]);

  useEffect(() => {
    initNotificationRouting();
    void initI18n().then(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!privacyAcceptedRef.current || event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT' || !session) {
        if (REQUIRE_GOOGLE_AUTH) {
          setGate('auth');
          return;
        }
        // Re-establish an anonymous session instead of Google login.
        setTimeout(() => {
          void startSession();
        }, 0);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        setGate('loading');
        setTimeout(() => {
          void routeAuthenticatedSession();
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, [routeAuthenticatedSession, startSession]);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(PRIVACY_SEEN_KEY)
      .then(async (value) => {
        if (cancelled) return;
        if (value === 'true') {
          privacyAcceptedRef.current = true;
          await startSession();
          return;
        }
        setGate('privacy');
      })
      .catch(() => {
        if (!cancelled) setGate('privacy');
      });

    return () => {
      cancelled = true;
    };
  }, [startSession]);

  const onContinue = async () => {
    await AsyncStorage.setItem(PRIVACY_SEEN_KEY, 'true');
    privacyAcceptedRef.current = true;
    await startSession();
  };

  const onOnboardingFinished = () => {
    setGate('chat');
  };

  if (!fontsLoaded || !i18nReady) {
    return <FontLoadingScreen />;
  }

  let screen: React.ReactNode;
  if (gate === 'loading') {
    screen = (
      <View style={styles.loading}>
        <Image
          source={require('./assets/dost-logo.png')}
          style={styles.loadingLogo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <BreathingDot size={10} color={theme.colors.terracottaDot} />
        <Text accessibilityLiveRegion="polite" style={styles.loadingCopy}>
          {t('app.starting')}
        </Text>
      </View>
    );
  } else if (gate === 'privacy') {
    screen = <PrivacyNoticeScreen onContinue={onContinue} />;
  } else if (gate === 'auth') {
    screen = <AuthScreen />;
  } else if (gate === 'auth_error') {
    screen = (
      <AuthErrorScreen kind={authErrorKind} onRetry={() => void startSession()} />
    );
  } else if (gate === 'onboarding') {
    screen = <OnboardingNavigator onFinished={onOnboardingFinished} />;
  } else {
    screen = <ChatNavigator onStartOver={startSession} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <I18nProvider>
        <SafeAreaProvider style={{ flex: 1 }}>{screen}</SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.base,
    paddingHorizontal: theme.spacing['2xl'],
  },
  loadingLogo: {
    width: 72,
    height: 72,
    borderRadius: 16,
  },
  loadingCopy: {
    ...theme.type.body,
    color: theme.colors.sand,
    textAlign: 'center',
  },
});
