import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import GentlePressable from '../GentlePressable';
import { spacing } from '../../lib/theme';
import OnboardingProgress from './OnboardingProgress';
import PreferenceGlyph from './PreferenceGlyph';
import { onboardingStyles as styles } from './styles';
import type { Hobby, OnboardingStackParamList } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Hobbies'>;

const MAX_HOBBIES = 5;
const OPTIONS: Array<{ value: Hobby; label: string }> = [
  { value: 'reading', label: 'Reading' },
  { value: 'music', label: 'Music' },
  { value: 'movement', label: 'Movement' },
  { value: 'nature', label: 'Nature' },
  { value: 'art', label: 'Art' },
  { value: 'cooking', label: 'Cooking' },
  { value: 'travel', label: 'Travel' },
  { value: 'games', label: 'Games' },
  { value: 'spiritual_practice', label: 'Spiritual practice' },
];

export default function HobbiesScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [hobbies, setHobbies] = useState<Hobby[]>([]);

  const toggleHobby = (hobby: Hobby) => {
    setHobbies((current) => {
      if (current.includes(hobby)) {
        return current.filter((item) => item !== hobby);
      }
      return current.length < MAX_HOBBIES ? [...current, hobby] : current;
    });
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <ScrollView
        style={styles.contentTop}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.eyebrow}>What restores you</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          What do you enjoy making time for?
        </Text>
        <Text style={styles.screenLead}>Choose up to five. These can change as you do.</Text>
        <Text accessibilityLiveRegion="polite" style={styles.selectionCount}>
          {hobbies.length} of {MAX_HOBBIES} selected
        </Text>
        {OPTIONS.map((option) => {
          const selected = hobbies.includes(option.value);
          const unavailable = !selected && hobbies.length >= MAX_HOBBIES;
          return (
            <GentlePressable
              key={option.value}
              onPress={() => toggleHobby(option.value)}
              disabled={unavailable}
              accessibilityRole="checkbox"
              accessibilityLabel={option.label}
              accessibilityHint={unavailable ? 'Remove another interest to select this one' : undefined}
              accessibilityState={{ checked: selected, disabled: unavailable }}
              style={({ pressed }) => [
                styles.option,
                (selected || pressed) && styles.optionSelected,
                unavailable && styles.buttonDisabled,
              ]}
            >
              <View style={[styles.glyphFrame, selected && styles.glyphFrameSelected]}>
                <PreferenceGlyph name={option.value} selected={selected} />
              </View>
              <Text style={styles.optionText}>{option.label}</Text>
            </GentlePressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={() => navigation.navigate('SocialEnergy', { ...route.params, hobbies })}
          disabled={hobbies.length === 0}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            hobbies.length === 0 && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
