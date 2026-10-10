import AsyncStorage from '@react-native-async-storage/async-storage';
import { birthPlaceForDb, type BirthPlace } from './birthPlace';
import { t as translate } from './i18n';
import { supabase } from './supabase';
import { ONBOARDING_COMPLETE_KEY } from './onboardingStorage';

export type Dosha = 'vata' | 'pitta' | 'kapha' | 'mixed';

const PROFILE_SELECT =
  'id, name, intention, dob, dob_time, dosha, dosha_scores, birth_city, birth_district, birth_state, birth_country';
const PROFILE_SELECT_LEGACY = 'id, name, intention, dob, dob_time, dosha, dosha_scores';

export type ProfileRow = {
  id: string;
  name: string | null;
  intention: string | null;
  dob: string | null;
  dob_time: string | null;
  dosha: Dosha | null;
  dosha_scores: unknown;
  birth_city: string | null;
  birth_district: string | null;
  birth_state: string | null;
  birth_country: string | null;
};

export type ProfileLoad =
  | { ok: true; profile: ProfileRow | null }
  | { ok: false };

export type ProfileWrite = { ok: true } | { ok: false; message: string };

export type ProfileInput = {
  name: string;
  intention: string;
  /** Null when the admin has switched the Birth step off. */
  dob: string | null;
  dobTime: string | null;
  birthCity: string;
  birthDistrict: string;
  birthState: string;
  birthCountry: string;
  /** Null when the admin has switched the Dosha step off. */
  dosha: Dosha | null;
  doshaScores: Record<string, 'vata' | 'pitta' | 'kapha'>;
};

function asDosha(value: unknown): Dosha | null {
  return value === 'vata' || value === 'pitta' || value === 'kapha' || value === 'mixed'
    ? value
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mapProfile(data: Record<string, unknown>): ProfileRow | null {
  const id = typeof data.id === 'string' ? data.id : '';
  if (!id) return null;
  return {
    id,
    name: asText(data.name),
    intention: asText(data.intention),
    dob: asText(data.dob),
    dob_time: asText(data.dob_time),
    dosha: asDosha(data.dosha),
    dosha_scores: data.dosha_scores,
    birth_city: asText(data.birth_city),
    birth_district: asText(data.birth_district),
    birth_state: asText(data.birth_state),
    birth_country: asText(data.birth_country),
  };
}

const PROFILE_LOAD_TIMEOUT_MS = 8000;

export async function loadMyProfile(): Promise<ProfileLoad> {
  const request = supabase.from('profiles').select(PROFILE_SELECT).maybeSingle();
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PROFILE_LOAD_TIMEOUT_MS),
  );
  const first = await Promise.race([request, timeout]);
  if (!first) return { ok: false };

  const result = first.error
    ? await Promise.race([
        supabase.from('profiles').select(PROFILE_SELECT_LEGACY).maybeSingle(),
        timeout,
      ])
    : first;

  if (!result || result.error) return { ok: false };
  if (!result.data || typeof result.data !== 'object') return { ok: true, profile: null };

  const profile = mapProfile(result.data as Record<string, unknown>);
  return { ok: true, profile };
}

export async function updateMyNameAndIntention(
  name: string,
  intention: string,
): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const trimmedName = name.trim().slice(0, 40);
  if (!trimmedName) {
    return { ok: false, message: translate('errors.enterName') };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      name: trimmedName,
      intention: intention.trim().slice(0, 200),
    })
    .eq('id', userId);

  if (error) {
    return { ok: false, message: translate('errors.profileSaveFailed') };
  }
  return { ok: true };
}

export async function updateMyDosha(
  dosha: Dosha,
  doshaScores: Record<string, 'vata' | 'pitta' | 'kapha'>,
): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ dosha, dosha_scores: doshaScores })
    .eq('id', userId);

  if (error) {
    return { ok: false, message: translate('errors.doshaSaveFailed') };
  }
  return { ok: true };
}

export async function updateMyBirthPlace(place: BirthPlace): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const { error } = await supabase
    .from('profiles')
    .update(birthPlaceForDb(place))
    .eq('id', userId);

  if (error) {
    return {
      ok: false,
      message: translate('errors.birthPlaceSaveFailed'),
    };
  }
  return { ok: true };
}

export async function saveMyProfile(input: ProfileInput): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const name = input.name.trim().slice(0, 40);
  if (!name) {
    return { ok: false, message: translate('errors.enterName') };
  }

  const core = {
    id: userId,
    name,
    intention: input.intention.trim().slice(0, 200),
    dob: input.dob,
    dob_time: input.dobTime,
    dosha: input.dosha,
    dosha_scores: input.doshaScores,
  };

  const withPlace = {
    ...core,
    ...birthPlaceForDb({
      birthCity: input.birthCity,
      birthDistrict: input.birthDistrict,
      birthState: input.birthState,
      birthCountry: input.birthCountry,
    }),
  };

  const first = await supabase.from('profiles').upsert(withPlace);
  const result = first.error ? await supabase.from('profiles').upsert(core) : first;

  if (result.error) {
    return { ok: false, message: translate('errors.profileSaveFailed') };
  }

  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  return { ok: true };
}

export async function clearProfileAndSignOut(): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  await supabase.from('messages').delete().eq('user_id', userId);

  const { error } = await supabase.from('profiles').delete().eq('id', userId);
  if (error) {
    return { ok: false, message: translate('errors.profileDeleteFailed') };
  }

  await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  await supabase.auth.signOut();
  return { ok: true };
}
