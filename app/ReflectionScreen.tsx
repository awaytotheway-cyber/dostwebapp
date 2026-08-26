import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from './chatTypes';
import { saveDailyIntentions } from '../lib/intentions';
import {
  requestNotificationPermission,
  scheduleMorningNoticings,
} from '../lib/notifications';

type Props = NativeStackScreenProps<ChatStackParamList, 'Reflection'>;

export default function ReflectionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const mode = route.params?.mode === 'noticings' ? 'noticings' : 'prompt';
  const [one, setOne] = useState('');
  const [two, setTwo] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => Boolean(one.trim() && two.trim()) && !saving, [one, two, saving]);

  const onYes = () => {
    navigation.navigate('Chat', { reflectionOpening: true });
  };

  const onNotTonight = () => {
    navigation.navigate('Chat');
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await saveDailyIntentions(one, two);
      if (!saved.ok) {
        Alert.alert('Could not save', saved.message);
        return;
      }

      const allowed = await requestNotificationPermission();
      if (allowed) {
        await scheduleMorningNoticings(saved.intentions, saved.forDate);
      }

      Alert.alert(
        'Saved',
        allowed
          ? "DOST will remind you in the morning. On Expo Go, that reminder may not appear."
          : 'Saved for tomorrow. Enable notifications later if you want a morning reminder.',
      );
      navigation.navigate('Chat');
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.flex, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
        </View>

        {mode === 'prompt' ? (
          <View style={styles.content}>
            <Text style={styles.heading}>Would you like to reflect on today?</Text>
            <Pressable onPress={onYes} style={styles.button}>
              <Text style={styles.buttonText}>Yes</Text>
            </Pressable>
            <Pressable onPress={onNotTonight} style={styles.secondary}>
              <Text style={styles.secondaryText}>Not tonight</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={styles.heading}>Two things to notice tomorrow</Text>
            <Text style={styles.copy}>Name two small things you'd like to notice.</Text>
            <TextInput
              style={styles.input}
              value={one}
              onChangeText={(value) => setOne(value.slice(0, 120))}
              placeholder="First noticing"
              placeholderTextColor="#888"
              maxLength={120}
              editable={!saving}
              autoCapitalize="sentences"
              underlineColorAndroid="transparent"
            />
            <TextInput
              style={styles.input}
              value={two}
              onChangeText={(value) => setTwo(value.slice(0, 120))}
              placeholder="Second noticing"
              placeholderTextColor="#888"
              maxLength={120}
              editable={!saving}
              autoCapitalize="sentences"
              underlineColorAndroid="transparent"
            />
            <Pressable
              onPress={() => void onSave()}
              disabled={!canSave}
              style={[styles.button, !canSave && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: 20, paddingVertical: 8 },
  back: { fontSize: 16, color: '#2563eb', fontWeight: '600' },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 12 },
  heading: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  copy: { fontSize: 18, lineHeight: 26, color: '#0f172a', marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  button: {
    alignSelf: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 12,
    minWidth: 160,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 12,
    marginTop: 12,
  },
  secondaryText: { color: '#0f172a', fontSize: 16, fontWeight: '600' },
});
