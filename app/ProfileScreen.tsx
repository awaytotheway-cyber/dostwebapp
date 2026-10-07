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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { loadMyProfile, updateMyBirthPlace, updateMyNameAndIntention, type Dosha, type ProfileRow } from '../lib/profile';
import {
  formatDiagnostic,
  getLastApiError,
  type ApiErrorDiagnostic,
} from '../lib/diagnostics';
import { loadReflectionTime, saveReflectionTime, type HmTime } from '../lib/intentions';
import {
  requestNotificationPermission,
  restoreEveningScheduleIfAllowed,
  scheduleEveningCheckIn,
} from '../lib/notifications';
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
import {
  APP_LANGUAGES,
  NATIVE_LANGUAGE_NAMES,
  getLocaleTag,
  t as translate,
  useI18n,
  type TKey,
} from '../lib/i18n';
import { fonts, colors, radius, spacing, type as typography } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { ChatStackParamList } from './chatTypes';
import BreathingDot from './BreathingDot';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';

type Props = NativeStackScreenProps<ChatStackParamList, 'Profile'> & {
  onStartOver?: () => void;
};

const dark = {
  base: '#1A1614',
  card: '#241E1B',
  cardRaised: '#2D2218',
  title: '#EDE4D3',
  sand: '#C9B79C',
  muted: '#9A8878',
  border: 'rgba(237, 228, 211, 0.10)',
  divider: 'rgba(237, 228, 211, 0.08)',
} as const;

const MAX_NAME = 40;
const MAX_INTENTION = 200;
const FIELD_MAX = 80;

function dateFromTime(t: HmTime): Date {
  const d = new Date();
  d.setHours(t.hour, t.minute, 0, 0);
  return d;
}

function doshaLabel(dosha: Dosha | null | undefined): string {
  if (!dosha) return translate('settings.doshaNotSet');
  return translate(`dosha.${dosha}` as TKey);
}

function memberSince(profile: ProfileRow | null): string {
  if (!profile) return '';
  const created = (profile as any).created_at ?? (profile as any).insertedAt ?? null;
  if (!created) return '';
  try {
    const d = new Date(created);
    return translate('profile.hereSince', {
      date: d.toLocaleDateString(getLocaleTag(), { month: 'long', year: 'numeric' }),
    });
  } catch {
    return '';
  }
}

function greetingName(profile: ProfileRow | null): string {
  return profile?.name?.trim() || translate('profile.guest');
}

