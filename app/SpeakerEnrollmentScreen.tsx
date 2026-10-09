import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';
import { requestHearingPermissions } from '../lib/hearing/permissions';
import {
  cancelEnrollmentCapture,
  captureEnrollmentClip,
  ENROLLMENT_CLIP_MS,
  ENROLLMENT_LANGUAGES,
  getEnrollmentLanguages,
  saveEnrollment,
  saveEnrollmentLanguages,
  selectPromptsFor,
  TARGET_CLIP_COUNT,
  voiceprintFromClip,
  type EnrollmentClipPrint,
  type EnrollmentLanguage,
  type EnrollmentPrompt,
} from '../lib/hearing/enrollment';
import { NATIVE_LANGUAGE_NAMES, t as translate, useI18n } from '../lib/i18n';

type Props = NativeStackScreenProps<ChatStackParamList, 'SpeakerEnrollment'>;

type Phase =
  | { kind: 'languages' }
  | { kind: 'intro' }
  | { kind: 'prompt'; index: number }
  | { kind: 'recording'; index: number; startedAt: number }
  | { kind: 'processing'; index: number }
  | { kind: 'saving' }
  | { kind: 'saveFailed'; message: string }
  | { kind: 'done' };

export default function SpeakerEnrollmentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'languages' });
  const [tick, setTick] = useState<number>(0);
  const [languages, setLanguages] = useState<EnrollmentLanguage[]>([
    'en',
    'hi',
    'mr',
  ]);
  const [prompts, setPrompts] = useState<EnrollmentPrompt[]>([]);
  const voiceprints = useRef<EnrollmentClipPrint[]>([]);
  const returnTo = route.params?.returnTo;
  const { t } = useI18n();

  const totalClips = prompts.length || TARGET_CLIP_COUNT;
  const clipMs = ENROLLMENT_CLIP_MS;

  // Load previously-picked languages so re-enrollment defaults to the
  // user's usual choice.
  useEffect(() => {
    void getEnrollmentLanguages().then((prev) => {
      if (prev.length > 0) setLanguages(prev);
    });
  }, []);

  // Cheap re-render tick while recording so the countdown updates.
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [phase.kind]);

  useEffect(() => {
    return () => {
      // Best-effort: if the screen unmounts mid-capture, tell native.
      void cancelEnrollmentCapture();
    };
  }, []);

  const onLanguagesContinue = useCallback(async () => {
    if (languages.length === 0) {
      Alert.alert(translate('enrollment.pickOneTitle'), translate('enrollment.pickOneBody'));
      return;
    }
    await saveEnrollmentLanguages(languages);
    setPrompts(selectPromptsFor(languages, TARGET_CLIP_COUNT));
    setPhase({ kind: 'intro' });
  }, [languages]);

  const toggleLanguage = useCallback((lang: EnrollmentLanguage) => {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }, []);

  const onBegin = useCallback(async () => {
    const perms = await requestHearingPermissions();
    if (!perms.granted) {
      Alert.alert(translate('enrollment.micNeeded'), translate('enrollment.micNeededBody'));
      return;
    }
    voiceprints.current = [];
    setPhase({ kind: 'prompt', index: 0 });
  }, []);

  const commitEnrollment = useCallback(async () => {
    setPhase({ kind: 'saving' });
    try {
      await saveEnrollment(voiceprints.current);
      // Zero the local vector list — helps GC free anything holding
      // enrollment-derived numbers.
      voiceprints.current = [];
      setPhase({ kind: 'done' });
    } catch (err) {
      // Keep voiceprints.current intact so the user can retry save
      // without re-recording all five clips.
      const message =
        err instanceof Error ? err.message : translate('common.pleaseTryAgain');
      setPhase({ kind: 'saveFailed', message });
    }
  }, []);

  const onRecord = useCallback(
    async (index: number) => {
      const startedAt = Date.now();
      setPhase({ kind: 'recording', index, startedAt });
      try {
        const clip = await captureEnrollmentClip(clipMs);
        setPhase({ kind: 'processing', index });

        // Yield so the UI can paint 'Processing…' before the heavy
        // FFT pass. voiceprintFromClip itself yields between windows.
        await new Promise<void>((r) => setTimeout(r, 30));
        const vp = await voiceprintFromClip(clip);
        voiceprints.current = [...voiceprints.current, vp];

        // Zero the clip's PCM as belt-and-braces — the closure should
        // release it anyway, but this makes the intent explicit.
        clip.pcm.fill(0);

        const next = index + 1;
        if (next >= totalClips) {
          await commitEnrollment();
        } else {
          setPhase({ kind: 'prompt', index: next });
        }
      } catch (err) {
        setPhase({ kind: 'prompt', index });
        Alert.alert(
          translate('enrollment.recordingFailed'),
          err instanceof Error ? err.message : translate('common.pleaseTryAgain'),
        );
      }
    },
    [clipMs, totalClips, commitEnrollment],
  );

  const onRetrySave = useCallback(() => {
    void commitEnrollment();
  }, [commitEnrollment]);

  const onRestartEnrollment = useCallback(() => {
    voiceprints.current = [];
    setPhase({ kind: 'intro' });
  }, []);

  const onDone = useCallback(() => {
    if (returnTo === 'ListeningSession') {
      navigation.replace('ListeningSession');
    } else {
      navigation.goBack();
    }
  }, [navigation, returnTo]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + theme.spacing.md }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing['2xl'] },
      ]}
    >
      <View style={styles.header}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.backPlain')}
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backChip, pressed && styles.backChipPressed]}
        >
          <Text style={styles.backChipText}>{t('common.back')}</Text>
        </GentlePressable>
        <Text style={styles.eyebrow}>{t('enrollment.eyebrow')}</Text>
      </View>

      {phase.kind === 'languages' && (
        <LanguageSelectView
          languages={languages}
          toggle={toggleLanguage}
          onContinue={onLanguagesContinue}
        />
      )}

      {phase.kind === 'intro' && (
        <IntroView
          totalClips={totalClips}
          clipMs={clipMs}
          languages={languages}
          onBegin={onBegin}
        />
      )}

      {phase.kind === 'prompt' && prompts[phase.index] && (
        <PromptView
          prompt={prompts[phase.index]}
          index={phase.index}
          total={totalClips}
          onRecord={() => onRecord(phase.index)}
        />
      )}

      {phase.kind === 'recording' && prompts[phase.index] && (
        <RecordingView
          prompt={prompts[phase.index]}
          index={phase.index}
          total={totalClips}
          startedAt={phase.startedAt}
          clipMs={clipMs}
        />
      )}

      {phase.kind === 'processing' && (
        <ProcessingView index={phase.index} total={totalClips} />
      )}

      {phase.kind === 'saving' && <SavingView />}

      {phase.kind === 'saveFailed' && (
        <SaveFailedView
          message={phase.message}
          onRetry={onRetrySave}
          onStartOver={onRestartEnrollment}
        />
      )}

      {phase.kind === 'done' && <DoneView onDone={onDone} />}

      {/* recording tick keeps the ProgressBar and countdown alive */}
      {phase.kind === 'recording' && <View style={{ height: 0, opacity: 0 }} accessible={false} pointerEvents="none"><Text>{tick}</Text></View>}
    </ScrollView>
  );
}

