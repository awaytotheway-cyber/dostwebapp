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

const MAX_INTENTION = 200;

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Intention'>;

export default function IntentionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [intention, setIntention] = useState('');

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.headingLeft}>What would you like to reflect on, gently?</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={intention}
            onChangeText={(value) => setIntention(value.slice(0, MAX_INTENTION))}
            placeholder="A few words are enough"
            placeholderTextColor="#888"
            maxLength={MAX_INTENTION}
            multiline
            numberOfLines={3}
            blurOnSubmit={false}
            textAlignVertical="top"
            underlineColorAndroid="transparent"
          />
          <Text style={styles.helper}>You can change this anytime.</Text>
        </View>
        <View style={styles.footer}>
          <Pressable
            onPress={() =>
              navigation.navigate('Birth', {
                name: route.params.name,
                intention: intention.trim(),
              })
            }
            style={styles.button}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
