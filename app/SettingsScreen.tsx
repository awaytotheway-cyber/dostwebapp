import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatStackParamList } from './chatTypes';
import { loadReflectionTime, saveReflectionTime, type HmTime } from '../lib/intentions';
import {
  requestNotificationPermission,
  scheduleEveningCheckIn,
} from '../lib/notifications';
import { loadMyProfile, updateMyBirthPlace, updateMyNameAndIntention, type Dosha } from '../lib/profile';
import { emptyBirthPlace, type BirthPlace } from '../lib/birthPlace';
import CountryPicker from './CountryPicker';
import { loadMemorySummary, refreshUserMemory } from '../lib/memory';
import { deleteMyAccount, deleteMyConversations, exportMyData } from '../lib/privacy';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingStorage';
import { supabase } from '../lib/supabase';

type Props = NativeStackScreenProps<ChatStackParamList, 'Settings'> & {
  onStartOver: () => void;
};

const MAX_NAME = 40;
const MAX_INTENTION = 200;
const FIELD_MAX = 80;

function dateFromTime(time: HmTime): Date {
  const d = new Date();
  d.setHours(time.hour, time.minute, 0, 0);
  return d;
}

function doshaLabel(dosha: Dosha | null): string {
  if (!dosha) return 'Not set yet';
  return dosha.charAt(0).toUpperCase() + dosha.slice(1);
}

