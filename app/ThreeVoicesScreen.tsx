import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';
import { useI18n, type TKey } from '../lib/i18n';

type Props = NativeStackScreenProps<ChatStackParamList, 'ThreeVoices'>;

/**
 * The Adult Chair method, renamed to the mentor's own three personas
 * (per "Additional instructions for the BOT.docx" — the mentor asked
 * us to replace the word "chair" with the already-named personas).
 *
 * Steps are kept verbatim from the mentor's text, re-worded only where
 * "chair" had to become the persona name. The practice itself is a
 * five-card walk: Pause → Acknowledge → Validate → Shift → Respond.
 */

type Voice = 'pained' | 'shielding' | 'individuated';

type Step = {
  key: 'pause' | 'acknowledge' | 'validate' | 'shift' | 'respond';
  numberKey: TKey;
  headingKey: TKey;
  bodyKey: TKey;
  promptKey?: TKey;
};

const STEPS: Step[] = [
  {
    key: 'pause',
    numberKey: 'threeVoices.step1Number',
    headingKey: 'threeVoices.step1Heading',
    bodyKey: 'threeVoices.step1Body',
    promptKey: 'threeVoices.step1Prompt',
  },
  {
    key: 'acknowledge',
    numberKey: 'threeVoices.step2Number',
    headingKey: 'threeVoices.step2Heading',
    bodyKey: 'threeVoices.step2Body',
  },
  {
    key: 'validate',
    numberKey: 'threeVoices.step3Number',
    headingKey: 'threeVoices.step3Heading',
    bodyKey: 'threeVoices.step3Body',
  },
  {
    key: 'shift',
    numberKey: 'threeVoices.step4Number',
    headingKey: 'threeVoices.step4Heading',
    bodyKey: 'threeVoices.step4Body',
    promptKey: 'threeVoices.step4Prompt',
  },
  {
    key: 'respond',
    numberKey: 'threeVoices.step5Number',
    headingKey: 'threeVoices.step5Heading',
    bodyKey: 'threeVoices.step5Body',
  },
];

export default function ThreeVoicesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const [stepIndex, setStepIndex] = useState(0);
  const [noticedVoice, setNoticedVoice] = useState<Voice | null>(null);
  const [done, setDone] = useState(false);

  const step = STEPS[stepIndex];
  const isPauseStep = step.key === 'pause';
  const canAdvance = isPauseStep ? noticedVoice !== null : true;

  const voiceLabel = useMemo(() => {
    if (!noticedVoice) return '';
    return t(`threeVoices.voices.${noticedVoice}.name` as TKey);
  }, [noticedVoice, t]);

  const onBack = () => navigation.goBack();

  const onNext = () => {
    if (!canAdvance) return;
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      setDone(true);
    }
  };

  const onRestart = () => {
    setStepIndex(0);
    setNoticedVoice(null);
    setDone(false);
  };

  if (done) {
    return (
      <ScrollView
        style={[styles.container, { paddingTop: insets.top + theme.spacing.md }]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + theme.spacing['2xl'] },
        ]}
      >
        <HeaderBar onBack={onBack} label={t('threeVoices.title')} />
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{t('threeVoices.doneEyebrow')}</Text>
          <Text style={styles.heading}>{t('threeVoices.doneHeading')}</Text>
          <Text style={styles.body}>{t('threeVoices.doneBody')}</Text>
        </View>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('threeVoices.restart')}
          onPress={onRestart}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
        >
          <Text style={styles.secondaryButtonText}>{t('threeVoices.restart')}</Text>
        </GentlePressable>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          onPress={onBack}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <Text style={styles.primaryButtonText}>{t('common.done')}</Text>
        </GentlePressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + theme.spacing.md }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing['2xl'] },
      ]}
    >
      <HeaderBar onBack={onBack} label={t('threeVoices.title')} />

      <View style={styles.progressRow} accessible accessibilityRole="progressbar">
        {STEPS.map((_, idx) => (
          <View
            key={idx}
            style={[styles.progressDot, idx <= stepIndex && styles.progressDotActive]}
          />
        ))}
      </View>

      <Text style={styles.eyebrow}>{t(step.numberKey)}</Text>
      <Text style={styles.heading}>{t(step.headingKey)}</Text>
      <Text style={styles.body}>{t(step.bodyKey)}</Text>

      {step.promptKey ? (
        <View style={styles.promptCard}>
          <Text style={styles.promptText}>{t(step.promptKey)}</Text>
        </View>
      ) : null}

      {isPauseStep ? (
        <View style={styles.voicePickerBlock}>
          <Text style={styles.pickHint}>{t('threeVoices.pickVoiceHint')}</Text>
          {(['pained', 'shielding', 'individuated'] as const).map((v) => {
            const selected = noticedVoice === v;
            return (
              <GentlePressable
                key={v}
                accessibilityRole="button"
                accessibilityLabel={t(`threeVoices.voices.${v}.name` as TKey)}
                accessibilityState={{ selected }}
                onPress={() => setNoticedVoice(v)}
                style={({ pressed }) => [
                  styles.voiceCard,
                  selected && styles.voiceCardSelected,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.voiceName, selected && styles.voiceNameSelected]}>
                  {t(`threeVoices.voices.${v}.name` as TKey)}
                </Text>
                <Text style={styles.voiceGloss}>
                  {t(`threeVoices.voices.${v}.gloss` as TKey)}
                </Text>
              </GentlePressable>
            );
          })}
        </View>
      ) : null}

      {!isPauseStep && noticedVoice ? (
        <Text style={styles.noticedBanner}>
          {t('threeVoices.noticedBanner', { voice: voiceLabel })}
        </Text>
      ) : null}

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={
          stepIndex === STEPS.length - 1
            ? t('threeVoices.finish')
            : t('common.continue')
        }
        onPress={onNext}
        disabled={!canAdvance}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          !canAdvance && styles.primaryButtonDisabled,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {stepIndex === STEPS.length - 1
            ? t('threeVoices.finish')
            : t('common.continue')}
        </Text>
      </GentlePressable>
    </ScrollView>
  );
}

