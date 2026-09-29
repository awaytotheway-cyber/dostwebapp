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
  ENROLLMENT_PROMPTS,
  saveEnrollment,
  voiceprintFromClip,
  type EnrollmentPrompt,
} from '../lib/hearing/enrollment';
import type { Voiceprint } from '../lib/hearing/speakerFingerprint';

type Props = NativeStackScreenProps<ChatStackParamList, 'SpeakerEnrollment'>;

type Phase =
  | { kind: 'intro' }
  | { kind: 'prompt'; index: number }
  | { kind: 'recording'; index: number; startedAt: number }
  | { kind: 'processing'; index: number }
  | { kind: 'saving' }
  | { kind: 'done' };

export default function SpeakerEnrollmentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [tick, setTick] = useState<number>(0);
  const voiceprints = useRef<Voiceprint[]>([]);
  const returnTo = route.params?.returnTo;

  const totalClips = ENROLLMENT_PROMPTS.length;
  const clipMs = ENROLLMENT_CLIP_MS;

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

  const onBegin = useCallback(async () => {
    const perms = await requestHearingPermissions();
    if (!perms.granted) {
      Alert.alert(
        'Microphone needed',
        'DOST needs microphone access to learn the sound of your voice. You can grant it in Settings.',
      );
      return;
    }
    voiceprints.current = [];
    setPhase({ kind: 'prompt', index: 0 });
  }, []);

  const onRecord = useCallback(
    async (index: number) => {
      const startedAt = Date.now();
      setPhase({ kind: 'recording', index, startedAt });
      try {
        const clip = await captureEnrollmentClip(clipMs);
        setPhase({ kind: 'processing', index });

        // Extract on next tick so the UI can paint 'Processing…'.
        await new Promise<void>((r) => setTimeout(r, 30));
        const vp = voiceprintFromClip(clip);
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
          'Recording failed',
          err instanceof Error ? err.message : 'Please try again.',
        );
      }
    },
    [clipMs, totalClips],
  );

  const commitEnrollment = useCallback(async () => {
    setPhase({ kind: 'saving' });
    try {
      await saveEnrollment(voiceprints.current);
      // Zero the local vector list — helps GC free anything holding
      // enrollment-derived numbers.
      voiceprints.current = [];
      setPhase({ kind: 'done' });
    } catch (err) {
      setPhase({ kind: 'intro' });
      voiceprints.current = [];
      Alert.alert(
        'Could not save enrollment',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
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
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backChip, pressed && styles.backChipPressed]}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </GentlePressable>
        <Text style={styles.eyebrow}>Voice enrollment</Text>
      </View>

      {phase.kind === 'intro' && <IntroView totalClips={totalClips} clipMs={clipMs} onBegin={onBegin} />}

      {phase.kind === 'prompt' && (
        <PromptView
          prompt={ENROLLMENT_PROMPTS[phase.index]}
          index={phase.index}
          total={totalClips}
          onRecord={() => onRecord(phase.index)}
        />
      )}

      {phase.kind === 'recording' && (
        <RecordingView
          prompt={ENROLLMENT_PROMPTS[phase.index]}
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

      {phase.kind === 'done' && <DoneView onDone={onDone} />}

      {/* recording tick keeps the ProgressBar and countdown alive */}
      {phase.kind === 'recording' && <View style={{ height: 0, opacity: 0 }} accessible={false} pointerEvents="none"><Text>{tick}</Text></View>}
    </ScrollView>
  );
}

// ─── views ────────────────────────────────────────────────────────

function IntroView({
  totalClips,
  clipMs,
  onBegin,
}: {
  totalClips: number;
  clipMs: number;
  onBegin: () => void;
}) {
  const approxSeconds = Math.round((totalClips * clipMs) / 1000);
  return (
    <View style={styles.column}>
      <Text style={styles.title}>Before DOST can listen for just you</Text>
      <Text style={styles.subtitle}>
        it needs to learn the sound of your voice. Read a few short lines aloud
        — it takes about {approxSeconds} seconds.
      </Text>

      <View style={styles.infoCard}>
        <InfoRow>
          Nothing is recorded to disk. Your voice becomes a small numeric
          fingerprint, then the audio is discarded.
        </InfoRow>
        <InfoRow>
          You&#39;ll read {totalClips} short lines, in English, Hindi, and
          Marathi. That way DOST hears the shape of your voice across the
          languages you actually use.
        </InfoRow>
        <InfoRow>
          You can re-record this anytime in Settings → Listening.
        </InfoRow>
      </View>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Begin voice enrollment"
        onPress={onBegin}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>Begin</Text>
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
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        Line {index + 1} of {total} · {languageLabel(prompt.language)}
      </Text>
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>{prompt.primary}</Text>
        {prompt.transliteration && (
          <Text style={styles.transliteration}>{prompt.transliteration}</Text>
        )}
        <Text style={styles.gloss}>— {prompt.gloss}</Text>
      </View>
      <Text style={styles.helper}>
        Tap the button, then read the line aloud at a natural pace. Recording
        stops on its own.
      </Text>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Start recording this line"
        onPress={onRecord}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>Record</Text>
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
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        Line {index + 1} of {total} · {languageLabel(prompt.language)}
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
        Listening… {Math.ceil(remaining / 1000)}s
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

function ProcessingView({ index, total }: { index: number; total: number }) {
  return (
    <View style={styles.column}>
      <Text style={styles.stepLabel}>
        Line {index + 1} of {total}
      </Text>
      <Text style={styles.title}>Reading your voice…</Text>
      <Text style={styles.subtitle}>
        DOST is turning that clip into a small numeric fingerprint. Nothing
        else is happening.
      </Text>
    </View>
  );
}

function SavingView() {
  return (
    <View style={styles.column}>
      <Text style={styles.title}>Saving…</Text>
      <Text style={styles.subtitle}>Just a moment.</Text>
    </View>
  );
}

function DoneView({ onDone }: { onDone: () => void }) {
  return (
    <View style={styles.column}>
      <Text style={styles.title}>DOST now knows your voice</Text>
      <Text style={styles.subtitle}>
        From here on, listening sessions will process only the segments that
        match you. Anything else — a stranger, background chatter — gets
        dropped before it&#39;s ever transcribed.
      </Text>
      <Text style={styles.subtitle}>
        You can re-record this anytime in Settings → Listening.
      </Text>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Continue"
        onPress={onDone}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>Continue</Text>
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

function languageLabel(lang: EnrollmentPrompt['language']): string {
  switch (lang) {
    case 'en': return 'English';
    case 'hi': return 'Hindi';
    case 'mr': return 'Marathi';
  }
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
});
