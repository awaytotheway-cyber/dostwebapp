import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, radius, spacing } from '../lib/theme';
import { processVoiceNoteAfterTranscript } from '../lib/processVoiceNote';
import { transcribeVoiceNote } from '../lib/transcribeVoiceNote';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { ChatStackParamList } from './chatTypes';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import { t as translate, useI18n } from '../lib/i18n';

type Props = NativeStackScreenProps<ChatStackParamList, 'VoiceNoteRecord'>;

type Phase = 'idle' | 'recording' | 'processing' | 'error';
type PipelineFailKind = 'transcribe' | 'pipeline';
const dawn = {
  base: '#1A1614',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  terracotta: '#B84C30',
  terracottaDeep: '#9E3D22',
} as const;

const MAX_MS = 3 * 60 * 1000;
const MIN_MS = 2000;
const BUTTON_SIZE = 180;


const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/mp4',
    bitsPerSecond: 128000,
  },
};

function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VoiceNoteRecordScreen({ navigation }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [failKind, setFailKind] = useState<PipelineFailKind | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const pressActiveRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const autoStoppedRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipelineGenRef = useRef(0);
  const mountedRef = useRef(true);

  const pulse = useRef(new Animated.Value(0)).current;
  const expand = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pipelineGenRef.current += 1;
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      const active = recordingRef.current;
      recordingRef.current = null;
      if (active) {
        void (async () => {
          try {
            await active.stopAndUnloadAsync();
          } catch {
            // Already stopped or unloaded.
          }
        })();
      }
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording' || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      expand.stopAnimation();
      expand.setValue(1);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    const expandLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(expand, {
          toValue: 1.06,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(expand, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    expandLoop.start();
    return () => {
      pulseLoop.stop();
      expandLoop.stop();
    };
  }, [phase, pulse, expand, reduceMotion]);

  function clearTimers() {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function startTimers() {
    clearTimers();
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    tickRef.current = setInterval(() => {
      if (!startedAtRef.current) return;
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);
    maxTimerRef.current = setTimeout(() => {
      autoStoppedRef.current = true;
      void finishRecording('max');
    }, MAX_MS);
  }

  async function ensureMicPermission(): Promise<boolean> {
    try {
      const current = await Audio.getPermissionsAsync();
      if (current.granted) return true;
      const asked = await Audio.requestPermissionsAsync();
      if (asked.granted) return true;
      if (mountedRef.current) {
        setStatusMessage(translate('voiceRecord.micDenied'));
        setPhase('idle');
      }
      return false;
    } catch {
      if (mountedRef.current) {
        setStatusMessage(translate('voiceRecord.micDenied'));
        setPhase('idle');
      }
      return false;
    }
  }

  async function beginRecording() {
    if (recordingRef.current) return;
    if (phase === 'processing') return;

    // New take — drop any prior transcript / error.
    pipelineGenRef.current += 1;
    setStatusMessage(null);
    setTranscript(null);
    setFailKind(null);

    const granted = await ensureMicPermission();
    if (!granted) {
      pressActiveRef.current = false;
      return;
    }
    if (!pressActiveRef.current || !mountedRef.current) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();

      if (!pressActiveRef.current || !mountedRef.current) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          // Discarded before hold settled.
        }
        return;
      }

      recordingRef.current = recording;
      autoStoppedRef.current = false;
      setPhase('recording');
      startTimers();
      AccessibilityInfo.announceForAccessibility(translate('voiceRecord.announceRecording'));
    } catch {
      recordingRef.current = null;
      if (mountedRef.current) {
        setPhase('idle');
        setStatusMessage(translate('voiceRecord.couldNotStart'));
      }
      pressActiveRef.current = false;
    }
  }

  async function runPipeline(
    uri: string,
    text: string,
    durationMs: number,
    gen: number,
  ) {
    if (mountedRef.current) {
      setPhase('processing');
      setFailKind(null);
      setStatusMessage(translate('voiceRecord.reflecting'));
    }
    AccessibilityInfo.announceForAccessibility(translate('voiceRecord.reflectingA11y'));

    const result = await processVoiceNoteAfterTranscript({
      transcript: text,
      audioUri: uri,
      durationMs,
      onProgress: (step) => {
        if (!mountedRef.current || gen !== pipelineGenRef.current) return;
        if (step === 'reflecting') {
          setStatusMessage(translate('voiceRecord.reflecting'));
        } else if (step === 'sensing') {
          setStatusMessage(translate('voiceRecord.sensing'));
        } else {
          setStatusMessage(translate('voiceRecord.savingNote'));
        }
      },
    });

    if (!mountedRef.current || gen !== pipelineGenRef.current) return;

    if (!result.ok) {
      setPhase('error');
      setFailKind('pipeline');
      setStatusMessage(result.message);
      AccessibilityInfo.announceForAccessibility(result.message);
      return;
    }

    const note = result.note;
    navigation.replace('VoiceNoteDetail', {
      id: note.id,
      transcript: note.transcript,
      dost_response: note.dost_response,
      primary_emotion: note.primary_emotion,
      secondary_emotions: note.secondary_emotions,
      underlying_need: note.underlying_need,
      duration_seconds:
        typeof note.duration_seconds === 'number'
          ? note.duration_seconds
          : undefined,
      audio_storage_path: note.audio_storage_path,
      created_at: note.created_at,
    });
  }

  async function runTranscription(uri: string, durationMs: number) {
    const gen = ++pipelineGenRef.current;
    if (mountedRef.current) {
      setPhase('processing');
      setFailKind(null);
      setTranscript(null);
    }
    AccessibilityInfo.announceForAccessibility(translate('voiceRecord.announceListeningBack'));

    const result = await transcribeVoiceNote(uri);
    if (!mountedRef.current || gen !== pipelineGenRef.current) return;

    if (!result.ok) {
      setPhase('error');
      setFailKind('transcribe');
      setStatusMessage(result.message);
      AccessibilityInfo.announceForAccessibility(result.message);
      return;
    }

    setTranscript(result.transcript);
    void runPipeline(uri, result.transcript, durationMs, gen);
  }

  async function finishRecording(reason: 'release' | 'max') {
    clearTimers();
    const recording = recordingRef.current;
    recordingRef.current = null;

    if (!recording) {
      if (mountedRef.current && reason === 'release') {
        setPhase('idle');
      }
      return;
    }

    if (mountedRef.current) setPhase('processing');

    let uri: string | null = null;
    let durationMs = 0;
    try {
      const status = await recording.getStatusAsync();
      if (status.isRecording || status.canRecord) {
        await recording.stopAndUnloadAsync();
      }
      uri = recording.getURI();
      if (startedAtRef.current) {
        durationMs = Date.now() - startedAtRef.current;
      }
      if (status.durationMillis != null && status.durationMillis > 0) {
        durationMs = status.durationMillis;
      }
    } catch {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // Already unloaded.
      }
    }

    startedAtRef.current = null;
    setElapsedMs(0);

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // Mode reset is best-effort.
    }

    if (!mountedRef.current) return;

    if (durationMs < MIN_MS) {
      setRecordingUri(null);
      setRecordingDurationMs(0);
      setTranscript(null);
      setFailKind(null);
      setPhase('idle');
      setStatusMessage(translate('voiceRecord.tooShort'));
      return;
    }

    if (!uri) {
      setRecordingUri(null);
      setRecordingDurationMs(0);
      setTranscript(null);
      setFailKind(null);
      setPhase('error');
      setStatusMessage(translate('voiceRecord.couldNotSaveRecording'));
      return;
    }

    setRecordingUri(uri);
    setRecordingDurationMs(durationMs);

    if (reason === 'max') {
      if (mountedRef.current) {
        setStatusMessage(translate('voiceRecord.fullNote'));
      }
      AccessibilityInfo.announceForAccessibility(translate('voiceRecord.fullNoteA11y'));
    }

    void runTranscription(uri, durationMs);
  }

  function onPressIn() {
    if (phase === 'processing') return;
    pressActiveRef.current = true;
    autoStoppedRef.current = false;
    void beginRecording();
  }

  function onPressOut() {
    pressActiveRef.current = false;
    if (autoStoppedRef.current) return;
    if (!recordingRef.current && phase !== 'recording') return;
    void finishRecording('release');
  }

  function onRetry() {
    if (!recordingUri || phase === 'processing') return;
    if (failKind === 'pipeline' && transcript) {
      const gen = ++pipelineGenRef.current;
      void runPipeline(recordingUri, transcript, recordingDurationMs, gen);
      return;
    }
    void runTranscription(recordingUri, recordingDurationMs);
  }

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  const recording = phase === 'recording';
  const label =
    statusMessage ??
    (phase === 'recording'
      ? t('voiceRecord.releaseWhenDone', { time: formatMmSs(elapsedMs) })
      : phase === 'processing'
        ? t('voiceRecord.listeningBack')
        : t('voiceRecord.holdToSpeak'));

  const labelColor =
    recording || phase === 'processing' || phase === 'error' || statusMessage
      ? dawn.terracotta
      : dawn.cream;

  return (
    <View style={styles.container}>
      <PaperGrain />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
      >
        <View style={styles.header}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.backPlain')}
            onPress={() => {
              if (phase === 'processing') return;
              pipelineGenRef.current += 1;
              navigation.goBack();
            }}
            disabled={phase === 'processing'}
            hitSlop={10}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
              phase === 'processing' && styles.backDisabled,
            ]}
          >
            <Ionicons name="chevron-back" size={26} color={dawn.cream} />
          </GentlePressable>
          <Text accessibilityRole="header" style={styles.title}>
            {t('voiceRecord.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.middle}>
          <View style={styles.buttonWrap}>
            {recording && !reduceMotion ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ring,
                  {
                    opacity: ringOpacity,
                    transform: [{ scale: ringScale }],
                  },
                ]}
              />
            ) : null}
            <Animated.View
              style={{
                transform: [{ scale: recording && !reduceMotion ? expand : 1 }],
              }}
            >
              <Pressable
                onPressIn={onPressIn}
                onPressOut={onPressOut}
                disabled={phase === 'processing'}
                accessibilityRole="button"
                accessibilityLabel={
                  recording ? t('voiceRecord.recordingA11y') : t('voiceRecord.holdToSpeak')
                }
                accessibilityHint={t('voiceRecord.buttonHint')}
                accessibilityState={{
                  busy: recording || phase === 'processing',
                  disabled: phase === 'processing',
                }}
                style={({ pressed }) => [
                  styles.recordButton,
                  recording && styles.recordButtonActive,
                  (pressed || recording) && styles.recordButtonPressed,
                  phase === 'processing' && styles.recordButtonDisabled,
                ]}
              >
                <Ionicons
                  name={recording ? 'mic' : 'mic-outline'}
                  size={56}
                  color={dawn.base}
                />
              </Pressable>
            </Animated.View>
          </View>

          <Text
            style={[styles.label, { color: labelColor }]}
            accessibilityLiveRegion="polite"
          >
            {label}
          </Text>

          {phase === 'error' && recordingUri ? (
            <GentlePressable
              accessibilityRole="button"
              accessibilityLabel={t('common.tryAgain')}
              onPress={onRetry}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryLabel}>{t('common.tryAgain')}</Text>
            </GentlePressable>
          ) : null}
        </View>

        <Text style={styles.footer}>{t('voiceRecord.footer')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dawn.base,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    color: dawn.cream,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['2xl'],
  },
  buttonWrap: {
    width: BUTTON_SIZE + 64,
    height: BUTTON_SIZE + 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.full,
    backgroundColor: dawn.terracotta,
  },
  recordButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: dawn.terracotta,
  },
  recordButtonActive: {
    backgroundColor: dawn.terracottaDeep,
  },
  recordButtonPressed: {
    backgroundColor: dawn.terracottaDeep,
  },
  recordButtonDisabled: {
    opacity: 0.7,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  retryButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: dawn.terracotta,
  },
  retryLabel: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: dawn.terracotta,
    textAlign: 'center',
  },
  footer: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: dawn.sand,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});
