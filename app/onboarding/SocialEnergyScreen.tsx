import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import GentlePressable from '../GentlePressable';
import { spacing } from '../../lib/theme';
import OnboardingProgress from './OnboardingProgress';
import PreferenceGlyph from './PreferenceGlyph';
import { onboardingStyles as styles } from './styles';
import type { OnboardingStackParamList, SocialStyle } from './types';
import { useI18n, type TKey } from '../../lib/i18n';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'SocialEnergy'>;

const OPTIONS: SocialStyle[] = ['introvert', 'ambivert', 'extrovert'];

export default function SocialEnergyScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [socialStyle, setSocialStyle] = useState<SocialStyle | null>(null);

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
        contentContainerStyle={styles.centeredScrollContent}
      >
        <Text style={styles.eyebrow}>{t('onboarding.socialEyebrow')}</Text>
        <Text accessibilityRole="header" style={[styles.headingLeft, styles.headingWithLead]}>
          {t('onboarding.socialHeading')}
        </Text>
        <Text style={styles.screenLead}>{t('onboarding.socialLead')}</Text>
        {OPTIONS.map((value) => {
          const option = {
            value,
            label: t(`social.${value}.label` as TKey),
            description: t(`social.${value}.description` as TKey),
          };
          const selected = socialStyle === option.value;
          return (
            <GentlePressable
              key={option.value}
              onPress={() => setSocialStyle(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}. ${option.description}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                (selected || pressed) && styles.optionSelected,
              ]}
            >
              <View style={[styles.glyphFrame, selected && styles.glyphFrameSelected]}>
                <PreferenceGlyph name={option.value} selected={selected} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={styles.optionText}>{option.label}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
            </GentlePressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={() => {
            if (socialStyle) {
              navigation.navigate('Confirm', { ...route.params, socialStyle });
            }
          }}
          disabled={!socialStyle}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            !socialStyle && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>{t('common.continue')}</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
