import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from './chatTypes';
import { useI18n } from '../lib/i18n';
import { saveDailyIntentions } from '../lib/intentions';
import {
  requestNotificationPermission,
  scheduleMorningNoticings,
} from '../lib/notifications';
import { colors, radius, spacing, type } from '../lib/theme';
import GentlePressable from './GentlePressable';

type Props = NativeStackScreenProps<ChatStackParamList, 'Reflection'>;

export default function ReflectionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const mode = route.params?.mode === 'noticings' ? 'noticings' : 'prompt';
  const [one, setOne] = useState('');
  const [two, setTwo] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => Boolean(one.trim() && two.trim()) && !saving, [one, two, saving]);

  const onYes = () => {
    navigation.navigate('Chat', { reflectionOpening: true });
  };

  const onNotTonight = () => {
    navigation.navigate('Chat');
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await saveDailyIntentions(one, two);
      if (!saved.ok) {
        Alert.alert(t('common.couldNotSave'), saved.message);
        return;
      }

      const allowed = await requestNotificationPermission();
      if (allowed) {
        await scheduleMorningNoticings(saved.intentions, saved.forDate);
      }

      Alert.alert(
        t('common.saved'),
        allowed ? t('reflection.savedMorning') : t('reflection.savedNoNotifications'),
      );
      navigation.navigate('Chat');
    } catch {
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.flex}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}
            onPress={() => navigation.goBack()}
            hitSlop={spacing.sm}
            style={({ pressed }) => pressed && styles.controlPressed}
          >
            <Text style={styles.back}>
              {t('reflection.back')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('reflection.notTonight')}
            onPress={onNotTonight}
            hitSlop={spacing.sm}
            style={({ pressed }) => pressed && styles.controlPressed}
          >
            <Text style={styles.notTonight}>{t('reflection.notTonight')}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            mode === 'prompt' ? styles.promptContent : styles.noticingsContent,
            { paddingBottom: insets.bottom + spacing['2xl'] },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mode === 'prompt' ? (
            <>
              <View style={styles.promptBlock}>
                <Text style={styles.eyebrow}>{t('reflection.eyebrow')}</Text>
                <Text style={styles.prompt}>{t('reflection.prompt')}</Text>
                <View style={styles.promptRule} />
                <Text style={styles.promptNote}>{t('reflection.promptNote')}</Text>
              </View>

              <View style={styles.actions}>
                <GentlePressable
                  accessibilityRole="button"
                  onPress={onYes}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.controlPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>{t('reflection.yes')}</Text>
                </GentlePressable>
                <GentlePressable
                  accessibilityRole="button"
                  onPress={onNotTonight}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.controlPressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>{t('reflection.notTonight')}</Text>
                </GentlePressable>
              </View>
            </>
          ) : (
            <View>
              <Text style={styles.eyebrow}>{t('reflection.forTomorrow')}</Text>
              <Text style={styles.heading}>{t('reflection.heading')}</Text>
              <Text style={styles.copy}>{t('reflection.copy')}</Text>

              <View style={styles.noticingList}>
                <View style={styles.noticingCard}>
                  <View style={styles.noticingMark}>
                    <Text style={styles.noticingNumber}>01</Text>
                    <View style={styles.noticingRule} />
                  </View>
                  <View style={styles.noticingField}>
                    <Text style={styles.inputLabel}>{t('reflection.firstLabel')}</Text>
                    <TextInput
                      style={styles.input}
                      value={one}
                      onChangeText={(value) => setOne(value.slice(0, 120))}
                      placeholder={t('reflection.firstPlaceholder')}
                      placeholderTextColor={colors.clay}
                      maxLength={120}
                      editable={!saving}
                      autoCapitalize="sentences"
                      underlineColorAndroid="transparent"
                    />
                  </View>
                </View>

                <View style={styles.noticingCard}>
                  <View style={styles.noticingMark}>
                    <Text style={styles.noticingNumber}>02</Text>
                    <View style={styles.noticingRule} />
                  </View>
                  <View style={styles.noticingField}>
                    <Text style={styles.inputLabel}>{t('reflection.secondLabel')}</Text>
                    <TextInput
                      style={styles.input}
                      value={two}
                      onChangeText={(value) => setTwo(value.slice(0, 120))}
                      placeholder={t('reflection.secondPlaceholder')}
                      placeholderTextColor={colors.clay}
                      maxLength={120}
                      editable={!saving}
                      autoCapitalize="sentences"
                      underlineColorAndroid="transparent"
                    />
                  </View>
                </View>
              </View>

              <GentlePressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                onPress={() => void onSave()}
                disabled={!canSave}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.saveButton,
                  !canSave && styles.buttonDisabled,
                  pressed && canSave && styles.controlPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? t('common.saving') : t('common.save')}
                </Text>
              </GentlePressable>
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.parchment,
  },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  back: {
    ...type.label,
    color: colors.inkMuted,
    paddingVertical: spacing.sm,
  },
  notTonight: {
    ...type.label,
    color: colors.inkLight,
    paddingVertical: spacing.sm,
  },
  topBarRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.parchmentDivider,
    marginTop: spacing.sm,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
  },
  promptContent: {
    justifyContent: 'space-between',
    paddingTop: spacing['5xl'],
  },
  noticingsContent: {
    justifyContent: 'center',
    paddingTop: spacing['3xl'],
  },
  promptBlock: {
    maxWidth: 420,
    paddingTop: spacing.lg,
  },
  eyebrow: {
    ...type.label,
    color: colors.inkMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xl,
  },
  prompt: {
    ...type.reflectivePrompt,
    color: colors.inkDark,
    fontSize: 28,
    lineHeight: 40,
    maxWidth: 340,
  },
  promptRule: {
    width: spacing['5xl'],
    height: 1,
    backgroundColor: colors.parchmentBorder,
    marginTop: spacing['3xl'],
    marginBottom: spacing.lg,
  },
  promptNote: {
    ...type.body,
    color: colors.inkMuted,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: spacing.md,
    paddingTop: spacing['5xl'],
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radius.cta,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.terracotta,
  },
  primaryButtonText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    lineHeight: 22,
    color: colors.onTerracotta,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.full,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.inkMuted,
  },
  controlPressed: {
    opacity: 0.68,
  },
  heading: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 32,
    lineHeight: 38,
    color: colors.inkDark,
    maxWidth: 360,
    marginBottom: spacing.md,
  },
  copy: {
    ...type.body,
    color: colors.inkMuted,
    maxWidth: 360,
  },
  noticingList: {
    gap: spacing.lg,
    marginTop: spacing['3xl'],
  },
  noticingCard: {
    minHeight: 72,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: colors.parchmentBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: 0,
  },
  noticingMark: {
    width: spacing['4xl'],
    marginRight: spacing.md,
    alignItems: 'flex-start',
    paddingTop: 2,
  },
  noticingNumber: {
    ...type.caption,
    fontFamily: type.label.fontFamily,
    color: colors.inkLight,
    letterSpacing: 1,
  },
  noticingRule: {
    width: spacing.xl,
    height: 1,
    backgroundColor: colors.parchmentBorder,
    marginTop: spacing.sm,
  },
  noticingField: {
    flex: 1,
    justifyContent: 'center',
  },
  inputLabel: {
    ...type.caption,
    color: colors.inkLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  input: {
    ...type.body,
    color: colors.inkDark,
    paddingHorizontal: spacing.none,
    paddingVertical: spacing.sm,
  },
  saveButton: {
    marginTop: spacing['3xl'],
  },
  buttonDisabled: {
    opacity: 0.42,
  },
});
