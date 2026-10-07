import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import theme, { fonts } from '../lib/theme';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';
import { HEARING_DISCLOSURE_ACK_KEY } from './HearingDisclosureScreen';
import { requestListeningPermissions } from '../lib/listening/permissions';
import { cleanUpOldHearingData } from '../lib/listening/legacyCleanup';
import {
  getLastModelCheck,
  getListenStatus,
  isListeningAvailable,
  runModelCheck,
  startListening,
  stopListening,
  type ListenStatus,
  type ModelCheckResult,
} from '../lib/listening/listenBridge';
import { readSessions, type SavedClip, type SessionSummary } from '../lib/listening/voiceFiles';
import { hasMessage, t as translate, useI18n, type TKey } from '../lib/i18n';

type Props = NativeStackScreenProps<ChatStackParamList, 'ListeningSession'>;

const POLL_MS = 1000;
// Lets the person lock the screen first, so the check measures screen-off speed.
const MODEL_CHECK_DELAY_MS = 10_000;

export default function ListeningSessionScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const available = isListeningAvailable();
  const [status, setStatus] = useState<ListenStatus>({ running: false });
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [modelCheck, setModelCheck] = useState<ModelCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  useEffect(() => {
    void cleanUpOldHearingData();
    (async () => {
      try {
        if (!(await AsyncStorage.getItem(HEARING_DISCLOSURE_ACK_KEY))) {
          navigation.replace('HearingDisclosure', { returnTo: 'ListeningSession' });
        }
      } catch {
        // Shown again next time.
      }
    })();
  }, [navigation]);

  const reloadSessions = useCallback(async (runningId?: string | null) => {
    try {
      setSessions(await readSessions(runningId));
    } catch {
      setSessions([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const tick = async () => {
        const s = await getListenStatus().catch(() => ({ running: false }) as ListenStatus);
        if (!alive) return;
        setStatus(s);
        if (wasRunning.current && !s.running) void reloadSessions(null);
        wasRunning.current = s.running;
      };
      void tick();
      void reloadSessions(null);
      void getLastModelCheck().then((r) => alive && setModelCheck(r)).catch(() => {});
      const id = setInterval(() => void tick(), POLL_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [reloadSessions]),
  );

  const onStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perms = await requestListeningPermissions();
      if (!perms.granted) {
        if (perms.reason === 'mic-denied') {
          Alert.alert(translate('listening.micNeeded'), translate('listening.micNeededBody'));
        } else if (perms.reason === 'notification-denied') {
          Alert.alert(
            translate('listening.notificationNeeded'),
            translate('listening.notificationNeededBody'),
          );
        }
        return;
      }
      await startListening('any_sound');
      setStatus(await getListenStatus());
    } catch (err) {
      Alert.alert(
        translate('listening.couldNotStart'),
        err instanceof Error ? err.message : translate('common.pleaseTryAgain'),
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const onStop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopListening();
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const onModelCheck = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      setModelCheck(await runModelCheck(MODEL_CHECK_DELAY_MS));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const last = sessions[0] ?? null;

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
          style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
        >
          <Text style={styles.backChipText}>{t('common.back')}</Text>
        </GentlePressable>
      </View>

      <Text accessibilityRole="header" style={styles.title}>
        {status.running ? t('listening.listeningTitle') : t('listening.title')}
      </Text>
      <Text style={styles.subtitle}>{t('listening.subtitle')}</Text>
      <Text style={styles.testBanner}>{t('listening.testBanner')}</Text>

      {!available ? (
        <Text style={styles.subtitle}>{t('listening.unavailable')}</Text>
      ) : status.running ? (
        <ActiveView status={status} busy={busy} onStop={onStop} />
      ) : (
        <View style={styles.circleWrap}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('listening.startA11y')}
            onPress={onStart}
            disabled={busy}
            style={({ pressed }) => [styles.startCircle, pressed && styles.startCirclePressed]}
          >
            <Text style={styles.startLabel}>
              {busy ? t('listening.starting') : t('listening.start')}
            </Text>
          </GentlePressable>
        </View>
      )}

      {last && !status.running ? <LastSession session={last} /> : null}

      {available ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('listening.modelCheckTitle')}</Text>
          <Text style={styles.cardBody}>{t('listening.modelCheckBody')}</Text>
          {modelCheck?.ok ? <ModelCheckLines result={modelCheck} /> : null}
          {checkError ? (
            <Text style={styles.errorText}>
              {t('listening.modelCheckFailed', { message: checkError })}
            </Text>
          ) : null}
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('listening.modelCheckRun')}
            onPress={onModelCheck}
            disabled={checking || status.running}
            style={({ pressed }) => [
              styles.secondaryButton,
              (checking || status.running) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>
              {checking ? t('listening.modelCheckRunning') : t('listening.modelCheckRun')}
            </Text>
          </GentlePressable>
        </View>
      ) : null}

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('listening.howItWorks')}
        onPress={() => navigation.navigate('HearingDisclosure', { returnTo: undefined })}
        style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      >
        <Text style={styles.linkText}>{t('listening.howItWorksLink')}</Text>
      </GentlePressable>
    </ScrollView>
  );
}

