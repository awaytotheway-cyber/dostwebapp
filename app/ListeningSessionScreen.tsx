import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import theme from '../lib/theme';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';
import { HEARING_DISCLOSURE_ACK_KEY } from './HearingDisclosureScreen';
import { requestHearingPermissions } from '../lib/hearing/permissions';
import { isEnrolled } from '../lib/hearing/enrollment';
import {
  ensureModelDownloaded,
  isModelDownloaded,
  MODEL_APPROX_MB,
} from '../lib/hearing/transcription';
import {
  getPipelineState,
  releaseHearingResources,
  startHearingSession,
  stopHearingSession,
  subscribePipeline,
  type BatteryMode,
  type PipelineState,
} from '../lib/hearing/pipeline';
import { supabase } from '../lib/supabase';
import { labelForEmotionChip } from '../lib/dost/suggestionChips';

type Props = NativeStackScreenProps<ChatStackParamList, 'ListeningSession'>;

type Phase = 'idle' | 'preparing' | 'active' | 'summary';

type SessionSummary = {
  sessionId: string;
  totalMs: number;
  speechMs: number;
  segmentsProcessed: number;
  avgPitchHz: number | null;
  avgWpm: number | null;
  avgPitchVariability: number | null;
  emotions: Array<{ emotion: string; count: number }>;
  allMock: boolean;
};

export default function ListeningSessionScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('idle');
  const [batteryMode, setBatteryMode] = useState<BatteryMode>('balanced');
  const [downloadPct, setDownloadPct] = useState<number>(0);
  const [pipelineState, setPipelineState] = useState<PipelineState>(getPipelineState());
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const startingRef = useRef(false);

  // Redirect to disclosure if the user has never acknowledged it.
  useEffect(() => {
    (async () => {
      try {
        const ack = await AsyncStorage.getItem(HEARING_DISCLOSURE_ACK_KEY);
        if (!ack) {
          navigation.replace('HearingDisclosure', { returnTo: 'ListeningSession' });
        }
      } catch {
        // ignore
      }
    })();
  }, [navigation]);

  // Observe pipeline state.
  useEffect(() => {
    const unsub = subscribePipeline((s) => setPipelineState(s));
    return unsub;
  }, []);

  // If the pipeline is active on mount (returning to the screen while a
  // session is running), reflect that in phase.
  useEffect(() => {
    if (pipelineState.status === 'active' && phase === 'idle') {
      setPhase('active');
    }
  }, [pipelineState.status, phase]);

  // Release the whisper model when leaving the feature entirely.
  useEffect(() => {
    return () => {
      // On unmount, only release if no session is active.
      if (getPipelineState().status === 'idle') {
        void releaseHearingResources();
      }
    };
  }, []);

  const onStart = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      // Speaker enrollment gate (Phase 2): a session that isn't
      // filtered to just this user would record anyone speaking near
      // the phone. Block start until the user has enrolled.
      const enrolled = await isEnrolled();
      if (!enrolled) {
        navigation.navigate('SpeakerEnrollment', { returnTo: 'ListeningSession' });
        return;
      }

      const perms = await requestHearingPermissions();
      if (!perms.granted) {
        if (perms.reason === 'mic-denied') {
          Alert.alert(
            'Microphone needed',
            'DOST needs microphone access to run a listening session. You can grant it in Settings.',
          );
        } else if (perms.reason === 'notification-denied') {
          Alert.alert(
            'Notification needed',
            'DOST shows a notification while a session is active. Please allow it in Settings.',
          );
        }
        return;
      }

      const modelReady = await isModelDownloaded();
      if (!modelReady) {
        setPhase('preparing');
        setDownloadPct(0);
        try {
          await ensureModelDownloaded((pct) => setDownloadPct(pct));
        } catch (err) {
          setPhase('idle');
          Alert.alert(
            'Model download failed',
            'DOST could not download its on-device ear. Please check your connection and try again.',
          );
          return;
        }
      }

      setSummary(null);
      await startHearingSession(batteryMode);
      setPhase('active');
    } catch (err) {
      setPhase('idle');
      Alert.alert('Could not start', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      startingRef.current = false;
    }
  }, [batteryMode, navigation]);

  const onStop = useCallback(async () => {
    const sessionId =
      pipelineState.status === 'active' ? pipelineState.sessionId : null;
    try {
      await stopHearingSession();
    } catch {
      // ignore — surface via state
    }
    setPhase('summary');
    if (sessionId) {
      const s = await loadSessionSummary(sessionId);
      setSummary(s);
    }
  }, [pipelineState]);

  const onNewSession = useCallback(() => {
    setSummary(null);
    setPhase('idle');
  }, []);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + theme.spacing.md }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing['2xl'] },
      ]}
    >
      <Header onBack={() => navigation.goBack()} />

      {phase === 'idle' && (
        <IdleView
          batteryMode={batteryMode}
          onSelectMode={setBatteryMode}
          onStart={onStart}
          onLearnMore={() =>
            navigation.navigate('HearingDisclosure', { returnTo: undefined })
          }
        />
      )}

      {phase === 'preparing' && (
        <PreparingView downloadPct={downloadPct} />
      )}

      {phase === 'active' && (
        <ActiveView state={pipelineState} onStop={onStop} />
      )}

      {phase === 'summary' && summary && (
        <SummaryView summary={summary} onNewSession={onNewSession} />
      )}
    </ScrollView>
  );
}

