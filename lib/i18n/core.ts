import type { AppLanguage } from './languages';

/** A message whose wording depends on a count. `other` is required. */
export type Plural = {
  readonly __plural: true;
  one?: string;
  few?: string;
  many?: string;
  other: string;
};

export function plural(forms: Omit<Plural, '__plural'>): Plural {
  return { __plural: true, ...forms };
}

/** Same shape as the English messages, with every leaf widened. */
export type Messages<T> = {
  [K in keyof T]: T[K] extends Plural
    ? Plural
    : T[K] extends string
      ? string
      : Messages<T[K]>;
};

type Join<K extends string, P> = P extends string ? `${K}.${P}` : never;

export type StringKey<T> = {
  [K in keyof T & string]: T[K] extends Plural
    ? never
    : T[K] extends string
      ? K
      : Join<K, StringKey<T[K]>>;
}[keyof T & string];

export type PluralKey<T> = {
  [K in keyof T & string]: T[K] extends Plural
    ? K
    : T[K] extends string
      ? never
      : Join<K, PluralKey<T[K]>>;
}[keyof T & string];

export type Params = Record<string, string | number>;

type Category = 'one' | 'few' | 'many' | 'other';

// Hand-written CLDR rules for whole numbers; Hermes' Intl.PluralRules
// support varies by build.
export function pluralCategory(lang: AppLanguage, n: number): Category {
  const i = Math.abs(Math.trunc(n));
  switch (lang) {
    case 'en':
    case 'de':
    case 'es':
    case 'mr':
      return i === 1 ? 'one' : 'other';
    case 'hi':
      return i === 0 || i === 1 ? 'one' : 'other';
    case 'ru': {
      const d = i % 10;
      const h = i % 100;
      if (d === 1 && h !== 11) return 'one';
      if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'few';
      return 'many';
    }
    case 'zh':
    case 'ja':
      return 'other';
  }
}

export function lookup(messages: unknown, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function isPlural(value: unknown): value is Plural {
  return Boolean(value && typeof value === 'object' && (value as Plural).__plural);
}

export function pickPlural(lang: AppLanguage, forms: Plural, count: number): string {
  return forms[pluralCategory(lang, count)] ?? forms.other;
}
