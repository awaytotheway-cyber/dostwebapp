import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  interpolate,
  isPlural,
  lookup,
  pickPlural,
  type Messages,
  type Params,
  type Plural,
  type PluralKey,
  type StringKey,
} from './core';
import {
  isAppLanguage,
  LOCALE_TAGS,
  type AppLanguage,
} from './languages';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { hi } from './locales/hi';
import { ja } from './locales/ja';
import { mr } from './locales/mr';
import { ru } from './locales/ru';
import { zh } from './locales/zh';

export * from './languages';

type EnMessages = typeof en;
export type TKey = StringKey<EnMessages>;
export type TPluralKey = PluralKey<EnMessages>;

const MESSAGES: Record<AppLanguage, Messages<EnMessages>> = { en, hi, mr, es, de, ru, zh, ja };

const STORAGE_KEY = 'dost.app.language.v1';

let current: AppLanguage = 'en';
const listeners = new Set<(lang: AppLanguage) => void>();

/**
 * Admin-authored text overrides, keyed by the same dotted i18n path.
 * Set once from onboarding_text at app start. An override wins over the
 * catalog for every language — the admin edits one string and it shows
 * everywhere, which is the simple behaviour we want for now.
 */
let overrides: Record<string, string> = {};

export function setTextOverrides(next: Record<string, string>): void {
  overrides = next;
  for (const listener of listeners) listener(current);
}

export function getTextOverride(key: string): string | undefined {
  return overrides[key];
}

function translate(lang: AppLanguage, key: string, params?: Params): string {
  const override = overrides[key];
  if (typeof override === 'string') return interpolate(override, params);
  const msg = lookup(MESSAGES[lang], key);
  const text = typeof msg === 'string' ? msg : lookup(en, key);
  return interpolate(typeof text === 'string' ? text : key, params);
}

function translatePlural(
  lang: AppLanguage,
  key: string,
  count: number,
  params?: Params,
): string {
  const msg = lookup(MESSAGES[lang], key);
  const forms = isPlural(msg) ? msg : (lookup(en, key) as Plural);
  return interpolate(pickPlural(lang, forms, count), { count, ...params });
}

/** Current language for code outside React (notifications, API calls). */
export function getAppLanguage(): AppLanguage {
  return current;
}

export function getLocaleTag(): string {
  return LOCALE_TAGS[current];
}

export function t(key: TKey, params?: Params): string {
  return translate(current, key, params);
}

export function tn(key: TPluralKey, count: number, params?: Params): string {
  return translatePlural(current, key, count, params);
}

/** True when an (often data-derived) key exists in the message files. */
export function hasMessage(key: string): boolean {
  return typeof lookup(en, key) === 'string';
}

function deviceLanguage(): AppLanguage {
  try {
    for (const locale of getLocales()) {
      if (isAppLanguage(locale.languageCode)) return locale.languageCode;
    }
  } catch {
    // fall through to English
  }
  return 'en';
}

/** Resolve the saved language (or the phone's) before the first render. */
export async function initI18n(): Promise<AppLanguage> {
  let lang = deviceLanguage();
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isAppLanguage(saved)) lang = saved;
  } catch {
    // keep the device language
  }
  current = lang;
  return lang;
}

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  current = lang;
  for (const listener of listeners) listener(lang);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // the choice still applies for this run
  }
}

const I18nContext = createContext<AppLanguage>('en');

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<AppLanguage>(current);
  useEffect(() => {
    listeners.add(setLang);
    setLang(current);
    return () => {
      listeners.delete(setLang);
    };
  }, []);
  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const lang = useContext(I18nContext);
  return useMemo(
    () => ({
      lang,
      locale: LOCALE_TAGS[lang],
      t: (key: TKey, params?: Params) => translate(lang, key, params),
      tn: (key: TPluralKey, count: number, params?: Params) =>
        translatePlural(lang, key, count, params),
      setLanguage: setAppLanguage,
    }),
    [lang],
  );
}