// ─── views ────────────────────────────────────────────────────────

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => [styles.backChip, pressed && styles.backChipPressed]}
      >
        <Text style={styles.backChipText}>← Back</Text>
      </GentlePressable>
      <Text style={styles.eyebrow}>Listening</Text>
    </View>
  );
}

function IdleView({
  batteryMode,
  onSelectMode,
  onStart,
  onLearnMore,
}: {
  batteryMode: BatteryMode;
  onSelectMode: (m: BatteryMode) => void;
  onStart: () => void;
  onLearnMore: () => void;
}) {
  return (
    <View style={styles.centerColumn}>
      <Text style={styles.title}>Listening session</Text>
      <Text style={styles.subtitle}>Let DOST hear how you speak.</Text>

      <View style={styles.circleWrap}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel="Start a listening session"
          onPress={onStart}
          style={({ pressed }) => [styles.startCircle, pressed && styles.startCirclePressed]}
        >
          <Text style={styles.startLabel}>Start{'\n'}a session</Text>
        </GentlePressable>
      </View>

      <View style={styles.modeRow}>
        {(['attentive', 'balanced', 'light'] as BatteryMode[]).map((m) => (
          <GentlePressable
            key={m}
            accessibilityRole="button"
            accessibilityLabel={`Battery mode: ${m}`}
            onPress={() => onSelectMode(m)}
            style={({ pressed }) => [
              styles.modeChip,
              batteryMode === m && styles.modeChipActive,
              pressed && styles.modeChipPressed,
            ]}
          >
            <Text
              style={[
                styles.modeChipText,
                batteryMode === m && styles.modeChipTextActive,
              ]}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </Text>
          </GentlePressable>
        ))}
      </View>
      <Text style={styles.modeHint}>{modeHint(batteryMode)}</Text>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="How this works"
        onPress={onLearnMore}
        style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.linkText}>How this works →</Text>
      </GentlePressable>
    </View>
  );
}

