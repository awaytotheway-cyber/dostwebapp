import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';

const MAX_NAME = 40;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Name'>;

export default function NameScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const canContinue = name.trim().length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.headingLeft}>What should I call you?</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
            placeholder="Your name"
            placeholderTextColor="#888"
            maxLength={MAX_NAME}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="name"
            autoComplete="name"
            underlineColorAndroid="transparent"
          />
        </View>
        <View style={styles.footer}>
          <Pressable
            onPress={() => navigation.navigate('Intention', { name: name.trim() })}
            disabled={!canContinue}
            style={[styles.button, !canContinue && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
