import type { Dosha } from '../../lib/profile';

export type { Dosha } from '../../lib/profile';

export type DoshaPick = 'vata' | 'pitta' | 'kapha';

/** Varna disposition — Brahmana, Kshatriya, Vaishya, Shudra mentality. */
export type Varna = 'brahmana' | 'kshatriya' | 'vaishya' | 'shudra';

/**
 * Params accumulate as the user walks the flow: each screen forwards
 * everything it received plus its own contribution.
 *
 * Every field past `name` is optional because an admin can deactivate
 * any screen in onboarding_screen_config — if the Birth step is off,
 * nothing downstream ever sees a dob. ConfirmScreen fills the gaps
 * before saving. `name` stays required because saveMyProfile needs it,
 * which is why the Name screen is marked non-removable.
 */
export type PersonalDetails = {
  name: string;
  intention?: string;
  dob?: string | null;
  dobTime?: string | null;
  birthCity?: string;
  birthDistrict?: string;
  birthState?: string;
  birthCountry?: string;
  dosha?: Dosha;
  doshaScores?: Record<string, DoshaPick>;
};

export type OnboardingStackParamList = {
  Welcome: undefined;
  Name: undefined;
  Intention: PersonalDetails;
  Birth: PersonalDetails;
  BirthPlace: PersonalDetails;
  Dosha: PersonalDetails;
  Enneagram: PersonalDetails;
  Numerology: PersonalDetails;
  TCM: PersonalDetails;
  MBTI: PersonalDetails;
  Varna: PersonalDetails;
  AdminExtra: PersonalDetails;
  Confirm: PersonalDetails;
};
