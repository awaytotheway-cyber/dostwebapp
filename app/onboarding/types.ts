import type { Dosha } from '../../lib/profile';

export type { Dosha } from '../../lib/profile';

export type DoshaPick = 'vata' | 'pitta' | 'kapha';

/** Varna disposition — Brahmana, Kshatriya, Vaishya, Shudra mentality. */
export type Varna = 'brahmana' | 'kshatriya' | 'vaishya' | 'shudra';

type PersonalDetails = {
  name: string;
  intention: string;
  dob: string;
  dobTime: string | null;
  birthCity: string;
  birthDistrict: string;
  birthState: string;
  birthCountry: string;
  dosha: Dosha;
  doshaScores: Record<string, DoshaPick>;
};

export type OnboardingStackParamList = {
  Welcome: undefined;
  Name: undefined;
  Intention: { name: string };
  Birth: { name: string; intention: string };
  BirthPlace: {
    name: string;
    intention: string;
    dob: string;
    dobTime: string | null;
  };
  Dosha: {
    name: string;
    intention: string;
    dob: string;
    dobTime: string | null;
    birthCity: string;
    birthDistrict: string;
    birthState: string;
    birthCountry: string;
  };
  Enneagram: PersonalDetails;
  Numerology: PersonalDetails;
  TCM: PersonalDetails;
  MBTI: PersonalDetails;
  Varna: PersonalDetails;
  Confirm: PersonalDetails;
};
