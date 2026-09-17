import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as shared } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { colors, spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

const MAX_NAME = 40;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Name'>;

export default function NameScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const canContinue = name.trim().length > 0;

  return (
    <View
      style={[
        shared.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={shared.contentTop}
          contentContainerStyle={shared.centeredScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View>
            <Text accessibilityRole="header" style={shared.headingLeft}>
              What should Dost{'\n'}call you?
            </Text>
            <Text style={styles.subCopy}>
              Just a first name is fine. You can change it any time.
            </Text>
            <TextInput
              style={shared.input}
              value={name}
              onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
              placeholder="Your name"
              placeholderTextColor={colors.inkLight}
              maxLength={MAX_NAME}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="name"
              autoComplete="name"
              underlineColorAndroid="transparent"
              autoFocus
            />
          </View>
        </ScrollView>
        <View style={shared.footer}>
          <GentlePressable
            onPress={() => navigation.navigate('Intention', { name: name.trim() })}
            disabled={!canContinue}
            style={({ pressed }) => [
              shared.button,
              pressed && shared.buttonPressed,
              !canContinue && shared.buttonDisabled,
            ]}
          >
            <Text style={shared.buttonText}>Continue</Text>
          </GentlePressable>
          <Text style={styles.privacyNote}>Everything you write stays private to your account.</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  subCopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
    marginBottom: spacing.xl,
  },
  privacyNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkLight,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
