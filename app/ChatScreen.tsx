import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatChatErrorForUi, sendChatMessage } from '../lib/chat';
import {
  labelForEmotionChip,
  labelForNeedChip,
} from '../lib/dost/suggestionChips';
import {
  clearAllLocalData,
  getDb,
  getMessagesBefore,
  getRecentMessages,
  insertMessage,
  updateMessageDelivery,
  type DeliveryStatus,
  type LocalDb,
  type LocalMessage,
} from '../lib/localDb';
import {
  getChatSessionStart,
  openChatFromMessage,
  startNewChatSession,
} from '../lib/chatSession';
import { fetchOlderFromServer, reconcileRecentAfterSend, seedFromServer, syncFromServer } from '../lib/sync';
import { updateUserMemory } from '../lib/memory';
import { loadMyProfile } from '../lib/profile';
import {
  EXPO_GO_VOICE_MESSAGE,
  MIC_BUSY_MESSAGE,
  MIC_NO_SPEECH,
  MIC_PERMISSION_DENIED,
  MIC_START_FAIL,
  SPEECH_UNAVAILABLE_MESSAGE,
  abortDictation,
  getMicPermissionState,
  isExpoGo,
  loadSpeechModule,
  requestMicPermission,
  speechUnavailableReason,
  startDictation,
  stopDictation,
  subscribeSpeech,
  type SpeechNativeModule,
} from '../lib/speech';
import type { EmotionalStateToken } from '../lib/emotionalStates';
import {
  REFLECTION_FOLLOW_UP,
  REFLECTION_OPENING,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import type { ChatStackParamList } from './chatTypes';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import BreathingDot from './BreathingDot';
import EmotionPicker from './EmotionPicker';
import GentlePressable from './GentlePressable';
import MicButton, { type MicUiState } from './MicButton';
import PaperGrain from './PaperGrain';
import { SuggestionChips } from './SuggestionChips';
import { useReducedMotion } from '../lib/useReducedMotion';

const MAX_MESSAGE_LEN = 2000;
const USER_ID = 1;
const DOST_ID = 2;
const MEMORY_EXCHANGE_THRESHOLD = 5;
const VOICE_MISS = MIC_NO_SPEECH;
const OFFLINE_BANNER = "Offline — DOST will respond when you're back";
const SEND_FAIL_HINT = "Something's off on my end. Tap the grey message to retry.";
const LISTEN_WATCHDOG_MS = 12_000;

type MessageChips = {
  suggested_emotions: string[];
  suggested_needs: string[];
  dismissed?: boolean;
  disabled?: boolean;
};

type ChatMessage = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: number; name: string };
  deliveryStatus?: DeliveryStatus;
  chips?: MessageChips;
};

type ChipSendOptions = {
  selected_emotion?: string;
  selected_need?: string;
};

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'> & {
  onStartOver?: () => void;
};

function createClientId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function greetingText(name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return `Namaste, ${trimmed}. What's on your mind today? Whenever you're ready.`;
  return "Namaste — what's on your mind today? Whenever you're ready.";
}

function greetingMessage(name?: string | null): ChatMessage {
  return {
    _id: 'welcome',
    text: greetingText(name),
    createdAt: new Date(),
    user: { _id: DOST_ID, name: 'DOST' },
  };
}

function localToChatMessage(row: LocalMessage): ChatMessage {
  const mine = row.role === 'user';
  return {
    _id: row.id,
    text: row.content,
    createdAt: new Date(row.created_at),
    user: mine
      ? { _id: USER_ID, name: 'You' }
      : { _id: DOST_ID, name: 'DOST' },
    deliveryStatus: mine ? row.delivery_status : undefined,
  };
}

const VOICE_CONTINUE_USER_ID = 'voice-continue-user';
const VOICE_CONTINUE_DOST_ID = 'voice-continue-dost';

function isSyntheticChatId(id: string): boolean {
  return (
    id === 'welcome' ||
    id === 'reflection-opening' ||
    id === VOICE_CONTINUE_USER_ID ||
    id === VOICE_CONTINUE_DOST_ID
  );
}

function mergeById(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of existing) {
    if (isSyntheticChatId(m._id)) continue;
    map.set(m._id, m);
  }
  for (const m of incoming) {
    map.set(m._id, m);
  }
  const reflection = existing.find((m) => m._id === 'reflection-opening');
  const voiceUser = existing.find((m) => m._id === VOICE_CONTINUE_USER_ID);
  const voiceDost = existing.find((m) => m._id === VOICE_CONTINUE_DOST_ID);
  const sorted = Array.from(map.values()).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  if (sorted.length === 0) {
    if (voiceUser) {
      return voiceDost ? [voiceUser, voiceDost] : [voiceUser];
    }
    return reflection ? [greetingMessage(), reflection] : [greetingMessage()];
  }
  const withVoice = voiceUser
    ? voiceDost
      ? [voiceUser, voiceDost, ...sorted]
      : [voiceUser, ...sorted]
    : sorted;
  return reflection ? [...withVoice, reflection] : withVoice;
}

