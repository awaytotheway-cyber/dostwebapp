import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { updateMyDosha } from '../lib/profile';
import type { DoshaPick } from './onboarding/types';
import { DOSHA_QUESTIONS, scoreDosha } from './onboarding/DoshaScreen';
import { onboardingStyles as styles } from './onboarding/styles';
import type { ChatStackParamList } from './chatTypes';
import { colors } from '../lib/theme';
import GentlePressable from './GentlePressable';

type Props = NativeStackScreenProps<ChatStackParamList, 'DoshaRetake'>;

export default function DoshaRetakeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [answers, setAnswers] = useState<Partial<Record<string, DoshaPick>>>({});
  const [saving, setSaving] = useState(false);

  const complete = useMemo(
    () => DOSHA_QUESTIONS.every((q) => answers[q.key]),
    [answers],
  );

  const onSave = async () => {
    if (!complete || saving) return;
    const filled = answers as Record<string, DoshaPick>;
    setSaving(true);
    try {
      const result = await updateMyDosha(scoreDosha(filled), filled);
      if (!result.ok) {
        Alert.alert('Could not save', result.message);
        return;
      }
      navigation.goBack();
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <View style={{ paddingHorizontal: 28, paddingVertical: 8 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={{ fontSize: 16, color: colors.gold, fontWeight: '600' }}>Back</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.contentTop} contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.headingLeft}>Re-take dosha quiz</Text>
        {DOSHA_QUESTIONS.map((question) => (
          <View key={question.key}>
            <Text style={styles.question}>{question.prompt}</Text>
            {question.options.map((option) => {
              const selected = answers[question.key] === option.value;
              return (
                <Pressable
                  key={`${question.key}-${option.value}`}
                  onPress={() =>
                    setAnswers((prev) => ({ ...prev, [question.key]: option.value }))
                  }
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={() => void onSave()}
          disabled={!complete || saving}
          style={[styles.button, (!complete || saving) && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save dosha'}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
