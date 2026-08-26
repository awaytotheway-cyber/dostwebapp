import type { Dosha } from '../../lib/profile';

export type DoshaPick = 'vata' | 'pitta' | 'kapha';

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
  Confirm: {
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
};