function isOnlineState(state: NetInfoState | null): boolean {
  if (!state) return true;
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

type MessageRowProps = {
  item: ChatMessage;
  claimEntrance: (id: string) => boolean;
  reduceMotion: boolean;
  retryMessage: (id: string) => Promise<void>;
  chipsActive: boolean;
  onEmotionChipSelect: (token: string) => void;
  onNeedChipSelect: (token: string) => void;
};

function MessageRow({
  item,
  claimEntrance,
  reduceMotion,
  retryMessage,
  chipsActive,
  onEmotionChipSelect,
  onNeedChipSelect,
}: MessageRowProps) {
  const mine = item.user._id === USER_ID;
  const pending = mine && item.deliveryStatus === 'pending';
  const failed = mine && item.deliveryStatus === 'failed';
  const shouldEnter = useRef(claimEntrance(item._id)).current;
  const entrance = useRef(new Animated.Value(shouldEnter ? 0 : 1)).current;

  useEffect(() => {
    entrance.stopAnimation();
    if (!shouldEnter || reduceMotion) {
      entrance.setValue(1);
      return;
    }
    Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, reduceMotion, shouldEnter]);

  return (
    <Animated.View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={() => {
          if (failed) void retryMessage(item._id);
        }}
        disabled={!failed}
      >
        {!mine ? (
          <View style={styles.senderRow}>
            <View style={styles.presenceDot} />
            <Text style={styles.sender}>{item.user.name}</Text>
          </View>
        ) : null}
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            pending && styles.bubblePending,
            failed && styles.bubbleFailed,
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              mine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
              (pending || failed) && styles.bubbleTextUnsent,
            ]}
          >
            {item.text}
          </Text>
        </View>
        {pending ? <Text style={styles.sending}>Sending…</Text> : null}
        {failed ? <Text style={styles.notSent}>Not sent · tap to retry</Text> : null}
      </Pressable>
      {!mine && item.chips && !item.chips.dismissed ? (
        <>
          {item.chips.suggested_emotions.length > 0 ? (
            <SuggestionChips
              options={item.chips.suggested_emotions}
              label="What does this feel like?"
              labelForOption={labelForEmotionChip}
              onSelect={onEmotionChipSelect}
              disabled={!chipsActive || item.chips.disabled}
            />
          ) : null}
          {item.chips.suggested_needs.length > 0 ? (
            <SuggestionChips
              options={item.chips.suggested_needs}
              label="What might you be needing?"
              labelForOption={labelForNeedChip}
              onSelect={onNeedChipSelect}
              disabled={!chipsActive || item.chips.disabled}
            />
          ) : null}
        </>
      ) : null}
    </Animated.View>
  );
}

