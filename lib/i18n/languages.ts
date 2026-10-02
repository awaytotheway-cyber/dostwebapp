export const APP_LANGUAGES = ['en', 'hi', 'mr', 'es', 'de', 'ru', 'zh', 'ja'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Each language's name written in that language, for the picker. */
export const NATIVE_LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  mr: 'मराठी',
  es: 'Español',
  de: 'Deutsch',
  ru: 'Русский',
  zh: '中文（简体）',
  ja: '日本語',
};

/** English names, used when telling the AI which language to reply in. */
export const ENGLISH_LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  es: 'Spanish',
  de: 'German',
  ru: 'Russian',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
};

/** BCP 47 tags for Intl date/number formatting. */
export const LOCALE_TAGS: Record<AppLanguage, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
  es: 'es-ES',
  de: 'de-DE',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}