function HeaderBar({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <View style={styles.header}>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onBack}
        hitSlop={10}
        style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="chevron-back" size={22} color={theme.colors.sand} />
      </GentlePressable>
      <Text style={styles.headerLabel}>{label}</Text>
      <View style={{ width: 22 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.base,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing['2xl'],
    gap: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerLabel: {
    ...theme.type.label,
    color: theme.colors.sand,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  progressRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  progressDot: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.surface,
  },
  progressDotActive: {
    backgroundColor: theme.colors.gold,
  },
  eyebrow: {
    ...theme.type.label,
    color: theme.colors.gold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heading: {
    ...theme.type.heading,
    color: theme.colors.cream,
  },
  body: {
    ...theme.type.body,
    color: theme.colors.sand,
  },
  promptCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
  },
  promptText: {
    ...theme.type.reflectivePrompt,
    color: theme.colors.cream,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  voicePickerBlock: {
    gap: theme.spacing.sm,
  },
  pickHint: {
    ...theme.type.caption,
    color: theme.colors.clay,
    marginBottom: theme.spacing.xs,
  },
  voiceCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  voiceCardSelected: {
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.goldWash,
  },
  voiceName: {
    ...theme.type.label,
    color: theme.colors.cream,
    fontSize: 15,
  },
  voiceNameSelected: {
    color: theme.colors.gold,
  },
  voiceGloss: {
    ...theme.type.caption,
    color: theme.colors.clay,
  },
  noticedBanner: {
    ...theme.type.caption,
    color: theme.colors.gold,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  primaryButton: {
    minHeight: theme.spacing['5xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    backgroundColor: theme.colors.terracotta,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  primaryButtonPressed: {
    backgroundColor: theme.colors.terracottaSoft,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    ...theme.type.label,
    color: theme.colors.onTerracotta,
    fontSize: theme.type.body.fontSize,
  },
  secondaryButton: {
    minHeight: theme.spacing['5xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  secondaryButtonPressed: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    ...theme.type.label,
    color: theme.colors.sand,
    fontSize: theme.type.body.fontSize,
  },
});
