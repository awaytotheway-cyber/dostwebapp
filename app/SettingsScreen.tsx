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
  restoreEveningScheduleIfAllowed,
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
import HearingSettingsSection from './HearingSettingsSection';
import {
  APP_LANGUAGES,
  NATIVE_LANGUAGE_NAMES,
  useI18n,
  type TKey,
} from '../lib/i18n';

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

export default function SettingsScreen({ navigation, onStartOver }: Props) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { t, lang, locale, setLanguage } = useI18n();
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
      dateFromTime(time).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time, locale],
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
        Alert.alert(t('common.couldNotSave'), saved.message);
        return;
      }
      Alert.alert(t('common.saved'), t('settings.nameIntentionUpdated'));
    } catch {
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
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
        Alert.alert(t('common.couldNotSave'), saved.message);
        return;
      }
      Alert.alert(t('common.saved'), t('settings.birthPlaceUpdated'));
    } catch {
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
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
        Alert.alert(t('common.couldNotSave'), saved.message);
        return;
      }

      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(t('settings.timeSaved'), t('settings.remindersNeedPermission'));
        return;
      }

      const scheduled = await scheduleEveningCheckIn(time);
      Alert.alert(
        t('settings.timeSaved'),
        scheduled.scheduled
          ? t('settings.checkInScheduled')
          : scheduled.warning ?? t('settings.checkInFallback'),
      );
    } catch {
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
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
        Alert.alert(t('settings.couldNotRefresh'), result.message);
        return;
      }
      const summary = await loadMemorySummary();
      setMemorySummary(summary);
      if (result.status === 'skipped') {
        Alert.alert(t('settings.noUpdateYet'), t('settings.noUpdateYetBody'));
        return;
      }
      Alert.alert(t('settings.updated'), t('settings.memoryRefreshed'));
    } catch {
      Alert.alert(t('settings.couldNotRefresh'), t('common.pleaseTryAgain'));
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
        Alert.alert(t('settings.couldNotExport'), result.message);
      }
    } catch {
      Alert.alert(t('settings.couldNotExport'), t('common.pleaseTryAgain'));
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
        Alert.alert(t('settings.couldNotDelete'), result.message);
        return;
      }
      setMemorySummary(null);
      Alert.alert(t('settings.conversationsDeleted'), t('settings.profileStillHere'));
      navigation.navigate('Chat', { conversationsCleared: true });
    } catch {
      Alert.alert(t('settings.couldNotDelete'), t('common.pleaseTryAgain'));
    } finally {
      setDeletingChats(false);
    }
  };

  const onDeleteConversations = () => {
    Alert.alert(
      t('settings.deleteConversationsTitle'),
      t('settings.deleteConversationsBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteConversationsConfirm'),
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
      t('settings.deleteAccountTitle'),
      t('settings.deleteAccountBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.continue'),
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
        Alert.alert(t('settings.couldNotDelete'), result.message);
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
      Alert.alert(t('settings.couldNotDelete'), t('common.pleaseTryAgain'));
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
      t('settings.startFreshTitle'),
      t('settings.startFreshBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.startFreshConfirm'),
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
                Alert.alert(t('settings.couldNotRefresh'), t('common.pleaseTryAgain'));
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
            accessibilityLabel={t('common.goBack')}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.back}>{t('common.backPlain')}</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.eyebrow}>{t('settings.eyebrow')}</Text>
          <Text style={styles.heading}>{t('settings.heading')}</Text>
          <Text style={styles.intro}>{t('settings.intro')}</Text>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>{t('language.title')}</Text>
            <Text style={styles.sectionIntro}>{t('language.hint')}</Text>
            <View style={styles.langRow}>
              {APP_LANGUAGES.map((code) => (
                <Pressable
                  key={code}
                  onPress={() => {
                    if (code === lang) return;
                    // Re-schedule so the evening reminder text follows the new language.
                    void setLanguage(code).then(restoreEveningScheduleIfAllowed);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: lang === code }}
                  accessibilityLabel={NATIVE_LANGUAGE_NAMES[code]}
                  style={({ pressed }) => [
                    styles.langChip,
                    lang === code && styles.langChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.langChipText, lang === code && styles.langChipTextActive]}>
                    {NATIVE_LANGUAGE_NAMES[code]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>{t('settings.myProfile')}</Text>
            <Text style={styles.sectionIntro}>{t('settings.myProfileIntro')}</Text>
            <Text style={styles.label}>{t('settings.name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(value) => setName(value.slice(0, MAX_NAME))}
              placeholder={t('settings.namePlaceholder')}
              placeholderTextColor={colors.clay}
              selectionColor={colors.gold}
              cursorColor={colors.gold}
              maxLength={MAX_NAME}
              autoCapitalize="words"
              editable={!busy}
              underlineColorAndroid="transparent"
            />
            <Text style={styles.label}>{t('settings.intention')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={intention}
              onChangeText={(value) => setIntention(value.slice(0, MAX_INTENTION))}
              placeholder={t('settings.intentionPlaceholder')}
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
              accessibilityLabel={t('settings.saveNameIntentionA11y')}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {savingProfile ? t('common.saving') : t('settings.saveNameIntention')}
              </Text>
            </Pressable>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>{t('settings.placeOfBirth')}</Text>
              <Text style={styles.helperInline}>{t('settings.placeOfBirthHelper')}</Text>
              <Text style={styles.label}>{t('settings.city')}</Text>
              <TextInput
                style={styles.input}
                value={birthPlace.birthCity}
                onChangeText={(value) =>
                  setBirthPlace((prev) => ({ ...prev, birthCity: value.slice(0, FIELD_MAX) }))
                }
                placeholder={t('settings.city')}
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
                maxLength={FIELD_MAX}
                autoCapitalize="words"
                editable={!busy}
                underlineColorAndroid="transparent"
              />
              <Text style={styles.label}>{t('settings.district')}</Text>
              <TextInput
                style={styles.input}
                value={birthPlace.birthDistrict}
                onChangeText={(value) =>
                  setBirthPlace((prev) => ({ ...prev, birthDistrict: value.slice(0, FIELD_MAX) }))
                }
                placeholder={t('settings.district')}
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
                maxLength={FIELD_MAX}
                autoCapitalize="words"
                editable={!busy}
                underlineColorAndroid="transparent"
              />
              <Text style={styles.label}>{t('settings.state')}</Text>
              <TextInput
                style={styles.input}
                value={birthPlace.birthState}
                onChangeText={(value) =>
                  setBirthPlace((prev) => ({ ...prev, birthState: value.slice(0, FIELD_MAX) }))
                }
                placeholder={t('settings.state')}
                placeholderTextColor={colors.clay}
                selectionColor={colors.gold}
                cursorColor={colors.gold}
                maxLength={FIELD_MAX}
                autoCapitalize="words"
                editable={!busy}
                underlineColorAndroid="transparent"
              />
              <Text style={styles.label}>{t('settings.country')}</Text>
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
                accessibilityLabel={t('settings.savePlaceOfBirth')}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.buttonText}>
                  {savingBirthPlace ? t('common.saving') : t('settings.savePlaceOfBirth')}
                </Text>
              </Pressable>
            </View>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>{t('settings.dosha')}</Text>
              <Text style={styles.copy}>
                {dosha ? t(`dosha.${dosha}` as TKey) : t('settings.doshaNotSet')}
              </Text>
              <Pressable
                onPress={() => navigation.navigate('DoshaRetake')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('settings.retakeDoshaA11y')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>{t('settings.retakeQuiz')}</Text>
              </Pressable>
            </View>

            <View style={styles.subsection}>
              <Text style={styles.subheading}>{t('settings.personalityProfile')}</Text>
              <Text style={styles.helperInline}>{t('settings.personalityProfileHelper')}</Text>
              <Pressable
                onPress={() => navigation.navigate('PersonalityProfile')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('settings.openPersonalityProfile')}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {t('settings.openPersonalityProfile')}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>{t('settings.reflectionTime')}</Text>
            <Text style={styles.sectionIntro}>{t('settings.reflectionTimeIntro')}</Text>
            {Platform.OS === 'android' ? (
              <Pressable
                onPress={() => setShowPicker(true)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.chooseCheckInTimeA11y')}
                style={({ pressed }) => [styles.timeButton, pressed && styles.activeField]}
              >
                <Text style={styles.timeButtonLabel}>{t('settings.dailyCheckIn')}</Text>
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
            <Text style={styles.helper}>{t('settings.reflectionTimeHelper')}</Text>
            <Pressable
              onPress={() => void onSaveTime()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.saveReflectionTimeA11y')}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {savingTime ? t('common.saving') : t('settings.saveTime')}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.sectionBlock, styles.memorySection]}>
            <Text style={styles.section}>{t('settings.memoryTitle')}</Text>
            <Text style={styles.memoryIntro}>{t('settings.memoryIntro')}</Text>
            <Text style={styles.memoryBox}>{memorySummary ?? t('settings.memoryEmpty')}</Text>
            <Pressable
              onPress={() => void onRefreshMemory()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.refreshMemory')}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {refreshing ? t('common.refreshing') : t('settings.refreshMemory')}
              </Text>
            </Pressable>
          </View>

          <HearingSettingsSection />

          <View style={styles.sectionBlock}>
            <Text style={styles.section}>{t('settings.privacyTitle')}</Text>
            <Text style={styles.sectionIntro}>{t('settings.privacyIntro')}</Text>
            <Pressable
              onPress={() => void onExport()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.exportMyData')}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.secondaryButtonText}>
                {exporting ? t('settings.exporting') : t('settings.exportMyData')}
              </Text>
            </Pressable>
            <Text style={styles.helper}>{t('settings.exportHelper')}</Text>

            <View style={styles.actionDivider} />
            <Pressable
              onPress={onDeleteConversations}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.deleteAllConversationsA11y')}
              style={({ pressed }) => [
                styles.dangerOutlineButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.dangerText}>
                {deletingChats ? t('common.deleting') : t('settings.deleteAllConversations')}
              </Text>
            </Pressable>

            <Pressable
              onPress={onSignOut}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.startFreshSession')}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.signOutButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.signOutText}>
                {signingOut ? t('common.refreshing') : t('settings.startFreshSession')}
              </Text>
            </Pressable>
            <Text style={styles.helper}>{t('settings.startFreshHelper')}</Text>

            <Pressable
              onPress={onDeleteAccountPress}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('settings.deleteMyAccount')}
              style={({ pressed }) => [
                styles.accountButton,
                pressed && styles.pressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.accountText}>{t('settings.deleteMyAccount')}</Text>
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
            <Text style={styles.modalTitle}>{t('settings.typeDeleteTitle')}</Text>
            <Text style={styles.modalCopy}>{t('settings.typeDeleteBody')}</Text>
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
              accessibilityLabel={t('settings.confirmDeleteAccountA11y')}
              style={[
                styles.button,
                styles.dangerButton,
                (deleteTyped !== 'DELETE' || deletingAccount) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {deletingAccount ? t('common.deleting') : t('settings.deleteMyAccount')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAccountModal(false)}
              disabled={deletingAccount}
              accessibilityRole="button"
              accessibilityLabel={t('settings.cancelDeleteAccountA11y')}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  langChip: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  langChipActive: { borderColor: colors.gold, backgroundColor: colors.goldWash },
  langChipText: { ...typography.label, color: colors.sand },
  langChipTextActive: { color: colors.gold },
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