// ─── views ────────────────────────────────────────────────────────

function LanguageSelectView({
  languages,
  toggle,
  onContinue,
}: {
  languages: EnrollmentLanguage[];
  toggle: (lang: EnrollmentLanguage) => void;
  onContinue: () => void;
}) {
  const canContinue = languages.length > 0;
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.title}>{t('enrollment.languagesTitle')}</Text>
      <Text style={styles.subtitle}>{t('enrollment.languagesSubtitle')}</Text>

      <View style={styles.langRow}>
        {ENROLLMENT_LANGUAGES.map((lang) => (
          <GentlePressable
            key={lang}
            accessibilityRole="button"
            accessibilityLabel={t('enrollment.toggleA11y', { language: languageLabel(lang) })}
            onPress={() => toggle(lang)}
            style={({ pressed }) => [
              styles.langChip,
              languages.includes(lang) && styles.langChipActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                styles.langChipText,
                languages.includes(lang) && styles.langChipTextActive,
              ]}
            >
              {languageLabel(lang)}
            </Text>
          </GentlePressable>
        ))}
      </View>

      <Text style={styles.helper}>
        {languages.length === 0
          ? t('enrollment.pickOneHelper')
          : t('enrollment.selected', { languages: languages.map(languageLabel).join(', ') })}
      </Text>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('enrollment.continueA11y')}
        onPress={onContinue}
        style={({ pressed }) => [
          styles.primaryButton,
          !canContinue && { opacity: 0.5 },
          pressed && styles.primaryButtonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>{t('common.continue')}</Text>
      </GentlePressable>
    </View>
  );
}