export default function ProfileScreen({ navigation, onStartOver }: Props) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { t, lang, locale, setLanguage } = useI18n();

  // Profile state
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastError, setLastError] = useState<ApiErrorDiagnostic | null>(null);

  // Settings state
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

  const busy =
    savingProfile || savingBirthPlace || savingTime ||
    refreshing || exporting || deletingChats || deletingAccount || signingOut;

  const timeLabel = useMemo(
    () => dateFromTime(time).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
    [time, locale],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [result, diag, loadedTime, summary] = await Promise.all([
          loadMyProfile(),
          getLastApiError(),
          loadReflectionTime(),
          loadMemorySummary(),
        ]);
        if (cancelled) return;
        if (result.ok && result.profile) {
          setProfile(result.profile);
          setName(result.profile.name ?? '');
          setIntention(result.profile.intention ?? '');
          setDosha(result.profile.dosha);
          setBirthPlace({
            birthCity: result.profile.birth_city ?? '',
            birthDistrict: result.profile.birth_district ?? '',
            birthState: result.profile.birth_state ?? '',
            birthCountry: result.profile.birth_country ?? DEFAULT_BIRTH_COUNTRY,
          });
        } else {
          setProfile(null);
        }
        setLastError(diag);
        setTime(loadedTime);
        setMemorySummary(summary);
        setLoaded(true);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  const displayName = loaded ? greetingName(profile) : '';
  const memberLabel = loaded ? memberSince(profile) : '';

  // ── Handlers ──────────────────────────────────────────────────────
  const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed') return;
    if (selected) setTime({ hour: selected.getHours(), minute: selected.getMinutes() });
  };

  const onSaveProfile = async () => {
    if (busy) return;
    setSavingProfile(true);
    try {
      const saved = await updateMyNameAndIntention(name, intention);
      if (!saved.ok) { Alert.alert(t('common.couldNotSave'), saved.message); return; }
      Alert.alert(t('common.saved'), t('settings.nameIntentionUpdated'));
    } catch { Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain')); }
    finally { setSavingProfile(false); }
  };

  const onSaveBirthPlace = async () => {
    if (busy) return;
    setSavingBirthPlace(true);
    try {
      const saved = await updateMyBirthPlace(birthPlace);
      if (!saved.ok) { Alert.alert(t('common.couldNotSave'), saved.message); return; }
      Alert.alert(t('common.saved'), t('settings.birthPlaceUpdated'));
    } catch { Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain')); }
    finally { setSavingBirthPlace(false); }
  };

  const onSaveTime = async () => {
    if (busy) return;
    setSavingTime(true);
    try {
      const saved = await saveReflectionTime(time);
      if (!saved.ok) { Alert.alert(t('common.couldNotSave'), saved.message); return; }
      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(t('settings.timeSaved'), t('settings.remindersNeedPermission'));
        return;
      }
      const scheduled = await scheduleEveningCheckIn(time);
      Alert.alert(t('settings.timeSaved'), scheduled.scheduled
        ? t('profile.checkInScheduled')
        : (scheduled.warning ?? t('profile.timeSavedShort')));
    } catch { Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain')); }
    finally { setSavingTime(false); }
  };

  const onRefreshMemory = async () => {
    if (busy) return;
    setRefreshing(true);
    try {
      const result = await refreshUserMemory();
      if (!result.ok) { Alert.alert(t('settings.couldNotRefresh'), result.message); return; }
      const summary = await loadMemorySummary();
      setMemorySummary(summary);
      if (result.status === 'skipped') {
        Alert.alert(t('settings.noUpdateYet'), t('settings.noUpdateYetBody'));
        return;
      }
      Alert.alert(t('settings.updated'), t('settings.memoryRefreshed'));
    } catch { Alert.alert(t('settings.couldNotRefresh'), t('common.pleaseTryAgain')); }
    finally { setRefreshing(false); }
  };

  const onExport = async () => {
    if (busy) return;
    setExporting(true);
    try {
      const result = await exportMyData();
      if (!result.ok) Alert.alert(t('settings.couldNotExport'), result.message);
    } catch { Alert.alert(t('settings.couldNotExport'), t('common.pleaseTryAgain')); }
    finally { setExporting(false); }
  };

  const clearLocalCache = async () => {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (userId) await purgeUserDatabase(userId);
  };

  const onDeleteConversations = () => {
    Alert.alert(t('settings.deleteConversationsTitle'), t('settings.deleteConversationsBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConversationsConfirm'), style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeletingChats(true);
            try {
              const result = await deleteMyConversations();
              if (!result.ok) { Alert.alert(t('settings.couldNotDelete'), result.message); return; }
              setMemorySummary(null);
              Alert.alert(t('settings.conversationsDeleted'), t('settings.profileStillHere'));
              navigation.navigate('Chat', { conversationsCleared: true });
            } catch { Alert.alert(t('settings.couldNotDelete'), t('common.pleaseTryAgain')); }
            finally { setDeletingChats(false); }
          })();
        },
      },
    ]);
  };

  const onDeleteAccountPress = () => {
    Alert.alert(t('settings.deleteAccountTitle'), t('settings.deleteAccountBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.continue'), style: 'destructive', onPress: () => { setDeleteTyped(''); setAccountModal(true); } },
    ]);
  };

  const runDeleteAccount = async () => {
    if (deleteTyped !== 'DELETE' || busy) return;
    setDeletingAccount(true);
    try {
      const result = await deleteMyAccount();
      if (!result.ok) { Alert.alert(t('settings.couldNotDelete'), result.message); return; }
      setAccountModal(false);
      await clearLocalCache();
      await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
      try { await supabase.auth.signOut(); } catch {}
      onStartOver?.();
    } catch { Alert.alert(t('settings.couldNotDelete'), t('common.pleaseTryAgain')); }
    finally { setDeletingAccount(false); }
  };

  const onSignOut = () => {
    if (busy) return;
    Alert.alert(t('settings.startFreshTitle'), t('settings.startFreshBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.startFreshConfirm'), style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            try {
              await clearLocalCache();
              await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
              try { await supabase.auth.signOut(); } catch {}
              onStartOver?.();
            } catch { Alert.alert(t('settings.couldNotRefresh'), t('common.pleaseTryAgain')); }
            finally { setSigningOut(false); }
          })();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PaperGrain />

      {/* ── Header ── */}
      <View style={styles.header}>
        <GentlePressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.backPlain')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={dark.sand} />
          <Text style={styles.backLabel}>{t('profile.you')}</Text>
        </GentlePressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing['4xl'] },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Avatar + name ── */}
        <View style={styles.hero}>
          <View style={styles.avatar}>
            {!loaded
              ? <BreathingDot size={12} color={colors.terracottaDot} />
              : <Text style={styles.avatarLetter}>{displayName.charAt(0).toUpperCase()}</Text>
            }
          </View>
          {loaded && (
            <>
              <Text style={styles.name}>{displayName}</Text>
              {memberLabel ? <Text style={styles.memberSince}>{memberLabel}</Text> : null}
            </>
          )}
        </View>

        {/* ── HOW DOST TALKS TO YOU ── */}
        {loaded && (
          <View style={styles.talkCard}>
            <Text style={styles.talkCardLabel}>{t('profile.talkCardLabel')}</Text>
            <Text style={styles.talkCardValue}>
              {intention.trim() || t('profile.talkCardDefault')}
            </Text>
          </View>
        )}

        <SectionHeader title={t('language.title')} intro={t('language.hint')} />
        <View style={[styles.sectionCard, styles.langRow]}>
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

        {/* ══ My profile section ══════════════════════════════ */}
        <SectionHeader title={t('settings.myProfile')} intro={t('profile.myProfileIntro')} />
        <View style={styles.sectionCard}>
          <FieldLabel>{t('settings.name')}</FieldLabel>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(v) => setName(v.slice(0, MAX_NAME))}
            placeholder={t('settings.namePlaceholder')}
            placeholderTextColor={dark.muted}
            selectionColor={colors.terracotta}
            maxLength={MAX_NAME}
            autoCapitalize="words"
            editable={!busy}
            underlineColorAndroid="transparent"
          />
          <FieldLabel>{t('settings.intention')}</FieldLabel>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={intention}
            onChangeText={(v) => setIntention(v.slice(0, MAX_INTENTION))}
            placeholder={t('settings.intentionPlaceholder')}
            placeholderTextColor={dark.muted}
            selectionColor={colors.terracotta}
            maxLength={MAX_INTENTION}
            multiline
            editable={!busy}
            textAlignVertical="top"
            underlineColorAndroid="transparent"
          />
          <CTAButton onPress={() => void onSaveProfile()} disabled={busy} loading={savingProfile} label={t('settings.saveNameIntention')} />

          <Divider />
          <SubHeader title={t('settings.placeOfBirth')} hint={t('settings.placeOfBirthHelper')} />
          <FieldLabel>{t('settings.city')}</FieldLabel>
          <TextInput style={styles.input} value={birthPlace.birthCity}
            onChangeText={(v) => setBirthPlace((p) => ({ ...p, birthCity: v.slice(0, FIELD_MAX) }))}
            placeholder={t('settings.city')} placeholderTextColor={dark.muted} selectionColor={colors.terracotta}
            autoCapitalize="words" editable={!busy} underlineColorAndroid="transparent" />
          <FieldLabel>{t('settings.district')}</FieldLabel>
          <TextInput style={styles.input} value={birthPlace.birthDistrict}
            onChangeText={(v) => setBirthPlace((p) => ({ ...p, birthDistrict: v.slice(0, FIELD_MAX) }))}
            placeholder={t('settings.district')} placeholderTextColor={dark.muted} selectionColor={colors.terracotta}
            autoCapitalize="words" editable={!busy} underlineColorAndroid="transparent" />
          <FieldLabel>{t('settings.state')}</FieldLabel>
          <TextInput style={styles.input} value={birthPlace.birthState}
            onChangeText={(v) => setBirthPlace((p) => ({ ...p, birthState: v.slice(0, FIELD_MAX) }))}
            placeholder={t('settings.state')} placeholderTextColor={dark.muted} selectionColor={colors.terracotta}
            autoCapitalize="words" editable={!busy} underlineColorAndroid="transparent" />
          <FieldLabel>{t('settings.country')}</FieldLabel>
          <View style={styles.pickerFrame}>
            <CountryPicker
              value={birthPlace.birthCountry || DEFAULT_BIRTH_COUNTRY}
              onChange={(birthCountry) => setBirthPlace((p) => ({ ...p, birthCountry }))}
              disabled={busy}
            />
          </View>
          <CTAButton onPress={() => void onSaveBirthPlace()} disabled={busy} loading={savingBirthPlace} label={t('settings.savePlaceOfBirth')} />

          <Divider />
          <SubHeader title={t('settings.dosha')} />
          <Text style={styles.copyValue}>{doshaLabel(dosha)}</Text>
          <SecondaryButton onPress={() => navigation.navigate('DoshaRetake')} disabled={busy} label={t('settings.retakeQuiz')} />

          <Divider />
          <SubHeader title={t('settings.personalityProfile')} hint={t('profile.personalityHelper')} />
          <SecondaryButton onPress={() => navigation.navigate('PersonalityProfile')} disabled={busy} label={t('settings.openPersonalityProfile')} />
        </View>

        {/* ══ Reminders section ═══════════════════════════════ */}
        <SectionHeader title={t('profile.reminders')} intro={t('profile.remindersIntro')} />
        <View style={styles.sectionCard}>
          {Platform.OS === 'android' ? (
            <Pressable
              onPress={() => setShowPicker(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.timeButton, pressed && styles.activeField]}
            >
              <Text style={styles.timeButtonLabel}>{t('settings.dailyCheckIn')}</Text>
              <Text style={styles.timeButtonText}>{timeLabel}</Text>
            </Pressable>
          ) : (
            <Text style={styles.timeLabel}>{timeLabel}</Text>
          )}
          {(showPicker || Platform.OS === 'ios') && (
            <DateTimePicker
              value={dateFromTime(time)}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onTimeChange}
              accentColor={colors.terracotta}
              themeVariant="dark"
            />
          )}
          <Text style={styles.helper}>{t('profile.remindersHelper')}</Text>
          <CTAButton onPress={() => void onSaveTime()} disabled={busy} loading={savingTime} label={t('settings.saveTime')} />
        </View>

        {/* ══ What Dost remembers ═════════════════════════════ */}
        <SectionHeader title={t('profile.memoryTitle')} intro={t('profile.memoryIntro')} />
        <View style={[styles.sectionCard, styles.memoryCard]}>
          <Text style={styles.memoryBox}>
            {memorySummary ?? t('profile.memoryEmpty')}
          </Text>
          <CTAButton onPress={() => void onRefreshMemory()} disabled={busy} loading={refreshing} label={t('settings.refreshMemory')} />
        </View>

        {/* ══ Privacy & account ═══════════════════════════════ */}
        <SectionHeader title={t('settings.privacyTitle')} intro={t('settings.privacyIntro')} />
        <View style={styles.sectionCard}>
          <SecondaryButton onPress={() => void onExport()} disabled={busy} loading={exporting} label={t('settings.exportMyData')} />
          <Text style={styles.helper}>{t('settings.exportHelper')}</Text>

          <Divider />
          <Pressable
            onPress={onDeleteConversations}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.dangerOutlineButton, pressed && styles.pressed, busy && styles.buttonDisabled]}
          >
            <Text style={styles.dangerText}>
              {deletingChats ? t('common.deleting') : t('settings.deleteAllConversations')}
            </Text>
          </Pressable>

          <SecondaryButton
            onPress={onSignOut}
            disabled={busy}
            loading={signingOut}
            label={signingOut ? t('common.refreshing') : t('profile.signOut')}
            style={styles.signOutButton}
            textStyle={styles.signOutText}
          />
          <Text style={styles.helper}>{t('settings.startFreshHelper')}</Text>

          <Pressable
            onPress={onDeleteAccountPress}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.accountButton, pressed && styles.pressed, busy && styles.buttonDisabled]}
          >
            <Text style={styles.accountText}>{t('settings.deleteMyAccount')}</Text>
          </Pressable>
        </View>

        {/* Diagnostics */}
        {lastError ? (
          <View style={styles.diagCard}>
            <Text style={styles.diagLabel}>{t('profile.lastIssue')}</Text>
            <Text style={styles.diagText}>{formatDiagnostic(lastError)}</Text>
            <Text style={styles.diagHint}>{t('profile.lastIssueHint')}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Delete account modal ── */}
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
            <Text style={styles.modalCopy}>{t('profile.deleteModalBody')}</Text>
            <TextInput
              style={styles.input}
              value={deleteTyped}
              onChangeText={setDeleteTyped}
              placeholder="DELETE"
              placeholderTextColor={dark.muted}
              selectionColor={colors.terracotta}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deletingAccount}
              underlineColorAndroid="transparent"
            />
            <Pressable
              onPress={() => void runDeleteAccount()}
              disabled={deleteTyped !== 'DELETE' || deletingAccount}
              accessibilityRole="button"
              style={[styles.ctaButton, styles.dangerButton, (deleteTyped !== 'DELETE' || deletingAccount) && styles.buttonDisabled]}
            >
              <Text style={styles.ctaText}>
                {deletingAccount ? t('common.deleting') : t('settings.deleteMyAccount')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setAccountModal(false)} disabled={deletingAccount} accessibilityRole="button" style={styles.secondaryButtonBase}>
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Small sub-components ─────────────────────────────────────────────────────

function SectionHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {intro ? <Text style={styles.sectionIntro}>{intro}</Text> : null}
    </View>
  );
}

function SubHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ marginBottom: spacing.xs }}>
      <Text style={styles.subHeading}>{title}</Text>
      {hint ? <Text style={styles.helperInline}>{hint}</Text> : null}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function CTAButton({ onPress, disabled, loading, label }: { onPress: () => void; disabled?: boolean; loading?: boolean; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ctaButton, pressed && styles.pressed, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.ctaText}>{loading ? translate('common.saving') : label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ onPress, disabled, loading, label, style: extraStyle, textStyle: extraTextStyle }: {
  onPress: () => void; disabled?: boolean; loading?: boolean; label: string;
  style?: object; textStyle?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.secondaryButtonBase, extraStyle, pressed && styles.pressed, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.secondaryButtonText, extraTextStyle]}>
        {loading ? translate('profile.loading') : label}
      </Text>
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.base },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    gap: 2,
  },
  backLabel: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    color: dark.title,
  },
  pressed: { opacity: 0.72 },
  scroll: {
    paddingHorizontal: spacing.xl,
    gap: spacing['2xl'],
  },

  // Hero
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: dark.card,
    borderWidth: 1,
    borderColor: dark.border,
  },
  avatarLetter: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 34,
    color: colors.terracottaDot,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 30,
    color: dark.title,
  },
  memberSince: { ...typography.caption, color: dark.muted },

  // How Dost talks card
  talkCard: {
    backgroundColor: dark.card,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: dark.border,
  },
  talkCardLabel: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: dark.muted,
  },
  talkCardValue: { ...typography.body, color: dark.title, lineHeight: 22 },

  // Section headers
  sectionHeaderWrap: { gap: spacing.xs, marginTop: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    color: dark.title,
  },
  sectionIntro: { ...typography.body, fontSize: 13, color: dark.sand, lineHeight: 20 },
  subHeading: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 22,
    color: dark.title,
    marginTop: spacing.lg,
  },

  // Section cards
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  langChip: {
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  langChipActive: { borderColor: colors.terracotta, backgroundColor: dark.cardRaised },
  langChipText: { ...typography.label, color: dark.sand },
  langChipTextActive: { color: dark.title },
  sectionCard: {
    backgroundColor: dark.card,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: dark.border,
  },
  memoryCard: { backgroundColor: dark.cardRaised },

  // Fields
  fieldLabel: {
    ...typography.label,
    color: dark.sand,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  input: {
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
    color: dark.title,
    backgroundColor: dark.base,
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  copyValue: { ...typography.body, color: dark.title, marginBottom: spacing.xs },
  helperInline: {
    ...typography.caption,
    color: dark.muted,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  helper: {
    ...typography.caption,
    color: dark.muted,
    lineHeight: 18,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: dark.divider, marginTop: spacing.xl, marginBottom: spacing.sm },
  pickerFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    marginTop: spacing.sm,
  },

  // Time picker
  timeButton: {
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: dark.base,
  },
  activeField: { borderColor: colors.terracotta },
  timeButtonLabel: { ...typography.caption, color: dark.muted, letterSpacing: 1.1, marginBottom: spacing.xs },
  timeButtonText: { fontFamily: fonts.regular, fontSize: 22, lineHeight: 28, color: dark.title },
  timeLabel: { fontFamily: fonts.regular, fontSize: 22, lineHeight: 28, color: dark.title, marginVertical: spacing.sm },

  // Memory
  memoryBox: {
    ...typography.body,
    color: dark.title,
    borderLeftWidth: 2,
    borderLeftColor: colors.terracotta,
    paddingLeft: spacing.lg,
    marginBottom: spacing.md,
  },

  // CTA button
  ctaButton: {
    alignSelf: 'stretch',
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.terracotta,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fonts.regular, fontSize: 14, color: colors.onTerracotta },

  // Secondary button
  secondaryButtonBase: {
    alignSelf: 'stretch',
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    backgroundColor: dark.cardRaised,
    alignItems: 'center',
  },
  secondaryButtonText: { fontFamily: fonts.regular, fontSize: 14, color: dark.title },

  // Sign out
  signOutButton: { backgroundColor: 'rgba(184, 76, 48, 0.08)', borderColor: 'rgba(184, 76, 48, 0.2)' },
  signOutText: { color: colors.terracotta },

  // Danger
  dangerOutlineButton: {
    alignSelf: 'stretch',
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
    backgroundColor: 'rgba(199,123,90,0.08)',
    alignItems: 'center',
  },
  dangerText: { fontFamily: fonts.regular, fontSize: 14, color: colors.error },
  dangerButton: { backgroundColor: colors.error },
  accountButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  accountText: { fontFamily: fonts.regular, fontSize: 14, color: colors.error },
  buttonDisabled: { opacity: 0.4 },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing['2xl'] },
  modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: dark.card,
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    color: dark.title,
  },
  modalCopy: { ...typography.body, fontSize: 14, lineHeight: 21, color: dark.sand },

  // Diagnostics
  diagCard: {
    backgroundColor: dark.card,
    borderRadius: radius['2xl'],
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(199, 123, 90, 0.35)',
  },
  diagLabel: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, letterSpacing: 1, color: dark.muted },
  diagText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: dark.sand },
  diagHint: { ...typography.caption, color: dark.muted, marginTop: spacing.xs },
});