export default function SettingsScreen({ navigation, onStartOver }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [intention, setIntention] = useState('');
  const [dosha, setDosha] = useState<Dosha | null>(null);
  const [birthPlace, setBirthPlace] = useState<BirthPlace>(emptyBirthPlace);
  const [time, setTime] = useState<HmTime>({ hour: 20, minute: 0 });
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [memorySummary, setMemorySummary] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBirthPlace, setSavingBirthPlace] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingChats, setDeletingChats] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');

  const load = useCallback(async () => {
    const [profileLoad, loadedTime, summary] = await Promise.all([
      loadMyProfile(),
      loadReflectionTime(),
      loadMemorySummary(),
    ]);
    if (profileLoad.ok && profileLoad.profile) {
      setName(profileLoad.profile.name ?? '');
      setIntention(profileLoad.profile.intention ?? '');
      setDosha(profileLoad.profile.dosha);
      setBirthPlace({
        birthCity: profileLoad.profile.birth_city ?? '',
        birthDistrict: profileLoad.profile.birth_district ?? '',
        birthState: profileLoad.profile.birth_state ?? '',
        birthCountry: profileLoad.profile.birth_country ?? 'India',
      });
    }
    setTime(loadedTime);
    setMemorySummary(summary);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const timeLabel = useMemo(
    () =>
      dateFromTime(time).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time],
  );

  const busy =
    savingProfile ||
    savingBirthPlace ||
    savingTime ||
    refreshing ||
    exporting ||
    deletingChats ||
    deletingAccount;

  const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed') return;
    if (selected) {
      setTime({ hour: selected.getHours(), minute: selected.getMinutes() });
    }
  };

  const onSaveProfile = async () => {
    if (busy) return;
    setSavingProfile(true);
    try {
      const saved = await updateMyNameAndIntention(name, intention);
      if (!saved.ok) {
        Alert.alert('Could not save', saved.message);
        return;
      }
      Alert.alert('Saved', 'Your name and intention were updated.');
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const onSaveBirthPlace = async () => {
    if (busy) return;
    setSavingBirthPlace(true);
    try {
      const saved = await updateMyBirthPlace(birthPlace);
      if (!saved.ok) {
        Alert.alert('Could not save', saved.message);
        return;
      }
      Alert.alert('Saved', 'Your place of birth was updated.');
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSavingBirthPlace(false);
    }
  };

  const onSaveTime = async () => {
    if (busy) return;
    setSavingTime(true);
    try {
      const saved = await saveReflectionTime(time);
      if (!saved.ok) {
        Alert.alert('Could not save', saved.message);
        return;
      }

      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(
          'Time saved',
          'Reminders need notification permission. You can still tap Reflect in chat whenever you like.',
        );
        return;
      }

      const scheduled = await scheduleEveningCheckIn(time);
      Alert.alert(
        'Time saved',
        scheduled.scheduled
          ? 'DOST will check in at this time. On Expo Go, the reminder may not appear — tap Reflect in chat to try the same flow.'
          : scheduled.warning ??
              'Time saved. Tap Reflect in chat if a reminder does not appear.',
      );
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSavingTime(false);
    }
  };

  const onRefreshMemory = async () => {
    if (busy) return;
    setRefreshing(true);
    try {
      const result = await refreshUserMemory();
      if (!result.ok) {
        Alert.alert('Could not refresh', result.message);
        return;
      }
      const summary = await loadMemorySummary();
      setMemorySummary(summary);
      if (result.status === 'skipped') {
        Alert.alert(
          'No update yet',
          'Chat a little more, or wait a few minutes, then try again.',
        );
        return;
      }
      Alert.alert('Updated', summary ? 'Memory was refreshed.' : 'Memory was refreshed.');
    } catch {
      Alert.alert('Could not refresh', 'Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const onExport = async () => {
    if (busy) return;
    setExporting(true);
    try {
      const result = await exportMyData();
      if (!result.ok) {
        Alert.alert('Could not export', result.message);
      }
    } catch {
      Alert.alert('Could not export', 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const runDeleteConversations = async () => {
    if (busy) return;
    setDeletingChats(true);
    try {
      const result = await deleteMyConversations();
      if (!result.ok) {
        Alert.alert('Could not delete', result.message);
        return;
      }
      setMemorySummary(null);
      Alert.alert('Conversations deleted', 'Your profile is still here.');
      navigation.navigate('Chat', { conversationsCleared: true });
    } catch {
      Alert.alert('Could not delete', 'Please try again.');
    } finally {
      setDeletingChats(false);
    }
  };

  const onDeleteConversations = () => {
    Alert.alert(
      'Delete all my conversations?',
      "This can't be undone. Your profile stays.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete conversations',
          style: 'destructive',
          onPress: () => {
            void runDeleteConversations();
          },
        },
      ],
    );
  };

  const onDeleteAccountPress = () => {
    Alert.alert(
      'Delete my account?',
      'This permanently deletes your account and data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setDeleteTyped('');
            setAccountModal(true);
          },
        },
      ],
    );
  };

  const runDeleteAccount = async () => {
    if (deleteTyped !== 'DELETE' || busy) return;
    setDeletingAccount(true);
    try {
      const result = await deleteMyAccount();
      if (!result.ok) {
        Alert.alert('Could not delete', result.message);
        return;
      }
      setAccountModal(false);
      await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
      try {
        await supabase.auth.signOut();
      } catch {
        // Session may already be gone after the user was deleted.
      }
      onStartOver();
    } catch {
      Alert.alert('Could not delete', 'Please try again.');
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.flex, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.heading}>Settings</Text>

          <Text style={styles.section}>My profile</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
            placeholder="Your name"
            placeholderTextColor="#888"
            maxLength={MAX_NAME}
            autoCapitalize="words"
            editable={!busy}
            underlineColorAndroid="transparent"
          />
          <Text style={styles.label}>Intention</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={intention}
            onChangeText={(value) => setIntention(value.slice(0, MAX_INTENTION))}
            placeholder="What you'd like to reflect on"
            placeholderTextColor="#888"
            maxLength={MAX_INTENTION}
            multiline
            editable={!busy}
            textAlignVertical="top"
            underlineColorAndroid="transparent"
          />
          <Pressable
            onPress={() => void onSaveProfile()}
            disabled={busy}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>
              {savingProfile ? 'Saving…' : 'Save name & intention'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Place of birth</Text>
          <Text style={styles.helperInline}>Optional. City, district, state, and country.</Text>
          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={birthPlace.birthCity}
            onChangeText={(value) =>
              setBirthPlace((prev) => ({ ...prev, birthCity: value.slice(0, FIELD_MAX) }))
            }
            placeholder="City"
            placeholderTextColor="#888"
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            editable={!busy}
            underlineColorAndroid="transparent"
          />
          <Text style={styles.label}>District</Text>
          <TextInput
            style={styles.input}
            value={birthPlace.birthDistrict}
            onChangeText={(value) =>
              setBirthPlace((prev) => ({ ...prev, birthDistrict: value.slice(0, FIELD_MAX) }))
            }
            placeholder="District"
            placeholderTextColor="#888"
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            editable={!busy}
            underlineColorAndroid="transparent"
          />
          <Text style={styles.label}>State</Text>
          <TextInput
            style={styles.input}
            value={birthPlace.birthState}
            onChangeText={(value) =>
              setBirthPlace((prev) => ({ ...prev, birthState: value.slice(0, FIELD_MAX) }))
            }
            placeholder="State"
            placeholderTextColor="#888"
            maxLength={FIELD_MAX}
            autoCapitalize="words"
            editable={!busy}
            underlineColorAndroid="transparent"
          />
          <Text style={styles.label}>Country</Text>
          <CountryPicker
            value={birthPlace.birthCountry || 'India'}
            onChange={(birthCountry) => setBirthPlace((prev) => ({ ...prev, birthCountry }))}
            disabled={busy}
          />
          <Pressable
            onPress={() => void onSaveBirthPlace()}
            disabled={busy}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>
              {savingBirthPlace ? 'Saving…' : 'Save place of birth'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Dosha</Text>
          <Text style={styles.copy}>{doshaLabel(dosha)}</Text>
          <Pressable
            onPress={() => navigation.navigate('DoshaRetake')}
            disabled={busy}
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          >
            <Text style={styles.secondaryButtonText}>Re-take quiz</Text>
          </Pressable>

          <Text style={styles.label}>Check-in time</Text>
          <Text style={styles.helperInline}>
            When would you like DOST to check in with you? (default: 8pm)
          </Text>
          {Platform.OS === 'android' ? (
            <Pressable onPress={() => setShowPicker(true)} style={styles.timeButton}>
              <Text style={styles.timeButtonText}>{timeLabel}</Text>
            </Pressable>
          ) : (
            <Text style={styles.timeLabel}>{timeLabel}</Text>
          )}
          {showPicker || Platform.OS === 'ios' ? (
            <DateTimePicker
              value={dateFromTime(time)}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onTimeChange}
            />
          ) : null}
          <Text style={styles.helper}>
            You'll be asked for notification permission when you save. On Expo Go, reminders may not
            fire — use Reflect in chat to open the same check-in.
          </Text>
          <Pressable
            onPress={() => void onSaveTime()}
            disabled={busy}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{savingTime ? 'Saving…' : 'Save time'}</Text>
          </Pressable>

          <Text style={styles.section}>What DOST remembers</Text>
          <Text style={styles.memoryBox}>
            {memorySummary ??
              "DOST hasn't formed a memory yet. Chat a bit more, then tap Refresh."}
          </Text>
          <Pressable
            onPress={() => void onRefreshMemory()}
            disabled={busy}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>

          <Text style={styles.section}>Privacy</Text>
          <Pressable
            onPress={() => void onExport()}
            disabled={busy}
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          >
            <Text style={styles.secondaryButtonText}>
              {exporting ? 'Exporting…' : 'Export my data'}
            </Text>
          </Pressable>
          <Text style={styles.helper}>Saves a JSON file you can keep. Up to 3 exports per day.</Text>

          <Pressable
            onPress={onDeleteConversations}
            disabled={busy}
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          >
            <Text style={styles.dangerText}>
              {deletingChats ? 'Deleting…' : 'Delete all my conversations'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onDeleteAccountPress}
            disabled={busy}
            style={styles.accountButton}
          >
            <Text style={styles.accountText}>Delete my account</Text>
          </Pressable>
        </ScrollView>
      </View>

      <Modal
        visible={accountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Type DELETE to confirm</Text>
            <Text style={styles.helper}>
              This removes your account and everything DOST stored for you.
            </Text>
            <TextInput
              style={styles.input}
              value={deleteTyped}
              onChangeText={setDeleteTyped}
              placeholder="DELETE"
              placeholderTextColor="#888"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deletingAccount}
              underlineColorAndroid="transparent"
            />
            <Pressable
              onPress={() => void runDeleteAccount()}
              disabled={deleteTyped !== 'DELETE' || deletingAccount}
              style={[
                styles.button,
                styles.dangerButton,
                (deleteTyped !== 'DELETE' || deletingAccount) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {deletingAccount ? 'Deleting…' : 'Delete my account'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAccountModal(false)}
              disabled={deletingAccount}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: 20, paddingVertical: 8 },
  back: { fontSize: 16, color: '#2563eb', fontWeight: '600' },
  content: { paddingHorizontal: 28, paddingBottom: 32 },
  heading: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  section: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 28,
    marginBottom: 12,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  copy: { fontSize: 16, color: '#0f172a', marginBottom: 8 },
  helper: { fontSize: 14, lineHeight: 20, color: '#64748b', marginTop: 8, marginBottom: 8 },
  helperInline: { fontSize: 14, lineHeight: 20, color: '#64748b', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  timeButton: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  timeButtonText: { fontSize: 16, color: '#0f172a' },
  timeLabel: { fontSize: 18, color: '#0f172a', marginBottom: 8 },
  memoryBox: {
    fontSize: 16,
    lineHeight: 24,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 12,
  },
  secondaryButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '600' },
  dangerText: { color: '#dc2626', fontSize: 16, fontWeight: '600' },
  accountButton: { alignSelf: 'flex-start', marginTop: 20, paddingVertical: 8 },
  accountText: { color: '#dc2626', fontSize: 16, fontWeight: '600' },
  dangerButton: { backgroundColor: '#dc2626' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
});
