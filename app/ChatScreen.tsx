import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  type AppStateStatus,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  loadChatMessages,
  sendChatMessage,
  type StoredChatRow,
} from '../lib/chat';
import { updateUserMemory } from '../lib/memory';
import { loadMyProfile } from '../lib/profile';
import {
  MIC_PERMISSION_DENIED,
  MIC_RATIONALE,
  SPEECH_UNAVAILABLE_MESSAGE,
  SPEECH_UNAVAILABLE_TITLE,
  loadSpeechModule,
  requestMicPermission,
  speechUnavailableReason,
  startDictation,
  stopDictation,
  subscribeSpeech,
  type SpeechNativeModule,
} from '../lib/speech';
import {
  REFLECTION_FOLLOW_UP,
  REFLECTION_OPENING,
} from '../lib/notifications';
import type { ChatStackParamList } from './chatTypes';

const MAX_MESSAGE_LEN = 2000;
const USER_ID = 1;
const DOST_ID = 2;
const MEMORY_EXCHANGE_THRESHOLD = 5;
const GENTLE_ERROR = "Something's off on my end. Try again in a moment.";

type ChatMessage = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: number; name: string };
};

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'> & {
  onStartOver?: () => void;
};

function greetingText(name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return `Namaste, ${trimmed}. What's on your mind today?`;
  return "Namaste 🙏 What's on your mind today?";
}

function greetingMessage(name?: string | null): ChatMessage {
  return {
    _id: 'welcome',
    text: greetingText(name),
    createdAt: new Date(),
    user: { _id: DOST_ID, name: 'DOST' },
  };
}

function rowToChatMessage(row: StoredChatRow): ChatMessage {
  const mine = row.role === 'user';
  return {
    _id: row.id,
    text: row.message,
    createdAt: new Date(row.created_at),
    user: mine
      ? { _id: USER_ID, name: 'You' }
      : { _id: DOST_ID, name: 'DOST' },
  };
}

