import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import { t as translate, useI18n } from '../lib/i18n';

WebBrowser.maybeCompleteAuthSession();

export const AUTH_REDIRECT_URI = makeRedirectUri({
  native: 'dost://auth/callback',
  scheme: 'dost',
  path: 'auth/callback',
});

type Notice =
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string }
  | null;

function getOAuthParams(input: string): URLSearchParams {
  const url = new URL(input);
  const params = new URLSearchParams(url.search);

  if (url.hash) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      params.set(key, value);
    });
  }

  return params;
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const { t } = useI18n();

  const continueWithGoogle = useCallback(async () => {
    if (loading) return;

    setLoading(true);
    setNotice(null);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: AUTH_REDIRECT_URI,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data.url) {
        setNotice({
          kind: 'error',
          message: translate('auth.couldNotStart'),
        });
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT_URI);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setNotice({
          kind: 'cancelled',
          message: translate('auth.cancelled'),
        });
        return;
      }

      if (result.type !== 'success') {
        setNotice({
          kind: 'error',
          message: translate('auth.didNotFinish'),
        });
        return;
      }

      const params = getOAuthParams(result.url);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (params.has('error') || params.has('error_code') || !accessToken || !refreshToken) {
        setNotice({
          kind: 'error',
          message: translate('auth.couldNotComplete'),
        });
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setNotice({
          kind: 'error',
          message: translate('auth.sessionFailed'),
        });
      }
    } catch {
      setNotice({
        kind: 'error',
        message: translate('auth.interrupted'),
      });
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return (
    <View style={styles.container}>
      <PaperGrain />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.xl,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t('auth.heading')}
          </Text>
          <Text style={styles.copy}>{t('auth.copy')}</Text>

          <GentlePressable
            accessibilityHint={t('auth.buttonHint')}
            accessibilityLabel={loading ? t('auth.openingA11y') : t('auth.continueWithGoogle')}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled: loading }}
            disabled={loading}
            onPress={continueWithGoogle}
            style={({ pressed }) => [
              styles.googleButton,
              pressed && !loading && styles.googleButtonPressed,
              loading && styles.googleButtonDisabled,
            ]}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.googleMark}
            >
              <Text style={styles.googleMarkText}>G</Text>
            </View>
            {loading ? <ActivityIndicator color={theme.colors.onPrimary} size="small" /> : null}
            <Text style={styles.googleButtonText}>
              {loading ? t('auth.opening') : t('auth.continueWithGoogle')}
            </Text>
          </GentlePressable>

          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              style={notice.kind === 'error' ? styles.error : styles.cancelled}
            >
              {notice.message}
            </Text>
          ) : null}

          <Text style={styles.privacy}>{t('auth.privacy')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.base,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing['2xl'],
  },
  content: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    alignItems: 'center',
  },
  heading: {
    ...theme.type.display,
    color: theme.colors.cream,
    maxWidth: 360,
    textAlign: 'center',
  },
  copy: {
    ...theme.type.body,
    color: theme.colors.sand,
    maxWidth: 380,
    marginTop: theme.spacing.lg,
    textAlign: 'center',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 52,
    marginTop: theme.spacing['3xl'],
    borderRadius: theme.radius.cta,
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  googleButtonPressed: {
    backgroundColor: theme.colors.goldSoft,
  },
  googleButtonDisabled: {
    opacity: 0.72,
  },
  googleMark: {
    alignItems: 'center',
    justifyContent: 'center',
    width: theme.spacing['3xl'],
    height: theme.spacing['3xl'],
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.onPrimary,
  },
  googleMarkText: {
    ...theme.type.label,
    color: theme.colors.gold,
    fontSize: theme.type.body.fontSize,
  },
  googleButtonText: {
    ...theme.type.label,
    color: theme.colors.onPrimary,
    fontSize: theme.type.body.fontSize,
  },
  error: {
    ...theme.type.caption,
    color: theme.colors.error,
    marginTop: theme.spacing.lg,
    textAlign: 'center',
  },
  cancelled: {
    ...theme.type.caption,
    color: theme.colors.sand,
    marginTop: theme.spacing.lg,
    textAlign: 'center',
  },
  privacy: {
    ...theme.type.caption,
    color: theme.colors.clay,
    maxWidth: 360,
    marginTop: theme.spacing['2xl'],
    textAlign: 'center',
  },
});
