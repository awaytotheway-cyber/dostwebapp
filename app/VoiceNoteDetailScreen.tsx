import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  generateSuggestionChips,
  labelForEmotionChip,
} from '../lib/dost/suggestionChips';
import { labelForExtractedEmotion, type ConversationStage } from '../lib/emotionalStates';
import {
  deleteVoiceNote,
  getVoiceNoteAudioUrl,
  loadVoiceNoteById,
  type VoiceNoteRecord,
} from '../lib/processVoiceNote';
import { fonts, radius, spacing } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import BreathingDot from './BreathingDot';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';
import { SuggestionChips } from './SuggestionChips';
import { getLocaleTag, t as translate, useI18n } from '../lib/i18n';

type Props = NativeStackScreenProps<ChatStackParamList, 'VoiceNoteDetail'>;

const dawn = {
  base: '#1A1614',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  gold: '#D9A857',
  goldSoft: 'rgba(217, 168, 87, 0.14)',
  border: 'rgba(201, 183, 156, 0.28)',
  terracotta: '#C77B5A',
} as const;

const WAVEFORM_HEIGHTS = [
  8, 14, 10, 18, 12, 22, 16, 11, 20, 9, 15, 21, 13, 17, 10, 19, 12, 8, 16, 14,
  11, 18, 9, 15,
];