function ActiveView({
  status,
  busy,
  onStop,
}: {
  status: ListenStatus;
  busy: boolean;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const elapsed = status.startedAt ? Date.now() - status.startedAt : 0;
  const hearing = Boolean(status.inClip);
  return (
    <View style={styles.centerColumn}>
      <View style={styles.dotWrap}>
        <View style={[styles.dot, hearing && styles.dotActive]} />
      </View>
      <Text style={styles.timerText}>{formatClock(elapsed)}</Text>
      <Text style={styles.subtitle} accessibilityLiveRegion="polite">
        {status.micSilenced
          ? t('listening.micBusy')
          : hearing
            ? t('listening.hearingSound')
            : t('listening.quiet')}
      </Text>

      <View style={styles.metricRow}>
        <Metric label={t('listening.saved')} value={formatDuration(status.speechMsSaved ?? 0)} />
        <Metric
          label={t('listening.silenceSkipped')}
          value={formatDuration(status.silenceDroppedMs ?? 0)}
        />
        <Metric label={t('listening.clips')} value={String(status.segmentsSaved ?? 0)} />
      </View>

      <GentlePressable
        accessibilityRole="button"
        accessibilityLabel={t('listening.stopA11y')}
        onPress={onStop}
        disabled={busy || status.stopping}
        style={({ pressed }) => [
          styles.stopButton,
          (busy || status.stopping) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.stopButtonText}>{t('listening.stop')}</Text>
      </GentlePressable>
    </View>
  );
}

function LastSession({ session }: { session: SessionSummary }) {
  const { t } = useI18n();
  const pct =
    session.listenedMs > 0 ? Math.round((session.speechMsSaved / session.listenedMs) * 100) : 0;
  const reasonKey = `listening.reason.${session.reason ?? 'error'}`;
  const reason = hasMessage(reasonKey)
    ? t(reasonKey as TKey)
    : t('listening.reason.error');
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('listening.lastSessionTitle')}</Text>
      <Text style={styles.cardBody}>
        {t('listening.summary', {
          listened: formatDuration(session.listenedMs),
          saved: formatDuration(session.speechMsSaved),
          pct,
          silence: formatDuration(session.silenceDroppedMs),
          short: formatDuration(session.tooShortDroppedMs),
        })}
      </Text>
      <Text style={styles.caption}>{t('listening.stoppedBecause', { reason })}</Text>

      <Text style={[styles.cardTitle, styles.clipsTitle]}>{t('listening.clipsTitle')}</Text>
      {session.clips.length === 0 ? (
        <Text style={styles.cardBody}>{t('listening.noClips')}</Text>
      ) : (
        <ClipList clips={session.clips} />
      )}
    </View>
  );
}

function ClipList({ clips }: { clips: SavedClip[] }) {
  const { t } = useI18n();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(
    () => () => {
      void soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    },
    [],
  );

  const toggle = async (clip: SavedClip) => {
    const current = soundRef.current;
    soundRef.current = null;
    if (current) await current.unloadAsync().catch(() => {});
    if (playing === clip.uri) {
      setPlaying(null);
      return;
    }
    const info = await FileSystem.getInfoAsync(clip.uri);
    if (!info.exists) {
      setMissing(clip.uri);
      setPlaying(null);
      return;
    }
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: clip.uri }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(clip.uri);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setPlaying((p) => (p === clip.uri ? null : p));
          void sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
        }
      });
    } catch {
      setPlaying(null);
    }
  };

  return (
    <View style={styles.clipList}>
      {clips.map((clip) => {
        const time = formatTimeOfDay(clip.startTs);
        const isPlaying = playing === clip.uri;
        return (
          <GentlePressable
            key={clip.uri}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? t('listening.pauseA11y') : t('listening.playA11y', { time })}
            onPress={() => void toggle(clip)}
            style={({ pressed }) => [styles.clipRow, pressed && styles.pressed]}
          >
            <Ionicons
              name={isPlaying ? 'pause-circle-outline' : 'play-circle-outline'}
              size={24}
              color={theme.colors.gold}
            />
            <Text style={styles.clipText}>
              {time} · {formatDuration(clip.durationMs)}
            </Text>
            {missing === clip.uri ? (
              <Text style={styles.caption}>{t('listening.clipMissing')}</Text>
            ) : null}
          </GentlePressable>
        );
      })}
    </View>
  );
}

