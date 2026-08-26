import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.content}>
        <Text style={styles.heading}>Welcome. I'm DOST.</Text>
        <Text style={styles.copy}>
          A quiet friend to reflect with. Nothing you share leaves this space without your permission.
        </Text>
        <Pressable onPress={() => navigation.navigate('Name')} style={styles.button}>
          <Text style={styles.buttonText}>Begin</Text>
        </Pressable>
      </View>
    </View>
  );
}
