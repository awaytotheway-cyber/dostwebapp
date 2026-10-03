import { t as translate } from './i18n';
import { supabase } from './supabase';

export const ENNEAGRAM_MODULE = 'enneagram';
export const NUMEROLOGY_MODULE = 'numerology';
export const TCM_MODULE = 'tcm';
export const MBTI_MODULE = 'mbti';

export const PERSONALITY_MODULE_ORDER = [
  ENNEAGRAM_MODULE,
  NUMEROLOGY_MODULE,
  TCM_MODULE,
  MBTI_MODULE,
] as const;

export type PersonalityModule = (typeof PERSONALITY_MODULE_ORDER)[number];

export const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

export type MbtiType = (typeof MBTI_TYPES)[number];

export function normalizeMbtiInput(value: string): string {
  return value.replace(/[^a-zA-Z]/g, '').toUpperCase();
}

export function isStandardMbtiType(value: string): boolean {
  return (MBTI_TYPES as readonly string[]).includes(normalizeMbtiInput(value));
}

export type TcmElement = 'Wood' | 'Fire' | 'Earth' | 'Metal' | 'Water';

export type EnneagramSource = 'quiz' | 'self_report';

export type PersonalityProfileWrite = { ok: true } | { ok: false; message: string };

type ModuleArrays = {
  completed_modules: string[];
  skipped_modules: string[];
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function uniqueModules(modules: string[]): string[] {
  return [...new Set(modules)];
}

async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

async function loadModuleArrays(userId: string): Promise<ModuleArrays> {
  const result = await supabase
    .from('personality_profile')
    .select('completed_modules, skipped_modules')
    .eq('user_id', userId)
    .maybeSingle();

  if (result.error || !result.data) {
    return { completed_modules: [], skipped_modules: [] };
  }

  return {
    completed_modules: asStringArray(result.data.completed_modules),
    skipped_modules: asStringArray(result.data.skipped_modules),
  };
}

function saveFailedMessage(): string {
  return translate('errors.personalitySaveFailed');
}

export async function saveEnneagramResult(
  type: number,
  source: EnneagramSource,
): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const completed_modules = uniqueModules([...existing.completed_modules, ENNEAGRAM_MODULE]);
  const skipped_modules = existing.skipped_modules.filter((module) => module !== ENNEAGRAM_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      enneagram_type: type,
      enneagram_source: source,
      completed_modules,
      skipped_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function skipEnneagramModule(): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const skipped_modules = uniqueModules([...existing.skipped_modules, ENNEAGRAM_MODULE]);
  const completed_modules = existing.completed_modules.filter((module) => module !== ENNEAGRAM_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      skipped_modules,
      completed_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function saveLifePathNumber(lifePathNumber: number): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const completed_modules = uniqueModules([...existing.completed_modules, NUMEROLOGY_MODULE]);
  const skipped_modules = existing.skipped_modules.filter((module) => module !== NUMEROLOGY_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      life_path_number: lifePathNumber,
      completed_modules,
      skipped_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function skipNumerologyModule(): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const skipped_modules = uniqueModules([...existing.skipped_modules, NUMEROLOGY_MODULE]);
  const completed_modules = existing.completed_modules.filter((module) => module !== NUMEROLOGY_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      skipped_modules,
      completed_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function saveTcmResult(input: {
  tcm_element: TcmElement;
  tcm_emotional_state: string;
  tcm_climate_preference: string;
}): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const completed_modules = uniqueModules([...existing.completed_modules, TCM_MODULE]);
  const skipped_modules = existing.skipped_modules.filter((module) => module !== TCM_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      tcm_element: input.tcm_element,
      tcm_emotional_state: input.tcm_emotional_state,
      tcm_climate_preference: input.tcm_climate_preference,
      completed_modules,
      skipped_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function skipTcmModule(): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const skipped_modules = uniqueModules([...existing.skipped_modules, TCM_MODULE]);
  const completed_modules = existing.completed_modules.filter((module) => module !== TCM_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      skipped_modules,
      completed_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function saveMbtiType(mbtiType: string): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const completed_modules = uniqueModules([...existing.completed_modules, MBTI_MODULE]);
  const skipped_modules = existing.skipped_modules.filter((module) => module !== MBTI_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      mbti_type: mbtiType,
      completed_modules,
      skipped_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export async function skipMbtiModule(): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const existing = await loadModuleArrays(userId);
  const skipped_modules = uniqueModules([...existing.skipped_modules, MBTI_MODULE]);
  const completed_modules = existing.completed_modules.filter((module) => module !== MBTI_MODULE);

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      skipped_modules,
      completed_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}

export type PersonalityProfileRow = {
  user_id: string;
  dosha_body: string | null;
  dosha_mind: string | null;
  enneagram_type: number | null;
  enneagram_source: EnneagramSource | null;
  life_path_number: number | null;
  tcm_element: TcmElement | null;
  tcm_emotional_state: string | null;
  tcm_climate_preference: string | null;
  mbti_type: string | null;
  completed_modules: string[];
  skipped_modules: string[];
};

export type PersonalityProfileLoad =
  | { ok: true; profile: PersonalityProfileRow | null }
  | { ok: false; message: string };

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asEnneagramType(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}

function asEnneagramSource(value: unknown): EnneagramSource | null {
  return value === 'quiz' || value === 'self_report' ? value : null;
}

function asLifePath(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
}

function asTcmElement(value: unknown): TcmElement | null {
  return value === 'Wood' ||
    value === 'Fire' ||
    value === 'Earth' ||
    value === 'Metal' ||
    value === 'Water'
    ? value
    : null;
}

function mapPersonalityProfile(data: Record<string, unknown>): PersonalityProfileRow | null {
  const userId = typeof data.user_id === 'string' ? data.user_id : null;
  if (!userId) return null;
  return {
    user_id: userId,
    dosha_body: asNullableString(data.dosha_body),
    dosha_mind: asNullableString(data.dosha_mind),
    enneagram_type: asEnneagramType(data.enneagram_type),
    enneagram_source: asEnneagramSource(data.enneagram_source),
    life_path_number: asLifePath(data.life_path_number),
    tcm_element: asTcmElement(data.tcm_element),
    tcm_emotional_state: asNullableString(data.tcm_emotional_state),
    tcm_climate_preference: asNullableString(data.tcm_climate_preference),
    mbti_type: asNullableString(data.mbti_type),
    completed_modules: asStringArray(data.completed_modules),
    skipped_modules: asStringArray(data.skipped_modules),
  };
}

export function isStandalonePersonalityEdit(params: unknown): boolean {
  return Boolean(
    params &&
      typeof params === 'object' &&
      'standalone' in params &&
      (params as { standalone?: boolean }).standalone === true,
  );
}

export function moduleIsComplete(profile: PersonalityProfileRow | null, module: string): boolean {
  if (!profile) return false;
  if (profile.completed_modules.includes(module)) return true;
  if (module === ENNEAGRAM_MODULE) return profile.enneagram_type != null;
  if (module === NUMEROLOGY_MODULE) return profile.life_path_number != null;
  if (module === TCM_MODULE) return profile.tcm_element != null;
  if (module === MBTI_MODULE) return profile.mbti_type != null;
  if (module === 'dosha') return Boolean(profile.dosha_body || profile.dosha_mind);
  return false;
}

export function moduleIsSkipped(profile: PersonalityProfileRow | null, module: string): boolean {
  if (!profile) return false;
  return profile.skipped_modules.includes(module) && !moduleIsComplete(profile, module);
}

export async function loadPersonalityProfile(): Promise<PersonalityProfileLoad> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const result = await supabase.from('personality_profile').select('*').eq('user_id', userId).maybeSingle();
  if (result.error) {
    return {
      ok: false,
      message: translate('errors.personalityLoadFailed'),
    };
  }
  if (!result.data) {
    return { ok: true, profile: null };
  }
  return { ok: true, profile: mapPersonalityProfile(result.data as Record<string, unknown>) };
}

export async function skipRemainingPersonalityModules(
  fromModule: PersonalityModule,
): Promise<PersonalityProfileWrite> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const fromIndex = PERSONALITY_MODULE_ORDER.indexOf(fromModule);
  const remaining = fromIndex < 0 ? [] : PERSONALITY_MODULE_ORDER.slice(fromIndex);
  const existing = await loadModuleArrays(userId);
  const toSkip = remaining.filter((module) => !existing.completed_modules.includes(module));
  const skipped_modules = uniqueModules([...existing.skipped_modules, ...toSkip]);
  const completed_modules = existing.completed_modules.filter(
    (module) => !toSkip.includes(module as PersonalityModule),
  );

  const { error } = await supabase.from('personality_profile').upsert(
    {
      user_id: userId,
      skipped_modules,
      completed_modules,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, message: saveFailedMessage() };
  }
  return { ok: true };
}