function detectedEmotionLabels(note: {
  primary_emotion?: string | null;
  secondary_emotions?: string[] | null;
}): string[] {
  const labels: string[] = [];
  if (note.primary_emotion) {
    labels.push(labelForExtractedEmotion(note.primary_emotion));
  }
  if (Array.isArray(note.secondary_emotions)) {
    for (const token of note.secondary_emotions) {
      if (typeof token !== 'string' || !token.trim()) continue;
      const label = labelForExtractedEmotion(token.trim());
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

function formatLetterTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString(getLocaleTag(), {
    hour: 'numeric',
    minute: '2-digit',
  });

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round(
    (startToday.getTime() - startThat.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDiff === 0) return translate('past.today', { time });
  if (dayDiff === 1) return translate('past.yesterday', { time });

  const day = date.toLocaleDateString(getLocaleTag(), {
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

function noteFromParams(
  params: Props['route']['params'],
): VoiceNoteRecord | null {
  if (!params?.id || !params.transcript) return null;
  return {
    id: params.id,
    transcript: params.transcript,
    dost_response: params.dost_response ?? null,
    primary_emotion: params.primary_emotion ?? null,
    secondary_emotions: params.secondary_emotions ?? null,
    underlying_need: params.underlying_need ?? null,
    duration_seconds: params.duration_seconds ?? 0,
    audio_storage_path: params.audio_storage_path ?? null,
    created_at: params.created_at ?? '',
  };
}

function resolveVoiceNoteStage(
  note: VoiceNoteRecord | null,
  chipsDismissed: boolean,
): ConversationStage | null {
  if (chipsDismissed || !note?.primary_emotion || !note.dost_response) return null;
  return 'naming_emotion';
}

export default function VoiceNoteDetailScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const paramId = route.params?.id;

  const [note, setNote] = useState<VoiceNoteRecord | null>(() =>
    noteFromParams(route.params),
  );
  const [loading, setLoading] = useState(Boolean(paramId) && !note);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [chipsDismissed, setChipsDismissed] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (!paramId) {
      setLoading(false);
      setError(translate('voiceDetail.notFound'));
      return;
    }

    let cancelled = false;
    const hasInstant = Boolean(route.params?.transcript);
    if (!hasInstant) setLoading(true);

    void (async () => {
      const loaded = await loadVoiceNoteById(paramId);
      if (cancelled) return;
      if (!loaded) {
        if (!hasInstant) {
          setError(translate('voiceDetail.notFound'));
          setNote(null);
        }
      } else {
        setNote(loaded);
        setError(null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [paramId, route.params?.transcript]);

  useEffect(() => {
    const path = note?.audio_storage_path;
    if (!path) {
      setAudioReady(false);
      return;
    }

    let cancelled = false;
    setAudioLoading(true);

    void (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
        const url = await getVoiceNoteAudioUrl(path);
        if (cancelled || !url) {
          if (!cancelled) setAudioReady(false);
          return;
        }

        if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false },
          (status) => {
            if (!status.isLoaded) return;
            if (status.didJustFinish) {
              setPlaying(false);
              void sound.setPositionAsync(0).catch(() => {});
            }
          },
        );
        if (cancelled) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
        setAudioReady(true);
      } catch {
        if (!cancelled) setAudioReady(false);
      } finally {
        if (!cancelled) setAudioLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      const current = soundRef.current;
      soundRef.current = null;
      if (current) {
        void current.stopAsync().catch(() => {});
        void current.unloadAsync().catch(() => {});
      }
      setPlaying(false);
    };
  }, [note?.audio_storage_path]);

  const conversationStage = useMemo(
    () => resolveVoiceNoteStage(note, chipsDismissed),
    [chipsDismissed, note],
  );

  const { suggested_emotions } = useMemo(() => {
    if (!conversationStage || !note?.primary_emotion) {
      return { suggested_emotions: [] };
    }
    return generateSuggestionChips({
      conversation_stage: conversationStage,
      primary_emotion: note.primary_emotion,
      secondary_emotions: note.secondary_emotions ?? [],
    });
  }, [conversationStage, note]);

  const detectedLabels = useMemo(
    () => (note ? detectedEmotionLabels(note) : []),
    [note, lang],
  );

  const showSuggestionChips = suggested_emotions.length > 0;

  const showDetectedPills =
    detectedLabels.length > 0 && !showSuggestionChips && chipsDismissed;

  const navigateToChat = useCallback(
    (opts?: {
      autoChipMessage?: {
        text: string;
        selected_emotion?: string;
        selected_need?: string;
      };
    }) => {
      if (!note?.transcript) return;
      void soundRef.current?.stopAsync().catch(() => {});
      setPlaying(false);
      navigation.navigate('Chat', {
        newSession: true,
        voiceNoteContinue: {
          transcript: note.transcript,
          dostResponse: note.dost_response,
          autoChipMessage: opts?.autoChipMessage,
        },
      });
    },
    [navigation, note],
  );

  const onTogglePlayback = async () => {
    const sound = soundRef.current;
    if (!sound || !audioReady) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
        setPlaying(false);
      } else {
        await sound.playAsync();
        setPlaying(true);
      }
    } catch {
      setPlaying(false);
    }
  };

  const onContinue = () => {
    navigateToChat();
  };

  const onEmotionChipSelect = useCallback(
    (token: string) => {
      if (token === '__skip__') {
        setChipsDismissed(true);
        return;
      }
      navigateToChat({
        autoChipMessage: {
          text: t('chat.chipEmotionMessage', { label: labelForEmotionChip(token) }),
          selected_emotion: token,
        },
      });
    },
    [navigateToChat, t],
  );

  const runDelete = async () => {
    if (!note || deleting) return;
    setDeleting(true);
    try {
      void soundRef.current?.stopAsync().catch(() => {});
      const result = await deleteVoiceNote({
        id: note.id,
        audio_storage_path: note.audio_storage_path,
      });
      if (!result.ok) {
        Alert.alert(t('settings.couldNotDelete'), result.message);
        return;
      }
      navigation.goBack();
    } catch {
      Alert.alert(t('settings.couldNotDelete'), t('common.pleaseTryAgain'));
    } finally {
      setDeleting(false);
    }
  };

  const onDelete = () => {
    Alert.alert(
      t('voiceDetail.deleteTitle'),
      t('voiceDetail.deleteBody'),
      [
        { text: t('voiceDetail.keep'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void runDelete();
          },
        },
      ],
    );
  };

  const timestamp = formatLetterTimestamp(note?.created_at);
  const showPlayback = Boolean(note?.audio_storage_path);

  return (
    <View style={styles.container}>
      <PaperGrain />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <GentlePressable
            accessibilityRole="button"
            accessibilityLabel={t('common.backPlain')}
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={22} color={dawn.sand} />
          </GentlePressable>
          {timestamp ? (
            <Text style={styles.timestamp} numberOfLines={1}>
              {timestamp}
            </Text>
          ) : (
            <View style={styles.timestampSpacer} />
          )}
          <View style={styles.backButton} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <View style={styles.loadingRow} accessibilityLabel={t('voiceDetail.openingA11y')}>
              <BreathingDot size={10} color={dawn.gold} />
              <Text style={styles.loadingText}>{t('voiceDetail.opening')}</Text>
            </View>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : note ? (
          <>
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              {showPlayback ? (
                <View style={styles.playbackRow}>
                  <GentlePressable
                    accessibilityRole="button"
                    accessibilityLabel={playing ? t('voiceDetail.pause') : t('voiceDetail.play')}
                    onPress={() => {
                      void onTogglePlayback();
                    }}
                    disabled={!audioReady || audioLoading}
                    style={styles.playButton}
                  >
                    {audioLoading ? (
                      <ActivityIndicator color={dawn.sand} size="small" />
                    ) : (
                      <Ionicons
                        name={playing ? 'pause' : 'play'}
                        size={18}
                        color={dawn.sand}
                      />
                    )}
                  </GentlePressable>
                  <View style={styles.waveform} accessibilityElementsHidden>
                    {WAVEFORM_HEIGHTS.map((h, i) => (
                      <View
                        key={`w-${i}`}
                        style={[
                          styles.waveBar,
                          {
                            height: h,
                            opacity: playing ? 0.9 : 0.45,
                          },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.transcriptBox}>
                <Text style={styles.transcript}>{note.transcript}</Text>
              </View>

              {showDetectedPills ? (
                <View style={styles.chipRow}>
                  {detectedLabels.map((label) => (
                    <View key={label} style={styles.staticChip}>
                      <Text style={styles.staticChipLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {note.dost_response ? (
                <View style={styles.reflectionBlock}>
                  <Text style={styles.reflectionLabel}>DOST</Text>
                  <Text style={styles.reflection}>{note.dost_response}</Text>
                  {suggested_emotions.length > 0 ? (
                    <SuggestionChips
                      options={suggested_emotions}
                      label={t('chat.chipsEmotion')}
                      labelForOption={labelForEmotionChip}
                      onSelect={onEmotionChipSelect}
                    />
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              <GentlePressable
                accessibilityRole="button"
                accessibilityLabel={t('voiceDetail.continueReflection')}
                onPress={onContinue}
                style={styles.continueButton}
              >
                <Text style={styles.continueLabel}>{t('voiceDetail.continueReflection')}</Text>
              </GentlePressable>
              <GentlePressable
                accessibilityRole="button"
                accessibilityLabel={t('voiceDetail.deleteA11y')}
                onPress={onDelete}
                disabled={deleting}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteLabel}>
                  {deleting ? t('common.deleting') : t('common.delete')}
                </Text>
              </GentlePressable>
            </View>
          </>
        ) : null}
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  timestamp: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: dawn.sand,
  },
  timestampSpacer: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: 15,
    lineHeight: 22,
    color: dawn.sand,
    fontFamily: fonts.italic,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: dawn.gold,
    textAlign: 'center',
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: dawn.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flex: 1,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveBar: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: dawn.sand,
  },
  transcriptBox: {
    borderWidth: 1,
    borderColor: dawn.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  transcript: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 28,
    color: dawn.cream,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  staticChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: dawn.goldSoft,
    borderWidth: 1,
    borderColor: dawn.gold,
  },
  staticChipLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: dawn.gold,
  },
  reflectionBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  reflectionLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: dawn.sand,
    textTransform: 'uppercase',
  },
  reflection: {
    fontSize: 16,
    lineHeight: 28,
    color: dawn.cream,
    fontFamily: fonts.italic,
    opacity: 0.92,
  },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.cta,
    borderWidth: 1,
    borderColor: dawn.border,
    backgroundColor: 'rgba(237, 228, 211, 0.06)',
  },
  continueLabel: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
    color: dawn.cream,
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  deleteLabel: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: dawn.terracotta,
  },
});