function IntroView({
  totalClips,
  clipMs,
  languages,
  onBegin,
}: {
  totalClips: number;
  clipMs: number;
  languages: EnrollmentLanguage[];
  onBegin: () => void;
}) {
  const approxSeconds = Math.round((totalClips * clipMs) / 1000);
  const langList = languages.map(languageLabel).join(', ');
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.title}>{t('enrollment.introTitle')}</Text>
      <Text style={styles.subtitle}>
        {t('enrollment.introSubtitle', { seconds: approxSeconds })}
      </Text>

      <View style={styles.infoCard}>
        <InfoRow>{t('enrollment.introNothingStored')}</InfoRow>
        <InfoRow>
          {t('enrollment.introLines', { count: totalClips, languages: langList })}
        </InfoRow>
        <InfoRow>{t('enrollment.rerecordAnytime')}</InfoRow>
      </View>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('enrollment.beginA11y')}
        onPress={onBegin}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('enrollment.begin')}</Text>
      </GentlePressable>
    </View>
  );
}

function PromptView({
  prompt,
  index,
  total,
  onRecord,
}: {
  prompt: EnrollmentPrompt;
  index: number;
  total: number;
  onRecord: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        {t('enrollment.lineOfLanguage', {
          current: index + 1,
          total,
          language: languageLabel(prompt.language),
        })}
      </Text>
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>{prompt.primary}</Text>
        {prompt.transliteration && (
          <Text style={styles.transliteration}>{prompt.transliteration}</Text>
        )}
        <Text style={styles.gloss}>— {prompt.gloss}</Text>
      </View>
      <Text style={styles.helper}>{t('enrollment.promptHelper')}</Text>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('enrollment.recordA11y')}
        onPress={onRecord}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('enrollment.record')}</Text>
      </GentlePressable>
    </View>
  );
}

function RecordingView({
  prompt,
  index,
  total,
  startedAt,
  clipMs,
}: {
  prompt: EnrollmentPrompt;
  index: number;
  total: number;
  startedAt: number;
  clipMs: number;
}) {
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, clipMs - elapsed);
  const pct = Math.min(1, elapsed / clipMs);
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        {t('enrollment.lineOfLanguage', {
          current: index + 1,
          total,
          language: languageLabel(prompt.language),
        })}
      </Text>
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>{prompt.primary}</Text>
        {prompt.transliteration && (
          <Text style={styles.transliteration}>{prompt.transliteration}</Text>
        )}
      </View>
      <View style={styles.dotWrap}>
        <View style={styles.speechDotActive} />
      </View>
      <Text style={styles.countdown}>
        {t('enrollment.listeningCountdown', { seconds: Math.ceil(remaining / 1000) })}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

function ProcessingView({ index, total }: { index: number; total: number }) {
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        {t('enrollment.lineOf', { current: index + 1, total })}
      </Text>
      <Text style={styles.title}>{t('enrollment.processingTitle')}</Text>
      <Text style={styles.subtitle}>{t('enrollment.processingBody')}</Text>
    </View>
  );
}