function ModelCheckLines({ result }: { result: ModelCheckResult }) {
  const { t } = useI18n();
  const r1 = (n?: number) => (typeof n === 'number' ? n.toFixed(1) : '–');
  const r0 = (n?: number) => (typeof n === 'number' ? Math.round(n).toString() : '–');
  return (
    <View style={styles.checkLines}>
      <Text style={styles.monoText}>{result.device} · Android {result.android}</Text>
      <Text style={styles.monoText}>
        {t('listening.modelCheckSpeech', { ms: r1(result.vadMsPerFrame) })}
      </Text>
      <Text style={styles.monoText}>
        {t('listening.modelCheckVoice', {
          ms2: r0(result.speakerMsPer2sWindow_2t),
          ms1: r0(result.speakerMsPer2sWindow_1t),
        })}
      </Text>
      <Text style={styles.monoText}>{t('listening.modelCheckMemory', { mb: r0(result.peakRssMb) })}</Text>
      <Text style={styles.monoText}>
        {t('listening.modelCheckScreen', {
          state: result.screenOn ? t('listening.screenOn') : t('listening.screenOff'),
        })}
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return translate('listening.hoursMinutes', { h, m });
  if (m > 0) return translate('listening.minutes', { m, s: s % 60 });
  return translate('listening.seconds', { s });
}

function formatTimeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.base },
  scrollContent: { flexGrow: 1, paddingHorizontal: theme.spacing['2xl'] },
  header: { flexDirection: 'row', marginBottom: theme.spacing['2xl'] },
  backChip: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  backChipText: { ...theme.type.label, color: theme.colors.sand },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
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
    marginBottom: theme.spacing.md,
  },
  testBanner: {
    ...theme.type.caption,
    color: theme.colors.error,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  centerColumn: { alignItems: 'center' },
  circleWrap: { marginVertical: theme.spacing['2xl'], alignItems: 'center' },
  startCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
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
    lineHeight: 28,
    color: theme.colors.gold,
    textAlign: 'center',
  },
  dotWrap: { marginVertical: theme.spacing['2xl'] },
  dot: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  dotActive: { backgroundColor: theme.colors.gold, borderColor: theme.colors.gold },
  timerText: { ...theme.type.display, color: theme.colors.cream, marginBottom: theme.spacing.md },
  metricRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    width: '100%',
    marginVertical: theme.spacing.lg,
  },
  metricTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    alignItems: 'center',
  },
  metricLabel: { ...theme.type.caption, color: theme.colors.clay, textAlign: 'center' },
  metricValue: { ...theme.type.label, color: theme.colors.cream, marginTop: 4 },
  stopButton: {
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.cta,
    paddingHorizontal: theme.spacing['3xl'],
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  stopButtonText: { ...theme.type.label, color: theme.colors.cream, fontSize: 15 },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginTop: theme.spacing.lg,
  },
  cardTitle: { ...theme.type.label, color: theme.colors.cream, marginBottom: theme.spacing.sm },
  cardBody: { ...theme.type.body, color: theme.colors.sand },
  caption: { ...theme.type.caption, color: theme.colors.clay, marginTop: theme.spacing.xs },
  errorText: { ...theme.type.caption, color: theme.colors.error, marginTop: theme.spacing.sm },
  clipsTitle: { marginTop: theme.spacing.lg },
  clipList: { gap: theme.spacing.xs },
  clipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  clipText: { ...theme.type.body, color: theme.colors.cream },
  checkLines: { marginTop: theme.spacing.md, gap: 2 },
  monoText: { ...theme.type.caption, color: theme.colors.cream, fontFamily: fonts.regular },
  secondaryButton: {
    marginTop: theme.spacing.md,
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  secondaryButtonText: { ...theme.type.label, color: theme.colors.sand, textAlign: 'center' },
  linkRow: { marginTop: theme.spacing['2xl'], alignItems: 'center' },
  linkText: { ...theme.type.label, color: theme.colors.gold },
});