export default function ChatScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const sendingRef = useRef(false);
  const sessionExchangesRef = useRef(0);
  const reflectionModeRef = useRef(false);
  const reflectionFollowUpRef = useRef(false);
  const speechModRef = useRef<SpeechNativeModule | null>(null);
  const listenBaseRef = useRef('');
  const micBusyRef = useRef(false);
  const listenWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbRef = useRef<LocalDb | null>(null);
  const userIdRef = useRef<string | null>(null);
  const profileNameRef = useRef<string | null>(null);
  const sessionStartRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const wasOfflineRef = useRef(false);
  const createdAtByIdRef = useRef<Map<string, string>>(new Map());
  const entranceCandidatesRef = useRef<Set<string>>(new Set());
  const enteredMessageIdsRef = useRef<Set<string>>(new Set());
  const emotionalStateRef = useRef<EmotionalStateToken | null>(null);
  const pendingAssistantChipsRef = useRef<MessageChips | null>(null);
  const pendingVoiceChipRef = useRef<ChipSendOptions & { text: string } | null>(
    null,
  );

  const [messages, setMessages] = useState<ChatMessage[]>([greetingMessage()]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [gentleLoading, setGentleLoading] = useState(false);
  const [showNoticingsBanner, setShowNoticingsBanner] = useState(false);
  const [micState, setMicState] = useState<MicUiState>('idle');
  const [isOnline, setIsOnline] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [sendHint, setSendHint] = useState<string | null>(null);
  const [permHint, setPermHint] = useState(false);
  const [emotionalState, setEmotionalState] = useState<EmotionalStateToken | null>(
    null,
  );
  const [emotionCollapsed, setEmotionCollapsed] = useState(true);
  const [chipSkipHint, setChipSkipHint] = useState(false);

  const activeChipsMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (
        message.chips &&
        !message.chips.dismissed &&
        !message.chips.disabled
      ) {
        return message._id;
      }
    }
    return null;
  }, [messages]);

  const claimEntrance = useCallback((id: string) => {
    if (
      !entranceCandidatesRef.current.has(id) ||
      enteredMessageIdsRef.current.has(id)
    ) {
      return false;
    }
    entranceCandidatesRef.current.delete(id);
    enteredMessageIdsRef.current.add(id);
    return true;
  }, []);

  const clearListenWatchdog = useCallback(() => {
    if (listenWatchdogRef.current) {
      clearTimeout(listenWatchdogRef.current);
      listenWatchdogRef.current = null;
    }
  }, []);

  const resetMicIdle = useCallback(() => {
    clearListenWatchdog();
    micBusyRef.current = false;
    setMicState('idle');
  }, [clearListenWatchdog]);

  useEffect(() => {
    emotionalStateRef.current = emotionalState;
  }, [emotionalState]);

  const applyLocalRows = useCallback((rows: LocalMessage[], name?: string | null) => {
    for (const row of rows) {
      createdAtByIdRef.current.set(row.id, row.created_at);
    }
    setMessages((prev) => {
      const chipById = new Map<string, MessageChips>();
      for (const message of prev) {
        if (message.chips) {
          chipById.set(message._id, message.chips);
        }
      }

      const voiceUser = prev.find((m) => m._id === VOICE_CONTINUE_USER_ID);
      const voiceDost = prev.find((m) => m._id === VOICE_CONTINUE_DOST_ID);
      const voicePrefix = [voiceUser, voiceDost].filter(
        (m): m is ChatMessage => Boolean(m),
      );

      if (rows.length === 0) {
        if (voicePrefix.length > 0) return voicePrefix;
        return [greetingMessage(name ?? profileNameRef.current)];
      }
      return [
        ...voicePrefix,
        ...rows.map((row) => {
          const chat = localToChatMessage(row);
          const chips = chipById.get(chat._id);
          return chips ? { ...chat, chips } : chat;
        }),
      ].map((message, index, list) => {
        const pending = pendingAssistantChipsRef.current;
        if (!pending) return message;
        const isLastAssistant =
          message.user._id === DOST_ID &&
          !list.slice(index + 1).some((m) => m.user._id === DOST_ID);
        if (!isLastAssistant) return message;
        pendingAssistantChipsRef.current = null;
        return { ...message, chips: pending };
      });
    });
  }, []);

  const runSync = useCallback(async () => {
    const db = dbRef.current;
    const userId = userIdRef.current;
    if (!db || !userId) return;
    const result = await syncFromServer(userId, db);
    if (result.inserted.length === 0) return;
    const recent = await getRecentMessages(
      db,
      userId,
      50,
      sessionStartRef.current,
    );
    applyLocalRows(recent);
  }, [applyLocalRows]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;
        const userId = data?.user?.id;
        if (error || !userId) {
          setMessages([greetingMessage()]);
          return;
        }

        userIdRef.current = userId;
        const db = await getDb(userId);
        if (cancelled) return;
        dbRef.current = db;

        const profileLoad = await loadMyProfile();
        if (cancelled) return;
        const name = profileLoad.ok ? profileLoad.profile?.name : null;
        profileNameRef.current = name ?? null;

        sessionStartRef.current = await getChatSessionStart(userId);
        if (cancelled) return;

        const localRows = await getRecentMessages(
          db,
          userId,
          50,
          sessionStartRef.current,
        );
        if (cancelled) return;

        if (localRows.length > 0) {
          applyLocalRows(localRows, name);
          setGentleLoading(false);
          void runSync();
        } else if (!sessionStartRef.current) {
          setGentleLoading(true);
          const seeded = await seedFromServer(userId, db, 50);
          if (cancelled) return;
          applyLocalRows(seeded, name);
          setGentleLoading(false);
        } else {
          applyLocalRows([], name);
          setGentleLoading(false);
          void runSync();
        }
      } catch {
        if (!cancelled) {
          setMessages([greetingMessage()]);
          setGentleLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLocalRows, runSync]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = isOnlineState(state);
      setIsOnline(online);
      if (online && wasOfflineRef.current) {
        void runSync();
      }
      wasOfflineRef.current = !online;
    });
    void NetInfo.fetch().then((state) => {
      const online = isOnlineState(state);
      setIsOnline(online);
      wasOfflineRef.current = !online;
    });
    return () => unsub();
  }, [runSync]);

  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        void runSync();
      }
      if (state !== 'background') return;
      if (sessionExchangesRef.current < MEMORY_EXCHANGE_THRESHOLD) return;
      void updateUserMemory();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      sub.remove();
    };
  }, [runSync]);

  useEffect(() => {
    if (gentleLoading) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, isTyping, gentleLoading]);

  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const mod = loadSpeechModule();
    speechModRef.current = mod;
    if (!mod) return undefined;
    const unsub = subscribeSpeech(mod, {
      onStart: () => {
        clearListenWatchdog();
        micBusyRef.current = true;
        setMicState('listening');
        listenWatchdogRef.current = setTimeout(() => {
          stopDictation(mod);
          resetMicIdle();
          setVoiceHint(VOICE_MISS);
        }, LISTEN_WATCHDOG_MS);
      },
      onEnd: () => {
        resetMicIdle();
      },
      onResult: (transcript, isFinal) => {
        const base = listenBaseRef.current;
        const next = [base, transcript].filter(Boolean).join(' ').slice(0, MAX_MESSAGE_LEN);
        setInput(next);
        if (isFinal) {
          setMicState('processing');
          clearListenWatchdog();
          // Brief processing beat, then idle — continuous:false ends soon after.
          setTimeout(() => {
            resetMicIdle();
          }, 350);
        }
      },
      onError: (message) => {
        resetMicIdle();
        if (message === MIC_PERMISSION_DENIED) {
          setPermHint(true);
          return;
        }
        setVoiceHint(message || VOICE_MISS);
      },
    });
    return () => {
      unsub();
      clearListenWatchdog();
      abortDictation(mod);
      micBusyRef.current = false;
    };
  }, [clearListenWatchdog, resetMicIdle]);

  useEffect(() => {
    if (!voiceHint) return;
    const t = setTimeout(() => setVoiceHint(null), 3000);
    return () => clearTimeout(t);
  }, [voiceHint]);

  useEffect(() => {
    if (!sendHint) return;
    const t = setTimeout(() => setSendHint(null), 4000);
    return () => clearTimeout(t);
  }, [sendHint]);

  useEffect(() => {
    if (gentleLoading) return;
    if (!route.params?.reflectionOpening) return;

    reflectionModeRef.current = true;
    setShowNoticingsBanner(true);
    setMessages((prev) => {
      if (prev.some((item) => item._id === 'reflection-opening')) return prev;
      return [
        ...prev,
        {
          _id: 'reflection-opening',
          text: REFLECTION_OPENING,
          createdAt: new Date(),
          user: { _id: DOST_ID, name: 'DOST' },
        },
      ];
    });
    navigation.setParams({ reflectionOpening: false });
  }, [gentleLoading, navigation, route.params?.reflectionOpening]);

  useEffect(() => {
    if (!route.params?.conversationsCleared) return;
    let cancelled = false;
    (async () => {
      try {
        const db = dbRef.current;
        if (db) {
          await clearAllLocalData(db);
        }
        createdAtByIdRef.current.clear();
        sessionStartRef.current = null;
        const userId = userIdRef.current;
        if (userId) {
          sessionStartRef.current = await startNewChatSession(userId);
        }
        const profileLoad = await loadMyProfile();
        if (cancelled) return;
        const name = profileLoad.ok ? profileLoad.profile?.name : null;
        profileNameRef.current = name ?? null;
        setMessages([greetingMessage(name)]);
        sessionExchangesRef.current = 0;
        setHasMoreEarlier(false);
        setEmotionalState(null);
      } catch {
        if (!cancelled) setMessages([greetingMessage()]);
      }
    })();
    navigation.setParams({ conversationsCleared: false });
    return () => {
      cancelled = true;
    };
  }, [navigation, route.params?.conversationsCleared]);

  useEffect(() => {
    const startFresh = route.params?.newChat || route.params?.newSession;
    if (!startFresh) return;
    const voiceContinue = route.params?.voiceNoteContinue;
    let cancelled = false;
    (async () => {
      const userId = userIdRef.current;
      if (!userId) {
        navigation.setParams({
          newChat: false,
          newSession: false,
          voiceNoteContinue: undefined,
        });
        return;
      }
      try {
        const mod = speechModRef.current;
        if (mod) abortDictation(mod);
        resetMicIdle();
        const started = await startNewChatSession(userId);
        if (cancelled) return;
        sessionStartRef.current = started;

        const transcript =
          typeof voiceContinue?.transcript === 'string'
            ? voiceContinue.transcript.trim()
            : '';
        if (transcript) {
          const seeded: ChatMessage[] = [
            {
              _id: VOICE_CONTINUE_USER_ID,
              text: transcript,
              createdAt: new Date(),
              user: { _id: USER_ID, name: 'You' },
            },
          ];
          const reply =
            typeof voiceContinue?.dostResponse === 'string'
              ? voiceContinue.dostResponse.trim()
              : '';
          if (reply) {
            seeded.push({
              _id: VOICE_CONTINUE_DOST_ID,
              text: reply,
              createdAt: new Date(),
              user: { _id: DOST_ID, name: 'DOST' },
            });
          }
          setMessages(seeded);
        } else {
          setMessages([greetingMessage(profileNameRef.current)]);
        }
        sessionExchangesRef.current = 0;
        setHasMoreEarlier(false);
        setInput('');
        setSendHint(null);
        setVoiceHint(null);

        const autoChip = voiceContinue?.autoChipMessage;
        const autoText =
          typeof autoChip?.text === 'string' ? autoChip.text.trim() : '';
        if (autoText && !cancelled) {
          pendingVoiceChipRef.current = {
            text: autoText,
            selected_emotion: autoChip?.selected_emotion,
            selected_need: autoChip?.selected_need,
          };
        }
      } catch {
        if (!cancelled) {
          setMessages([greetingMessage(profileNameRef.current)]);
        }
      } finally {
        navigation.setParams({
          newChat: false,
          newSession: false,
          voiceNoteContinue: undefined,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    navigation,
    resetMicIdle,
    route.params?.newChat,
    route.params?.newSession,
    route.params?.voiceNoteContinue,
  ]);

  useEffect(() => {
    const focusId = route.params?.focusMessageId;
    const focusAt = route.params?.focusCreatedAt;
    if (!focusId || !focusAt) return;
    let cancelled = false;
    (async () => {
      const userId = userIdRef.current;
      const db = dbRef.current;
      if (!userId || !db) {
        navigation.setParams({ focusMessageId: undefined, focusCreatedAt: undefined });
        return;
      }
      try {
        await openChatFromMessage(userId, focusAt);
        if (cancelled) return;
        sessionStartRef.current = focusAt;
        const recent = await getRecentMessages(db, userId, 50, focusAt);
        if (cancelled) return;
        applyLocalRows(recent);
        setHasMoreEarlier(true);
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: true });
        }, 80);
      } finally {
        navigation.setParams({ focusMessageId: undefined, focusCreatedAt: undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applyLocalRows,
    navigation,
    route.params?.focusCreatedAt,
    route.params?.focusMessageId,
  ]);

  const sendWithText = useCallback(
    async (text: string, existingId?: string, chipSend?: ChipSendOptions) => {
      const db = dbRef.current;
      const userId = userIdRef.current;
      if (!db || !userId) return;
      if (sendingRef.current) return;

      sendingRef.current = true;
      const clientId = existingId ?? createClientId();
      const createdAt =
        createdAtByIdRef.current.get(clientId) ?? new Date().toISOString();
      let requestSucceeded = false;

      try {
        if (!existingId) {
          setChipSkipHint(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.chips && !m.chips.disabled
                ? { ...m, chips: { ...m.chips, disabled: true } }
                : m,
            ),
          );
          createdAtByIdRef.current.set(clientId, createdAt);
          const userMsg: ChatMessage = {
            _id: clientId,
            text,
            createdAt: new Date(createdAt),
            user: { _id: USER_ID, name: 'You' },
            deliveryStatus: 'pending',
          };

          sessionExchangesRef.current += 1;
          entranceCandidatesRef.current.add(clientId);
          setMessages((prev) => {
            const withoutWelcome = prev.filter((m) => m._id !== 'welcome');
            return [...withoutWelcome, userMsg];
          });
          setInput('');
          await insertMessage(db, {
            id: clientId,
            user_id: userId,
            role: 'user',
            content: text,
            created_at: createdAt,
            synced: 0,
            delivery_status: 'pending',
            is_temporary: 1,
          }).catch(() => {});
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === clientId ? { ...m, deliveryStatus: 'pending' } : m,
            ),
          );
          await updateMessageDelivery(db, userId, clientId, 'pending').catch(() => {});
        }

        setIsTyping(true);
        const result = await sendChatMessage(text, {
          emotionalState: emotionalStateRef.current,
          selected_emotion: chipSend?.selected_emotion,
          selected_need: chipSend?.selected_need,
        });
        if (!result.ok) {
          await updateMessageDelivery(db, userId, clientId, 'failed').catch(() => {});
          setMessages((prev) =>
            prev.map((m) =>
              m._id === clientId ? { ...m, deliveryStatus: 'failed' } : m,
            ),
          );
          const hint =
            typeof result.message === 'string' && result.message.trim()
              ? formatChatErrorForUi(result.message.trim())
              : SEND_FAIL_HINT;
          setSendHint(hint);
          return;
        }
        requestSucceeded = true;
        setSendHint(null);
        setMessages((prev) =>
          prev.map((m) =>
            m._id === clientId ? { ...m, deliveryStatus: 'sent' } : m,
          ),
        );
        await updateMessageDelivery(db, userId, clientId, 'sent').catch(() => {});

        const replyText = result.reply;
        const assistantId = createClientId();
        const assistantAt = new Date().toISOString();
        createdAtByIdRef.current.set(assistantId, assistantAt);
        const hasChips =
          result.suggested_emotions.length > 0 || result.suggested_needs.length > 0;
        const assistantChips: MessageChips | undefined = hasChips
          ? {
              suggested_emotions: result.suggested_emotions,
              suggested_needs: result.suggested_needs,
            }
          : undefined;

        await insertMessage(db, {
          id: assistantId,
          user_id: userId,
          role: 'assistant',
          content: replyText,
          created_at: assistantAt,
          synced: 1,
          delivery_status: 'sent',
          is_temporary: 1,
        }).catch(() => {});

        const followUp =
          reflectionModeRef.current && !reflectionFollowUpRef.current
            ? REFLECTION_FOLLOW_UP
            : null;
        if (followUp) reflectionFollowUpRef.current = true;

        setMessages((prev) => {
          const withReply = [
            ...prev,
            {
              _id: assistantId,
              text: replyText,
              createdAt: new Date(assistantAt),
              user: { _id: DOST_ID, name: 'DOST' },
              chips: assistantChips,
            },
          ];
          if (!followUp) return withReply;
          return [
            ...withReply,
            {
              _id: `d-notice-${Date.now()}`,
              text: followUp,
              createdAt: new Date(),
              user: { _id: DOST_ID, name: 'DOST' },
            },
          ];
        });
        if (hasChips) {
          pendingAssistantChipsRef.current = assistantChips ?? null;
        }
        if (followUp) setShowNoticingsBanner(true);
        const since = new Date(Date.parse(createdAt) - 60_000).toISOString();
        const reconciled = await reconcileRecentAfterSend(userId, db, since);
        if (reconciled.length > 0) {
          const recent = await getRecentMessages(
            db,
            userId,
            50,
            sessionStartRef.current,
          );
          applyLocalRows(recent);
        } else {
          void runSync();
        }
      } catch {
        if (!requestSucceeded) {
          await updateMessageDelivery(db, userId, clientId, 'failed').catch(() => {});
          setMessages((prev) =>
            prev.map((m) =>
              m._id === clientId ? { ...m, deliveryStatus: 'failed' } : m,
            ),
          );
          setSendHint(SEND_FAIL_HINT);
        }
      } finally {
        setIsTyping(false);
        sendingRef.current = false;
      }
    },
    [applyLocalRows, runSync],
  );

  useEffect(() => {
    const pending = pendingVoiceChipRef.current;
    if (!pending?.text) return;
    const hasVoiceSeed = messages.some(
      (m) => m._id === VOICE_CONTINUE_USER_ID,
    );
    if (!hasVoiceSeed) return;
    pendingVoiceChipRef.current = null;
    void sendWithText(pending.text, undefined, {
      selected_emotion: pending.selected_emotion,
      selected_need: pending.selected_need,
    });
  }, [messages, sendWithText]);

  const handleEmotionChipSelect = useCallback(
    (token: string) => {
      if (token === '__skip__') {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === activeChipsMessageId && m.chips
              ? { ...m, chips: { ...m.chips, dismissed: true, disabled: true } }
              : m,
          ),
        );
        setChipSkipHint(true);
        return;
      }
      if (!isOnline) return;
      const label = labelForEmotionChip(token);
      void sendWithText(`That feels like ${label}`, undefined, {
        selected_emotion: token,
      });
    },
    [activeChipsMessageId, isOnline, sendWithText],
  );

  const handleNeedChipSelect = useCallback(
    (token: string) => {
      if (token === '__skip__') {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === activeChipsMessageId && m.chips
              ? { ...m, chips: { ...m.chips, dismissed: true, disabled: true } }
              : m,
          ),
        );
        setChipSkipHint(true);
        return;
      }
      if (!isOnline) return;
      const label = labelForNeedChip(token);
      void sendWithText(`I think what I need is ${label}`, undefined, {
        selected_need: token,
      });
    },
    [activeChipsMessageId, isOnline, sendWithText],
  );

  const onSend = useCallback(async () => {
    if (!isOnline) return;
    if (typeof input !== 'string') return;
    const text = input.trim();
    if (!text || text.length > MAX_MESSAGE_LEN) return;
    await sendWithText(text);
  }, [input, isOnline, sendWithText]);

  const retryMessage = useCallback(
    async (id: string) => {
      if (!isOnline) return;
      const target = messages.find(
        (m) => m._id === id && m.deliveryStatus === 'failed',
      );
      if (!target) return;
      await sendWithText(target.text, id);
    },
    [isOnline, messages, sendWithText],
  );

  const onLoadEarlier = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const db = dbRef.current;
    const userId = userIdRef.current;
    if (!db || !userId) return;

    const oldest = messages.find((m) => !isSyntheticChatId(m._id));
    if (!oldest) {
      setHasMoreEarlier(false);
      return;
    }

    const beforeIso =
      createdAtByIdRef.current.get(oldest._id) ?? oldest.createdAt.toISOString();

    loadingOlderRef.current = true;
    setLoadingEarlier(true);
    try {
      let older = await getMessagesBefore(
        db,
        userId,
        beforeIso,
        20,
        sessionStartRef.current,
      );
      if (older.length < 20 && isOnline && !sessionStartRef.current) {
        const fromServer = await fetchOlderFromServer(userId, db, beforeIso, 20);
        if (fromServer.length > 0) {
          older = await getMessagesBefore(
            db,
            userId,
            beforeIso,
            20,
            sessionStartRef.current,
          );
        }
      }
      if (older.length === 0) {
        setHasMoreEarlier(false);
        return;
      }
      if (older.length < 20) setHasMoreEarlier(false);
      setMessages((prev) => mergeById(older.map(localToChatMessage), prev));
    } finally {
      setLoadingEarlier(false);
      loadingOlderRef.current = false;
    }
  }, [isOnline, messages]);

  const beginListening = useCallback(
    async (mod: SpeechNativeModule) => {
      if (micBusyRef.current && micState === 'listening') {
        return;
      }
      micBusyRef.current = true;
      setMicState('starting');
      setVoiceHint(null);

      const permission = await requestMicPermission(mod);
      if (!permission.granted) {
        resetMicIdle();
        setPermHint(true);
        return;
      }
      setPermHint(false);
      listenBaseRef.current = input.trim();
      try {
        startDictation(mod);
        // onStart will move to listening; watchdog covers hang if start never fires.
        clearListenWatchdog();
        listenWatchdogRef.current = setTimeout(() => {
          abortDictation(mod);
          resetMicIdle();
          setVoiceHint(MIC_START_FAIL);
        }, 4000);
      } catch {
        resetMicIdle();
        setVoiceHint(MIC_START_FAIL);
      }
    },
    [clearListenWatchdog, input, micState, resetMicIdle],
  );

  const onMicPress = useCallback(() => {
    if (isExpoGo()) {
      setPermHint(false);
      setVoiceHint(EXPO_GO_VOICE_MESSAGE);
      return;
    }
    if (!isOnline) {
      setVoiceHint('Voice needs a connection. You can still type.');
      return;
    }
    const mod = speechModRef.current;

    if (micState === 'listening') {
      if (mod) stopDictation(mod);
      setMicState('processing');
      clearListenWatchdog();
      setTimeout(() => resetMicIdle(), 400);
      return;
    }

    if (micState === 'starting' || micState === 'processing' || micBusyRef.current) {
      setVoiceHint(MIC_BUSY_MESSAGE);
      return;
    }

    const reason = speechUnavailableReason(mod);
    if (reason || !mod) {
      setVoiceHint(reason ?? SPEECH_UNAVAILABLE_MESSAGE);
      return;
    }

    void (async () => {
      const state = await getMicPermissionState(mod);
      if (state.status === 'denied' && !state.canAskAgain) {
        setPermHint(true);
        return;
      }
      setPermHint(false);
      await beginListening(mod);
    })();
  }, [
    beginListening,
    clearListenWatchdog,
    isOnline,
    micState,
    resetMicIdle,
  ]);

  const onNewChat = useCallback(() => {
    navigation.setParams({ newChat: true });
  }, [navigation]);

  const listening = micState === 'listening';
  const canSend =
    Boolean(input.trim()) && !isTyping && !gentleLoading && !listening && isOnline;
  const micDisabled = isTyping || gentleLoading || !isOnline;
  const composerBottom = Math.max(insets.bottom, spacing.sm);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.flex}>
        <PaperGrain />
        <View style={styles.header}>
          <View style={styles.headerLeading}>
            <GentlePressable
              onPress={() => navigation.navigate('Home')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Home"
              style={styles.headerHomeButton}
            >
              <Ionicons name="chevron-back" size={22} color={colors.gold} />
            </GentlePressable>
            <View style={styles.headerIdentity}>
              <Text style={styles.headerTitle}>DOST</Text>
              <View style={styles.headerStatus}>
                <View style={styles.presenceDot} />
                <Text style={styles.headerSubtitle}>reflecting with you</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={onNewChat}
              hitSlop={8}
              accessibilityLabel="New chat"
            >
              <Text style={styles.headerLink}>New chat</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('SearchChats')}
              hitSlop={8}
              accessibilityLabel="Search old chats"
            >
              <Text style={styles.headerLink}>Search</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Reflection', { mode: 'prompt' })}
              hitSlop={8}
              accessibilityLabel="Evening check-in"
            >
              <Text style={styles.headerLink}>Evening check-in</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              hitSlop={8}
              accessibilityLabel="Settings"
            >
              <Text style={styles.gear}>{'\u2699'}</Text>
            </Pressable>
          </View>
        </View>
        <EmotionPicker
          selected={emotionalState}
          onSelect={setEmotionalState}
          collapsed={emotionCollapsed}
          onToggle={() => setEmotionCollapsed((v) => !v)}
        />
        {!isOnline ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>{OFFLINE_BANNER}</Text>
          </View>
        ) : null}
        {showNoticingsBanner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              When you're ready, name two things to notice tomorrow.
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Reflection', { mode: 'noticings' })}
              hitSlop={8}
            >
              <Text style={styles.bannerAction}>Save noticings</Text>
            </Pressable>
          </View>
        ) : null}
        {gentleLoading ? (
          <View style={styles.loadingBox}>
            <BreathingDot size={10} />
            <Text style={styles.loadingText}>Getting your chat ready...</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={messages}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              hasMoreEarlier ? (
                <Pressable
                  onPress={() => void onLoadEarlier()}
                  style={styles.loadEarlier}
                  disabled={loadingEarlier}
                >
                  <Text style={styles.loadEarlierText}>
                    {loadingEarlier ? 'Loading...' : 'Load earlier messages'}
                  </Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => (
              <MessageRow
                item={item}
                claimEntrance={claimEntrance}
                reduceMotion={reduceMotion}
                retryMessage={retryMessage}
                chipsActive={
                  item._id === activeChipsMessageId &&
                  !item.chips?.dismissed &&
                  !item.chips?.disabled
                }
                onEmotionChipSelect={handleEmotionChipSelect}
                onNeedChipSelect={handleNeedChipSelect}
              />
            )}
            ListFooterComponent={
              isTyping ? (
                <View
                  style={styles.typing}
                  accessible
                  accessibilityLabel="DOST is reflecting"
                  accessibilityRole="progressbar"
                >
                  <Text style={styles.typingText}>DOST is reflecting...</Text>
                  <BreathingDot size={6} />
                </View>
              ) : null
            }
          />
        )}
        {permHint ? (
          <View style={styles.hintRow}>
            <Text style={styles.hintText}>
              To use voice, allow microphone access in your device settings.{' '}
            </Text>
            <Pressable onPress={() => void Linking.openSettings()} hitSlop={6}>
              <Text style={styles.hintLink}>Open Settings</Text>
            </Pressable>
          </View>
        ) : null}
        {voiceHint ? (
          <View style={styles.hintRow}>
            <Text style={styles.hintText}>{voiceHint}</Text>
          </View>
        ) : null}
        {sendHint ? (
          <View style={styles.hintRow}>
            <Text style={styles.hintText}>{sendHint}</Text>
          </View>
        ) : null}
        {chipSkipHint ? (
          <View style={styles.chipSkipRow}>
            <Text style={styles.chipSkipText}>Tell me in your own words</Text>
          </View>
        ) : null}
        <View style={[styles.composer, { paddingBottom: composerBottom }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={(value) => setInput(value.slice(0, MAX_MESSAGE_LEN))}
            placeholder={listening ? 'Listening...' : 'Pour your heart out here...'}
            placeholderTextColor={colors.sand}
            maxLength={MAX_MESSAGE_LEN}
            multiline
            editable={!listening}
            blurOnSubmit={false}
            textAlignVertical="top"
            autoCapitalize="sentences"
            underlineColorAndroid="transparent"
          />
          <MicButton state={micState} disabled={micDisabled} onPress={onMicPress} />
          <GentlePressable
            onPress={onSend}
            disabled={!canSend}
            accessibilityLabel="Send"
            style={[styles.send, !canSend && styles.sendDisabled]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
          </GentlePressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.base,
  },
  headerTitle: { ...typography.heading, color: colors.cream, fontSize: 22, lineHeight: 26 },
  headerSubtitle: { ...typography.caption, color: colors.sand },
  headerLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  headerHomeButton: {
    justifyContent: 'center',
    marginRight: spacing.xxs,
  },
  headerIdentity: { flexShrink: 1 },
  headerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flex: 1,
    marginLeft: spacing.sm,
  },
  headerLink: { ...typography.label, color: colors.gold, fontSize: 12 },
  gear: { fontSize: 20, color: colors.gold },
  offlineBanner: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.error,
  },
  offlineText: { ...typography.label, color: colors.error, textAlign: 'center' },
  banner: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.goldSoft,
    backgroundColor: colors.surfaceRaised,
  },
  bannerText: { ...typography.body, color: colors.cream, marginBottom: spacing.sm },
  bannerAction: { ...typography.label, color: colors.success },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: { ...typography.body, textAlign: 'center', color: colors.sand },
  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  loadEarlier: { alignItems: 'center', paddingVertical: spacing.md },
  loadEarlierText: { ...typography.label, color: colors.clay },
  row: { marginBottom: spacing.lg, maxWidth: '84%' },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  presenceDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.olive,
  },
  sender: { ...typography.caption, color: colors.clay },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
  },
  bubbleMine: {
    backgroundColor: colors.userBubble,
    borderColor: colors.userBubble,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xs,
  },
  bubbleTheirs: {
    backgroundColor: colors.dostBubble,
    borderColor: colors.divider,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomLeftRadius: radius.xs,
    borderBottomRightRadius: radius.xl,
  },
  bubblePending: {
    borderColor: colors.goldSoft,
    opacity: 0.82,
  },
  bubbleFailed: {
    borderColor: colors.error,
    opacity: 0.72,
  },
  bubbleText: { color: colors.cream },
  bubbleTextMine: { ...typography.userMessage, color: colors.onPrimary },
  bubbleTextTheirs: { ...typography.dostMessage },
  bubbleTextUnsent: { color: colors.onPrimary },
  sending: {
    ...typography.caption,
    color: colors.clay,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  notSent: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  typing: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius['2xl'],
    backgroundColor: colors.dostBubble,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  typingText: { ...typography.caption, color: colors.sand },
  hintRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  hintText: { ...typography.label, color: colors.error },
  hintLink: { ...typography.label, color: colors.gold },
  chipSkipRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  chipSkipText: {
    ...typography.caption,
    color: colors.sand,
    textAlign: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    backgroundColor: colors.base,
    gap: spacing.md,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.cream,
    backgroundColor: colors.surface,
    ...typography.body,
  },
  send: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
  },
  sendDisabled: { backgroundColor: colors.clay, opacity: 0.48 },
});