function PreparingView({ downloadPct }: { downloadPct: number }) {
  const pct = Math.max(0, Math.min(1, downloadPct));
  return (
    <View style={styles.centerColumn}>
      <Text style={styles.title}>Preparing DOST&#39;s ear</Text>
      <Text style={styles.subtitle}>
        One-time download, about {MODEL_APPROX_MB} MB. Runs entirely on your phone after this.
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

function ActiveView({
  state,
  onStop,
}: {
  state: PipelineState;
  onStop: () => void;
}) {
  if (state.status !== 'active') {
    return (
      <View style={styles.centerColumn}>
        <Text style={styles.subtitle}>Starting…</Text>
      </View>
    );
  }
  const elapsedMs = Date.now() - state.startedAt;
  return (
    <View style={styles.centerColumn}>
      <Text style={styles.title}>Listening…</Text>
      <Text style={styles.subtitle}>
        {state.calibrating ? 'Warming up.' : 'Tap Stop when you’re done.'}
      </Text>

      <View style={styles.dotWrap}>
        <View
          style={[
            styles.speechDot,
            state.calibrating && styles.speechDotCalibrating,
            state.lastSpeech && !state.calibrating && styles.speechDotActive,
          ]}
        />
      </View>

      <Text style={styles.timerText}>{formatDuration(elapsedMs)}</Text>

      <View style={styles.metricRow}>
        <MetricTile
          label="Speech / total"
          value={`${formatDurationShort(state.speechMs)} / ${formatDurationShort(state.totalMs)}`}
        />
        <MetricTile label="Segments" value={String(state.segmentsProcessed)} />
      </View>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Stop the session"
        onPress={onStop}
        style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
      >
        <Text style={styles.stopButtonText}>Stop session</Text>
      </GentlePressable>
    </View>
  );
}

function SummaryView({
  summary,
  onNewSession,
}: {
  summary: SessionSummary;
  onNewSession: () => void;
}) {
  return (
    <View style={styles.summaryColumn}>
      <Text style={styles.title}>Session done</Text>
      <Text style={styles.subtitle}>{acousticSummarySentence(summary)}</Text>

      <View style={styles.summaryCard}>
        <SummaryRow label="Duration" value={formatDurationShort(summary.totalMs)} />
        <SummaryRow label="Speech time" value={formatDurationShort(summary.speechMs)} />
        <SummaryRow
          label="Segments processed"
          value={String(summary.segmentsProcessed)}
        />
        {summary.avgWpm !== null && (
          <SummaryRow
            label="Speaking rate"
            value={`${Math.round(summary.avgWpm)} WPM`}
          />
        )}
        {summary.avgPitchHz !== null && summary.avgPitchHz > 0 && (
          <SummaryRow
            label="Average pitch"
            value={`${Math.round(summary.avgPitchHz)} Hz`}
          />
        )}
        <Text style={styles.summaryDisclaimer}>
          &quot;Vocal stress&quot; here is a heuristic composite — not a clinical measure.
        </Text>
      </View>

      {summary.emotions.length > 0 && (
        <View style={styles.themeCard}>
          <Text style={styles.themeHeading}>What DOST heard, in themes</Text>
          <View style={styles.chipsWrap}>
            {summary.emotions.map((e) => (
              <View key={e.emotion} style={styles.themeChip}>
                <Text style={styles.themeChipText}>
                  {labelForEmotionChip(e.emotion)}
                  {e.count > 1 ? `  ×${e.count}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {summary.allMock && (
        <View style={styles.mockBanner}>
          <Text style={styles.mockBannerText}>
            Acoustic emotion inference is not yet active — DOST is not using this data.
          </Text>
        </View>
      )}

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel="Start another session"
        onPress={onNewSession}
        style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.secondaryButtonText}>Start another session</Text>
      </GentlePressable>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function modeHint(mode: BatteryMode): string {
  switch (mode) {
    case 'attentive':
      return 'Highest fidelity. Best when your phone is charging.';
    case 'balanced':
      return 'Every segment, one at a time. Best default.';
    case 'light':
      return 'Samples one segment in three. Battery-first.';
  }
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatDurationShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r}s`;
}

function acousticSummarySentence(s: SessionSummary): string {
  if (!s.avgWpm && !s.avgPitchVariability) return 'Session recorded.';
  const rate = s.avgWpm ? `at about ${Math.round(s.avgWpm)} words per minute` : null;
  let variation: string | null = null;
  if (s.avgPitchVariability !== null) {
    if (s.avgPitchVariability < 0.15) variation = 'with little variation in tone';
    else if (s.avgPitchVariability < 0.3) variation = 'with moderate variation in tone';
    else variation = 'with a lot of variation in tone';
  }
  const parts = ['You spoke', rate, variation].filter(Boolean);
  return `${parts.join(' ')}.`;
}

async function loadSessionSummary(sessionId: string): Promise<SessionSummary> {
  const { data: sess } = await supabase
    .from('voice_sessions')
    .select('total_duration_seconds, speech_duration_seconds, segments_processed')
    .eq('id', sessionId)
    .maybeSingle();

  const { data: signals } = await supabase
    .from('voice_signals')
    .select(
      'primary_emotion, speaking_rate_wpm, pitch_mean_hz, pitch_variability, inference_source',
    )
    .eq('session_id', sessionId);

  const rows = signals ?? [];

  const wpmVals = rows
    .map((r) => Number(r.speaking_rate_wpm))
    .filter((n) => Number.isFinite(n) && n > 0);
  const pitchVals = rows
    .map((r) => Number(r.pitch_mean_hz))
    .filter((n) => Number.isFinite(n) && n > 0);
  const pitchVarVals = rows
    .map((r) => Number(r.pitch_variability))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const emotionCounts = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.primary_emotion === 'string' && r.primary_emotion) {
      emotionCounts.set(
        r.primary_emotion,
        (emotionCounts.get(r.primary_emotion) ?? 0) + 1,
      );
    }
  }
  const emotions = [...emotionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([emotion, count]) => ({ emotion, count }));

  const allMock =
    rows.length === 0 || rows.every((r) => r.inference_source === 'mock');

  return {
    sessionId,
    totalMs: Number(sess?.total_duration_seconds ?? 0) * 1000,
    speechMs: Number(sess?.speech_duration_seconds ?? 0) * 1000,
    segmentsProcessed: Number(sess?.segments_processed ?? rows.length),
    avgWpm: mean(wpmVals),
    avgPitchHz: mean(pitchVals),
    avgPitchVariability: mean(pitchVarVals),
    emotions,
    allMock,
  };
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
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
  centerColumn: {
    alignItems: 'center',
  },
  summaryColumn: {
    alignItems: 'stretch',
  },
  title: {
    ...theme.type.heading,
    color: theme.colors.cream,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    ...theme.type.body,
    color: theme.colors.sand,
    textAlign: 'center',
    marginBottom: theme.spacing['2xl'],
  },
  circleWrap: {
    marginVertical: theme.spacing['2xl'],
    alignItems: 'center',
  },
  startCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1.5,
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startCirclePressed: { backgroundColor: theme.colors.goldWash },
  startLabel: {
    ...theme.type.heading,
    fontSize: 22,
    lineHeight: 26,
    color: theme.colors.gold,
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  modeChipPressed: { opacity: 0.7 },
  modeChipActive: {
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.goldWash,
  },
  modeChipText: { ...theme.type.label, color: theme.colors.sand },
  modeChipTextActive: { color: theme.colors.gold },
  modeHint: {
    ...theme.type.caption,
    color: theme.colors.clay,
    marginTop: theme.spacing.md,
    textAlign: 'center',
  },
  linkRow: { marginTop: theme.spacing['2xl'] },
  linkText: { ...theme.type.label, color: theme.colors.gold },
  progressTrack: {
    width: '80%',
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    marginTop: theme.spacing['2xl'],
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.gold,
  },
  progressLabel: {
    ...theme.type.label,
    color: theme.colors.sand,
    marginTop: theme.spacing.sm,
  },
  dotWrap: {
    marginVertical: theme.spacing['3xl'],
  },
  speechDot: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.goldWash,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  speechDotCalibrating: {
    backgroundColor: theme.colors.divider,
  },
  speechDotActive: {
    backgroundColor: theme.colors.gold,
    borderColor: theme.colors.gold,
  },
  timerText: {
    ...theme.type.display,
    color: theme.colors.cream,
    marginBottom: theme.spacing['2xl'],
  },
  metricRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing['2xl'],
    width: '100%',
  },
  metricTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
  },
  metricLabel: { ...theme.type.caption, color: theme.colors.clay },
  metricValue: { ...theme.type.label, color: theme.colors.cream, marginTop: 4 },
  stopButton: {
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.cta,
    paddingHorizontal: theme.spacing['3xl'],
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  stopButtonPressed: { backgroundColor: theme.colors.logoutWash },
  stopButtonText: { ...theme.type.label, color: theme.colors.cream, fontSize: 15 },
  summaryCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  summaryLabel: { ...theme.type.body, color: theme.colors.sand },
  summaryValue: { ...theme.type.label, color: theme.colors.cream, fontSize: 15 },
  summaryDisclaimer: {
    ...theme.type.caption,
    color: theme.colors.clay,
    fontStyle: 'italic',
    marginTop: theme.spacing.md,
  },
  themeCard: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  themeHeading: { ...theme.type.label, color: theme.colors.cream, marginBottom: theme.spacing.md },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  themeChip: {
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.goldWash,
  },
  themeChipText: { ...theme.type.caption, color: theme.colors.cream },
  mockBanner: {
    borderWidth: 1,
    borderColor: theme.colors.terracottaDash,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.terracottaWash,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  mockBannerText: {
    ...theme.type.caption,
    color: theme.colors.cream,
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
  },
  secondaryButtonText: { ...theme.type.label, color: theme.colors.sand, fontSize: 15 },
});