function SavingView() {
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.title}>{t('enrollment.savingTitle')}</Text>
      <Text style={styles.subtitle}>{t('enrollment.savingBody')}</Text>
    </View>
  );
}

function SaveFailedView({
  message,
  onRetry,
  onStartOver,
}: {
  message: string;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.title}>{t('enrollment.couldNotSave')}</Text>
      <Text style={styles.subtitle}>{message}</Text>
      <Text style={styles.helper}>{t('enrollment.retryHint')}</Text>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('enrollment.retrySaveA11y')}
        onPress={onRetry}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('enrollment.retrySave')}</Text>
      </GentlePressable>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('enrollment.startOverA11y')}
        onPress={onStartOver}
        style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.secondaryButtonText}>{t('enrollment.startOver')}</Text>
      </GentlePressable>
    </View>
  );
}

function DoneView({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.column}>
      <Text style={styles.title}>{t('enrollment.doneTitle')}</Text>
      <Text style={styles.subtitle}>{t('enrollment.doneBody')}</Text>
      <Text style={styles.subtitle}>{t('enrollment.rerecordAnytime')}</Text>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('common.continue')}
        onPress={onDone}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('common.continue')}</Text>
      </GentlePressable>
    </View>
  );
}

function InfoRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoDot}>•</Text>
      <Text style={styles.infoText}>{children}</Text>
    </View>
  );
}

/** Each enrollment language in its own script, matching the app language picker. */
function languageLabel(lang: EnrollmentPrompt['language']): string {
  return NATIVE_LANGUAGE_NAMES[lang];
}

// ─── styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.base,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing['2xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing['2xl'],
  },
  backChip: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  backChipPressed: { opacity: 0.6 },
  backChipText: { ...theme.type.label, color: theme.colors.sand },
  eyebrow: {
    ...theme.type.label,
    color: theme.colors.gold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  column: { alignItems: 'stretch' },
  title: {
    ...theme.type.heading,
    color: theme.colors.cream,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    ...theme.type.body,
    color: theme.colors.sand,
    marginBottom: theme.spacing.lg,
  },
  stepLabel: {
    ...theme.type.label,
    color: theme.colors.gold,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing['2xl'],
    gap: theme.spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  infoDot: {
    ...theme.type.body,
    color: theme.colors.gold,
    width: theme.spacing.md,
  },
  infoText: {
    ...theme.type.body,
    color: theme.colors.sand,
    flex: 1,
  },
  promptCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  promptText: {
    // Deliberately leave fontFamily unset so Devanagari falls through
    // to a system font that supports it (Inter has Latin only).
    fontSize: 20,
    lineHeight: 28,
    color: theme.colors.cream,
    marginBottom: theme.spacing.sm,
  },
  transliteration: {
    ...theme.type.caption,
    color: theme.colors.clay,
    marginBottom: theme.spacing.sm,
    fontStyle: 'italic',
  },
  gloss: {
    ...theme.type.caption,
    color: theme.colors.clay,
  },
  helper: {
    ...theme.type.caption,
    color: theme.colors.clay,
    marginBottom: theme.spacing.lg,
  },
  primaryButton: {
    minHeight: theme.spacing['5xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.md,
  },
  primaryButtonPressed: { backgroundColor: theme.colors.goldSoft },
  primaryButtonText: {
    ...theme.type.label,
    color: theme.colors.onPrimary,
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
  secondaryButtonText: {
    ...theme.type.label,
    color: theme.colors.sand,
    fontSize: theme.type.body.fontSize,
  },
  dotWrap: {
    alignItems: 'center',
    marginVertical: theme.spacing['2xl'],
  },
  speechDotActive: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.gold,
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  countdown: {
    ...theme.type.label,
    color: theme.colors.sand,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.gold,
  },
  langRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  langChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  langChipActive: {
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.goldWash,
  },
  langChipText: { ...theme.type.label, color: theme.colors.sand, fontSize: 15 },
  langChipTextActive: { color: theme.colors.gold },
});