export default function ChatScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const sendingRef = useRef(false);
  const sessionExchangesRef = useRef(0);
  const reflectionModeRef = useRef(false);
  const reflectionFollowUpRef = useRef(false);
  const speechModRef = useRef<SpeechNativeModule | null>(null);
  const listenBaseRef = useRef('');
  const [messages, setMessages] = useState<ChatMessage[]>([greetingMessage()]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showNoticingsBanner, setShowNoticingsBanner] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [rows, profileLoad] = await Promise.all([
          loadChatMessages(),
          loadMyProfile(),
        ]);
        if (cancelled) return;
        const name = profileLoad.ok ? profileLoad.profile?.name : null;
        if (rows.length === 0) {
          setMessages([greetingMessage(name)]);
        } else {
          setMessages(rows.map(rowToChatMessage));
        }
      } catch {
        if (!cancelled) setMessages([greetingMessage()]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state !== 'background') return;
      if (sessionExchangesRef.current < MEMORY_EXCHANGE_THRESHOLD) return;
      void updateUserMemory();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (loadingHistory) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, isTyping, loadingHistory]);

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
      onStart: () => setListening(true),
      onEnd: () => setListening(false),
      onResult: (transcript) => {
        const base = listenBaseRef.current;
        const next = [base, transcript].filter(Boolean).join(' ').slice(0, MAX_MESSAGE_LEN);
        setInput(next);
      },
      onError: (message) => {
        setListening(false);
        Alert.alert('Voice', message);
      },
    });
    return () => {
      unsub();
      stopDictation(mod);
    };
  }, []);

  useEffect(() => {
    if (loadingHistory) return;
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
  }, [loadingHistory, navigation, route.params?.reflectionOpening]);

  useEffect(() => {
    if (!route.params?.conversationsCleared) return;
    let cancelled = false;
    (async () => {
      try {
        const profileLoad = await loadMyProfile();
        if (cancelled) return;
        const name = profileLoad.ok ? profileLoad.profile?.name : null;
        setMessages([greetingMessage(name)]);
        sessionExchangesRef.current = 0;
      } catch {
        if (!cancelled) setMessages([greetingMessage()]);
      }
    })();
    navigation.setParams({ conversationsCleared: false });
    return () => {
      cancelled = true;
    };
  }, [navigation, route.params?.conversationsCleared]);

  const onSend = useCallback(async () => {
    if (typeof input !== 'string') return;
    const text = input.trim();
    if (!text || text.length > MAX_MESSAGE_LEN) return;
    if (sendingRef.current) return;

    sendingRef.current = true;

    const userMsg: ChatMessage = {
      _id: `u-${Date.now()}`,
      text,
      createdAt: new Date(),
      user: { _id: USER_ID, name: 'You' },
    };

    sessionExchangesRef.current += 1;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await sendChatMessage(text);
      const replyText = result.ok ? result.reply : result.message;

      const followUp =
        reflectionModeRef.current && !reflectionFollowUpRef.current
          ? REFLECTION_FOLLOW_UP
          : null;
      if (followUp) reflectionFollowUpRef.current = true;

      setMessages((prev) => {
        const next = [
          ...prev,
          {
            _id: `d-${Date.now()}`,
            text: replyText,
            createdAt: new Date(),
            user: { _id: DOST_ID, name: 'DOST' },
          },
        ];
        if (!followUp) return next;
        return [
          ...next,
          {
            _id: `d-notice-${Date.now()}`,
            text: followUp,
            createdAt: new Date(),
            user: { _id: DOST_ID, name: 'DOST' },
          },
        ];
      });
      if (followUp) setShowNoticingsBanner(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          _id: `d-${Date.now()}`,
          text: GENTLE_ERROR,
          createdAt: new Date(),
          user: { _id: DOST_ID, name: 'DOST' },
        },
      ]);
    } finally {
      setIsTyping(false);
      sendingRef.current = false;
    }
  }, [input]);

  const beginListening = useCallback(async (mod: SpeechNativeModule) => {
    const permission = await requestMicPermission(mod);
    if (!permission.granted) {
      Alert.alert('Microphone', MIC_PERMISSION_DENIED);
      return;
    }
    listenBaseRef.current = input.trim();
    try {
      startDictation(mod);
      setListening(true);
    } catch {
      setListening(false);
      Alert.alert('Voice', 'Could not start the microphone. Try again, or type.');
    }
  }, [input]);

  const onMicPress = useCallback(() => {
    const mod = speechModRef.current;
    if (listening) {
      if (mod) stopDictation(mod);
      setListening(false);
      return;
    }

    const reason = speechUnavailableReason(mod);
    if (reason || !mod) {
      Alert.alert(SPEECH_UNAVAILABLE_TITLE, reason ?? SPEECH_UNAVAILABLE_MESSAGE);
      return;
    }

    void (async () => {
      const already = await mod.getPermissionsAsync?.();
      if (already?.granted) {
        await beginListening(mod);
        return;
      }
      Alert.alert('Microphone', MIC_RATIONALE, [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            void beginListening(mod);
          },
        },
      ]);
    })();
  }, [beginListening, listening]);

  const canSend = Boolean(input.trim()) && !isTyping && !loadingHistory && !listening;
  const composerBottom = Platform.OS === 'ios' ? Math.max(insets.bottom, 8) : 12;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.flex}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>DOST</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => navigation.navigate('Reflection', { mode: 'prompt' })}
              hitSlop={8}
            >
              <Text style={styles.headerLink}>Reflect</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              hitSlop={8}
              accessibilityLabel="Settings"
            >
              <Text style={styles.gear}>⚙</Text>
            </Pressable>
          </View>
        </View>
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
        {loadingHistory ? (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>Loading your chat…</Text>
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
            renderItem={({ item }) => {
              const mine = item.user._id === USER_ID;
              return (
                <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                  {!mine ? <Text style={styles.sender}>{item.user.name}</Text> : null}
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                      {item.text}
                    </Text>
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              isTyping ? <Text style={styles.typing}>DOST is typing…</Text> : null
            }
          />
        )}
        <View style={[styles.composer, { paddingBottom: composerBottom }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={(value) => setInput(value.slice(0, MAX_MESSAGE_LEN))}
            placeholder={listening ? 'Listening…' : "Type how you're feeling..."}
            placeholderTextColor="#888"
            maxLength={MAX_MESSAGE_LEN}
            multiline
            editable={!listening}
            blurOnSubmit={false}
            textAlignVertical="top"
            autoCapitalize="sentences"
            underlineColorAndroid="transparent"
          />
          <Pressable
            onPress={onMicPress}
            disabled={isTyping || loadingHistory}
            style={[
              styles.mic,
              listening && styles.micActive,
              (isTyping || loadingHistory) && styles.sendDisabled,
            ]}
            accessibilityLabel={listening ? 'Stop listening' : 'Speak'}
            hitSlop={8}
          >
            <Text style={[styles.micText, listening && styles.micTextActive]}>
              {listening ? '■' : '🎤'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            style={[styles.send, !canSend && styles.sendDisabled]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    flex: 1,
    marginLeft: 12,
  },
  headerLink: { fontSize: 14, color: '#2563eb', fontWeight: '600' },
  gear: { fontSize: 18, color: '#0f172a' },
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  bannerText: { fontSize: 14, lineHeight: 20, color: '#0f172a', marginBottom: 6 },
  bannerAction: { fontSize: 14, color: '#2563eb', fontWeight: '600' },
  loadingBox: { flex: 1, justifyContent: 'center' },
  loadingText: { textAlign: 'center', color: '#64748b', fontSize: 16 },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: { marginBottom: 10, maxWidth: '82%' },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },
  sender: { fontSize: 12, color: '#666', marginBottom: 4, marginLeft: 4 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#2563eb' },
  bubbleTheirs: { backgroundColor: '#f1f5f9' },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  bubbleTextMine: { color: '#fff' },
  bubbleTextTheirs: { color: '#0f172a' },
  typing: { color: '#64748b', fontSize: 13, marginBottom: 8, marginLeft: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  mic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#f1f5f9',
  },
  micActive: { backgroundColor: '#dc2626' },
  micText: { fontSize: 18 },
  micTextActive: { color: '#fff' },
  send: {
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '600' },
});
