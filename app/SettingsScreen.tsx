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
import {
  DEFAULT_BIRTH_COUNTRY,
  emptyBirthPlace,
  type BirthPlace,
} from '../lib/birthPlace';
import CountryPicker from './CountryPicker';
import { loadMemorySummary, refreshUserMemory } from '../lib/memory';
import { deleteMyAccount, deleteMyConversations, exportMyData } from '../lib/privacy';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingStorage';
import { supabase } from '../lib/supabase';
import { purgeUserDatabase } from '../lib/localDb';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

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
  const reduceMotion = useReducedMotion();
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
  const [signingOut, setSigningOut] = useState(false);

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
        birthCountry: profileLoad.profile.birth_country ?? DEFAULT_BIRTH_COUNTRY,
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
    deletingAccount ||
    signingOut;

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
          'Reminders need notification permission. You can still tap Evening check-in in chat whenever you like.',
        );
        return;
      }

      const scheduled = await scheduleEveningCheckIn(time);
      Alert.alert(
        'Time saved',
        scheduled.scheduled
          ? 'DOST will check in at this time. On Expo Go, the reminder may not appear — tap Evening check-in in chat to try the same flow.'
          : scheduled.warning ??
              'Time saved. Tap Evening check-in in chat if a reminder does not appear.',
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
      await clearLocalCacheForCurrentUser();
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


  const clearLocalCacheForCurrentUser = async () => {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) return;
    await purgeUserDatabase(userId);
  };

  const onSignOut = () => {
    if (busy) return;
    Alert.alert(
      'Start fresh?',
      'This clears chat saved on this phone, then opens a new private guest session.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start fresh',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSigningOut(true);
              try {
                await clearLocalCacheForCurrentUser();
                await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
                try {
                  await supabase.auth.signOut();
                } catch {
                  // Session may already be gone.
                }
                onStartOver();
              } catch {
                Alert.alert('Could not refresh', 'Please try again.');
              } finally {
                setSigningOut(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.flex, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.eyebrow}>YOUR SPACE</Text>
          <Text style={styles.heading}>Space Settings</Text>
          <Text style={styles.intro}>
            Shape what DOST knows, when it checks in, and what you choose to keep.
          </Text>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>My profile</Text>
            <Text style={styles.sectionIntro}>The details that help DOST speak to you personally.</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
              placeholder="Your name"
              placeholderTextColor={colors.clay}
              selectionColor={colors.gold}
              cursorColor={colors.gold}
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
              placeholderTextColor={colors.clay}
              selectionColor={colors.gold}
              cursorColor={colors.gold}
              maxLength={MAX_INTENTION}
              multiline
              editable={!busy}
              textAlignVertical="top"
              underlineColorAndroid="transparent"
            />
            <Pressable
              onPress={() => void onSaveProfile()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Save name and intention"
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {savingProfile ? 'Saving…' : 'Save name & intention'}
              </Text>
            </Pressable>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>Place of birth</Text>
              <Text style={styles.helperInline}>Optional. City, district, state, and country.</Text>
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                value={birthPlace.birthCity}
                onChangeText={(value) =>
                  setBirthPlace((prev) => ({ ...prev, birthCity: value.slice(0, FIELD_MAX) }))
                }
                placeholder="City"
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
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
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
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
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
                maxLength={FIELD_MAX}
                autoCapitalize="words"
                editable={!busy}
                underlineColorAndroid="transparent"
              />
              <Text style={styles.label}>Country</Text>
              <View style={styles.pickerFrame}>
                <CountryPicker
                  value={birthPlace.birthCountry || DEFAULT_BIRTH_COUNTRY}
                  onChange={(birthCountry) =>
                    setBirthPlace((prev) => ({ ...prev, birthCountry }))
                  }
                  disabled={busy}
                />
              </View>
              <Pressable
                onPress={() => void onSaveBirthPlace()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Save place of birth"
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.buttonText}>
                  {savingBirthPlace ? 'Saving…' : 'Save place of birth'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>Dosha</Text>
              <Text style={styles.copy}>{doshaLabel(dosha)}</Text>
              <Pressable
                onPress={() => navigation.navigate('DoshaRetake')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Re-take dosha quiz"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Re-take quiz</Text>
              </Pressable>
            </View>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>Personality profile</Text>
              <Text style={styles.helperInline}>
                Enneagram, Life Path, TCM, and MBTI — complete what you skipped, or change what you
                already shared.
              </Text>
              <Pressable
                onPress={() => navigation.navigate('PersonalityProfile')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Open personality profile"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Open personality profile</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>Reflection time</Text>
            <Text style={styles.sectionIntro}>
              Choose a gentle daily moment for DOST to check in.
            </Text>
            {Platform.OS === 'android' ? (
              <Pressable
                onPress={() => setShowPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose daily check-in time"
                style={({ pressed }) => [styles.timeButton, pressed && styles.activeField]}
              >
                <Text style={styles.timeButtonLabel}>DAILY CHECK-IN</Text>
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
                accentColor={colors.gold}
                themeVariant="light"
              />
            ) : null}
            <Text style={styles.helper}>
              You'll be asked for notification permission when you save. On Expo Go, reminders may
              not fire — use Evening check-in in chat to open the same check-in.
            </Text>
            <Pressable
              onPress={() => void onSaveTime()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Save reflection time"
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>{savingTime ? 'Saving…' : 'Save time'}</Text>
            </Pressable>
          </View>

          <View style={[styles.sectionBlock, styles.memorySection]}>
            <Text style={styles.section}>What DOST remembers</Text>
            <Text style={styles.memoryIntro}>
              A small, evolving summary — so you can always see what stays with DOST.
            </Text>
            <Text style={styles.memoryBox}>
              {memorySummary ??
                "DOST hasn't formed a memory yet. Chat a bit more, then tap Refresh."}
            </Text>
            <Pressable
              onPress={() => void onRefreshMemory()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Refresh memory"
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {refreshing ? 'Refreshing…' : 'Refresh memory'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>Privacy & account</Text>
            <Text style={styles.sectionIntro}>Your words and your choices remain yours.</Text>
            <Pressable
              onPress={() => void onExport()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Export my data"
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.secondaryButtonText}>
                {exporting ? 'Exporting…' : 'Export my data'}
              </Text>
            </Pressable>
            <Text style={styles.helper}>Saves a JSON file you can keep. Up to 3 exports per day.</Text>

            <View style={styles.actionDivider} />
            <Pressable
              onPress={onDeleteConversations}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Delete all conversations"
              style={({ pressed }) => [
                styles.dangerOutlineButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.dangerText}>
                {deletingChats ? 'Deleting…' : 'Delete all my conversations'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onSignOut}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Start fresh session"
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.signOutButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.signOutText}>
                {signingOut ? 'Refreshing…' : 'Start fresh session'}
              </Text>
            </Pressable>
            <Text style={styles.helper}>
              Clears chat saved on this phone, then opens a new private guest session.
            </Text>

            <Pressable
              onPress={onDeleteAccountPress}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
              style={({ pressed }) => [
                styles.accountButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.accountText}>Delete my account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      <Modal
        visible={accountModal}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setAccountModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalScrim} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Type DELETE to confirm</Text>
            <Text style={styles.modalCopy}>
              This removes your account and everything DOST stored for you.
            </Text>
            <TextInput
              style={styles.input}
              value={deleteTyped}
              onChangeText={setDeleteTyped}
              placeholder="DELETE"
              placeholderTextColor={colors.clay}
              selectionColor={colors.gold}
              cursorColor={colors.gold}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deletingAccount}
              underlineColorAndroid="transparent"
            />
            <Pressable
              onPress={() => void runDeleteAccount()}
              disabled={deleteTyped !== 'DELETE' || deletingAccount}
              accessibilityRole="button"
              accessibilityLabel="Confirm delete my account"
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
              accessibilityRole="button"
              accessibilityLabel="Cancel account deletion"
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
  container: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  back: { ...typography.label, color: colors.gold, fontSize: 15 },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing['4xl'],
  },
  eyebrow: {
    ...typography.label,
    color: colors.gold,
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  heading: { ...typography.heading, color: colors.cream, fontSize: 32, lineHeight: 36 },
  intro: {
    ...typography.body,
    color: colors.sand,
    marginTop: spacing.sm,
    marginBottom: spacing['2xl'],
    maxWidth: 520,
  },
  sectionBlock: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  section: {
    ...typography.heading,
    fontSize: 23,
    lineHeight: 30,
    color: colors.cream,
    marginBottom: spacing.xs,
  },
  sectionIntro: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.sand,
    marginBottom: spacing.md,
  },
  subsection: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing['2xl'],
    paddingTop: spacing.xl,
  },
  subheading: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 19,
    lineHeight: 26,
    color: colors.cream,
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.sand,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  copy: { ...typography.body, color: colors.cream, marginBottom: spacing.xs },
  helper: {
    ...typography.caption,
    color: colors.clay,
    lineHeight: 18,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  helperInline: {
    ...typography.caption,
    color: colors.clay,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.cream,
    backgroundColor: colors.surface,
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  pickerFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  timeButton: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  activeField: { borderColor: colors.gold },
  timeButtonLabel: {
    ...typography.caption,
    color: colors.clay,
    letterSpacing: 1.1,
    marginBottom: spacing.xs,
  },
  timeButtonText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 22,
    lineHeight: 28,
    color: colors.cream,
  },
  timeLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 22,
    lineHeight: 28,
    color: colors.cream,
    marginVertical: spacing.sm,
  },
  memorySection: { backgroundColor: colors.surfaceRaised },
  memoryIntro: {
    ...typography.reflectivePrompt,
    fontSize: 17,
    lineHeight: 25,
    color: colors.sand,
    marginBottom: spacing.lg,
  },
  memoryBox: {
    ...typography.dostMessage,
    color: colors.cream,
    borderLeftWidth: 2,
    borderLeftColor: colors.gold,
    paddingLeft: spacing.lg,
    marginBottom: spacing.md,
  },
  button: {
    alignSelf: 'stretch',
    minHeight: 52,
    justifyContent: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  pressed: { opacity: 0.76 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...typography.label, color: colors.onPrimary, fontSize: 14 },
  secondaryButton: {
    alignSelf: 'stretch',
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { ...typography.label, color: colors.cream, fontSize: 14 },
  signOutButton: {
    backgroundColor: colors.logoutWash,
    borderColor: colors.logoutWash,
  },
  signOutText: { ...typography.label, color: colors.gold, fontSize: 15 },
  actionDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: spacing.lg,
  },
  dangerOutlineButton: {
    alignSelf: 'stretch',
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
    backgroundColor: colors.logoutWash,
  },
  dangerText: { ...typography.label, color: colors.error, fontSize: 14 },
  accountButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  accountText: { ...typography.label, color: colors.error, fontSize: 14 },
  dangerButton: { backgroundColor: colors.error },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
  },
  modalTitle: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 23,
    lineHeight: 30,
    color: colors.cream,
    marginBottom: spacing.sm,
  },
  modalCopy: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.sand,
    marginBottom: spacing.md,
  },
});
