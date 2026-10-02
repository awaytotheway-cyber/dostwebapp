import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COUNTRIES,
  DEFAULT_COUNTRY_NAME,
  type Country,
} from '../lib/countries';
import { useI18n } from '../lib/i18n';
import { colors, radius, spacing, type } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

type Props = {
  value: string;
  onChange: (country: string) => void;
  disabled?: boolean;
  appearance?: 'settings' | 'onboarding';
};

type CountryChoice = Country & {
  label: string;
  isLegacy?: boolean;
};

// Localised region names when the JS engine supports Intl.DisplayNames;
// the stored value is always the English name.
function regionNamer(locale: string): (code: string) => string | undefined {
  try {
    const DisplayNames = (Intl as unknown as { DisplayNames?: new (
      locales: string[],
      options: { type: 'region' },
    ) => { of: (code: string) => string | undefined } }).DisplayNames;
    if (typeof DisplayNames !== 'function') return () => undefined;
    const names = new DisplayNames([locale], { type: 'region' });
    return (code) => {
      try {
        return names.of(code);
      } catch {
        return undefined;
      }
    };
  } catch {
    return () => undefined;
  }
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en');
}

export default function CountryPicker({
  value,
  onChange,
  disabled,
  appearance = 'settings',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t, tn, lang, locale } = useI18n();
  const selectedValue = value.trim() ? value : DEFAULT_COUNTRY_NAME;

  const choices = useMemo<CountryChoice[]>(() => {
    const localName = lang === 'en' ? () => undefined : regionNamer(locale);
    const options: CountryChoice[] = COUNTRIES.map((country) => ({
      ...country,
      label: localName(country.code) ?? country.name,
    }));
    if (!COUNTRIES.some((country) => country.name === selectedValue)) {
      options.push({ code: '', name: selectedValue, label: selectedValue, isLegacy: true });
    }
    if (lang !== 'en' || options.some((option) => option.isLegacy)) {
      options.sort((a, b) => a.label.localeCompare(b.label, locale, { sensitivity: 'base' }));
    }
    return options;
  }, [selectedValue, lang, locale]);

  const selectedLabel =
    choices.find((country) => country.name === selectedValue)?.label ?? selectedValue;

  const filteredChoices = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return choices;
    return choices.filter(
      (country) =>
        normalizeSearch(country.label).includes(normalizedQuery) ||
        normalizeSearch(country.name).includes(normalizedQuery) ||
        country.code.toLocaleLowerCase('en').includes(normalizedQuery),
    );
  }, [choices, query]);

  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
  };

  const show = () => {
    setQuery('');
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={show}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          appearance === 'onboarding' && styles.buttonOnboarding,
          pressed && styles.buttonPressed,
          disabled && styles.disabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('countryPicker.buttonA11y', { name: selectedLabel })}
        accessibilityHint={t('countryPicker.buttonHint')}
        accessibilityState={{ disabled }}
      >
        <Text style={styles.buttonText}>{selectedLabel}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
          <KeyboardAvoidingView
            style={styles.keyboardArea}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            pointerEvents="box-none"
          >
            <View
              style={[
                styles.sheet,
                {
                  maxHeight: Math.min(height * 0.86, 680),
                  paddingBottom: Math.max(insets.bottom, spacing.lg),
                },
              ]}
              accessibilityViewIsModal
            >
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {t('countryPicker.title')}
                  </Text>
                  <Text style={styles.subtitle}>{t('countryPicker.subtitle')}</Text>
                </View>
                <Pressable
                  onPress={close}
                  hitSlop={spacing.sm}
                  accessibilityRole="button"
                  accessibilityLabel={t('countryPicker.closeA11y')}
                  style={({ pressed }) => [styles.close, pressed && styles.controlPressed]}
                >
                  <Text style={styles.closeText}>{t('countryPicker.close')}</Text>
                </Pressable>
              </View>

              <View style={styles.searchFrame}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('countryPicker.searchPlaceholder')}
                  placeholderTextColor={colors.clay}
                  selectionColor={colors.gold}
                  cursorColor={colors.gold}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel={t('countryPicker.searchA11y')}
                  style={styles.searchInput}
                  underlineColorAndroid="transparent"
                />
                {query ? (
                  <Pressable
                    onPress={() => setQuery('')}
                    hitSlop={spacing.xs}
                    accessibilityRole="button"
                    accessibilityLabel={t('countryPicker.clearA11y')}
                    style={({ pressed }) => [
                      styles.clearSearch,
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <Text style={styles.clearSearchText}>{t('countryPicker.clear')}</Text>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.resultCount} accessibilityLiveRegion="polite">
                {tn('countryPicker.results', filteredChoices.length)}
              </Text>

              <FlatList
                data={filteredChoices}
                style={styles.list}
                keyExtractor={(country) =>
                  country.code || `saved-country-${country.name}`
                }
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator
                initialNumToRender={18}
                windowSize={7}
                ListEmptyComponent={
                  <Text style={styles.empty}>{t('countryPicker.empty')}</Text>
                }
                renderItem={({ item }) => {
                  const selected = item.name === selectedValue;
                  return (
                    <Pressable
                      onPress={() => {
                        onChange(item.name);
                        close();
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        pressed && styles.optionPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          selected && styles.optionTextSelected,
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text
                        style={[
                          styles.optionMeta,
                          selected && styles.optionMetaSelected,
                        ]}
                      >
                        {selected
                          ? t('countryPicker.selected')
                          : item.isLegacy
                            ? t('countryPicker.saved')
                            : item.code}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  buttonOnboarding: {
    paddingVertical: spacing.lg,
  },
  buttonPressed: {
    borderColor: colors.goldSoft,
    backgroundColor: colors.surfaceRaised,
  },
  disabled: { opacity: 0.4 },
  buttonText: { ...type.body, color: colors.cream },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  keyboardArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.divider,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    paddingRight: spacing.md,
  },
  title: {
    ...type.heading,
    fontSize: 22,
    lineHeight: 29,
    color: colors.cream,
  },
  subtitle: {
    ...type.caption,
    color: colors.sand,
    marginTop: spacing.xs,
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  closeText: {
    ...type.label,
    color: colors.gold,
    fontSize: 14,
  },
  controlPressed: {
    backgroundColor: colors.goldWash,
  },
  searchFrame: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.goldSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingLeft: spacing.lg,
  },
  searchInput: {
    flex: 1,
    minHeight: 50,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    ...type.body,
    color: colors.cream,
  },
  clearSearch: {
    minWidth: 52,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  clearSearchText: {
    ...type.label,
    color: colors.gold,
  },
  resultCount: {
    ...type.caption,
    color: colors.sand,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
  },
  optionSelected: {
    backgroundColor: colors.goldWashStrong,
  },
  optionPressed: {
    backgroundColor: colors.surface,
  },
  optionText: {
    ...type.body,
    flex: 1,
    color: colors.cream,
    paddingRight: spacing.md,
  },
  optionTextSelected: {
    color: colors.gold,
  },
  optionMeta: {
    ...type.caption,
    color: colors.clay,
    textAlign: 'right',
  },
  optionMetaSelected: {
    color: colors.gold,
  },
  empty: {
    ...type.body,
    color: colors.sand,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['3xl'],
  },
});
