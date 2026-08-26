import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  onContinue: () => void;
};

export default function PrivacyNoticeScreen({ onContinue }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 8 },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.copy}>
          Your reflections are stored securely and used only to make DOST more helpful to you. You can delete everything anytime.
        </Text>
        <Pressable onPress={onContinue} style={styles.button}>
          <Text style={styles.buttonText}>Continue</Text>
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
