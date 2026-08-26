import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChatNavigator from './app/ChatNavigator';
import PrivacyNoticeScreen from './app/PrivacyNoticeScreen';
import AuthErrorScreen from './app/AuthErrorScreen';
import OnboardingNavigator from './app/onboarding/OnboardingNavigator';
import { ensureAnonymousSession } from './lib/session';
import { loadMyProfile } from './lib/profile';
import { ONBOARDING_COMPLETE_KEY } from './lib/onboardingStorage';
import { initNotificationRouting } from './lib/notifications';

const PRIVACY_SEEN_KEY = '@dost/privacy_notice_seen';

type Gate = 'loading' | 'privacy' | 'auth_error' | 'onboarding' | 'chat';
type AuthErrorKind = 'anonymous_disabled' | 'other';

export default function App() {
  const [gate, setGate] = useState<Gate>('loading');
  const [authError, setAuthError] = useState<AuthErrorKind>('other');

  const startSession = useCallback(async () => {
    setGate('loading');
    const result = await ensureAnonymousSession();
    if (!result.ok) {
      setAuthError(result.kind);
      setGate('auth_error');
      return;
    }

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

  useEffect(() => {
    initNotificationRouting();
  }, []);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(PRIVACY_SEEN_KEY)
      .then(async (value) => {
        if (cancelled) return;
        if (value === 'true') {
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
    await startSession();
  };

  const onOnboardingFinished = () => {
    setGate('chat');
  };

  let screen: React.ReactNode;
  if (gate === 'loading') {
    screen = (
      <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center' }}>
        <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 16 }}>Starting…</Text>
      </View>
    );
  } else if (gate === 'privacy') {
    screen = <PrivacyNoticeScreen onContinue={onContinue} />;
  } else if (gate === 'auth_error') {
    screen = <AuthErrorScreen kind={authError} onRetry={startSession} />;
  } else if (gate === 'onboarding') {
    screen = <OnboardingNavigator onFinished={onOnboardingFinished} />;
  } else {
    screen = <ChatNavigator onStartOver={startSession} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ flex: 1 }}>{screen}</SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
