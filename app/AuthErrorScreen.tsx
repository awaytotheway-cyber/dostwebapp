import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  kind: 'anonymous_disabled' | 'other';
  onRetry: () => void;
};

export default function AuthErrorScreen({ kind, onRetry }: Props) {
  const insets = useSafeAreaInsets();
  const copy =
    kind === 'anonymous_disabled'
      ? 'Anonymous sign-in is turned off. In your DOST Supabase project, open Dashboard → Authentication → Providers → Anonymous and turn it on. Then tap Try again.'
      : "Couldn't start a private session. Check your internet and try again. If it still fails, turn on Anonymous sign-ins in Supabase Dashboard → Authentication → Providers → Anonymous.";

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 8 },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.copy}>{copy}</Text>
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  copy: {
    fontSize: 18,
    lineHeight: 26,
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    alignSelf: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
