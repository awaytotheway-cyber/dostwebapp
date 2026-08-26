import AsyncStorage from '@react-native-async-storage/async-storage';
import { birthPlaceForDb, type BirthPlace } from './birthPlace';
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
  dob: string;
  dobTime: string | null;
  birthCity: string;
  birthDistrict: string;
  birthState: string;
  birthCountry: string;
  dosha: Dosha;
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

export async function loadMyProfile(): Promise<ProfileLoad> {
  const first = await supabase.from('profiles').select(PROFILE_SELECT).maybeSingle();
  const result = first.error
    ? await supabase.from('profiles').select(PROFILE_SELECT_LEGACY).maybeSingle()
    : first;

  if (result.error) return { ok: false };
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
    return { ok: false, message: "Couldn't verify your session. Close the app and open it again." };
  }

  const trimmedName = name.trim().slice(0, 40);
  if (!trimmedName) {
    return { ok: false, message: 'Please enter a name.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      name: trimmedName,
      intention: intention.trim().slice(0, 200),
    })
    .eq('id', userId);

  if (error) {
    return { ok: false, message: 'Could not save your profile. Please try again.' };
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
    return { ok: false, message: "Couldn't verify your session. Close the app and open it again." };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ dosha, dosha_scores: doshaScores })
    .eq('id', userId);

  if (error) {
    return { ok: false, message: 'Could not save your dosha. Please try again.' };
  }
  return { ok: true };
}

export async function updateMyBirthPlace(place: BirthPlace): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: "Couldn't verify your session. Close the app and open it again." };
  }

  const { error } = await supabase
    .from('profiles')
    .update(birthPlaceForDb(place))
    .eq('id', userId);

  if (error) {
    return {
      ok: false,
      message:
        'Could not save place of birth. If this keeps happening, run the place-of-birth SQL in Supabase, then try again.',
    };
  }
  return { ok: true };
}

export async function saveMyProfile(input: ProfileInput): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: "Couldn't verify your session. Close the app and open it again." };
  }

  const name = input.name.trim().slice(0, 40);
  if (!name) {
    return { ok: false, message: 'Please enter a name.' };
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
    return { ok: false, message: 'Could not save your profile. Please try again.' };
  }

  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  return { ok: true };
}

export async function clearProfileAndSignOut(): Promise<ProfileWrite> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: "Couldn't verify your session. Close the app and open it again." };
  }

  await supabase.from('messages').delete().eq('user_id', userId);

  const { error } = await supabase.from('profiles').delete().eq('id', userId);
  if (error) {
    return { ok: false, message: 'Could not delete your profile. Please try again.' };
  }

  await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  await supabase.auth.signOut();
  return { ok: true };
}
