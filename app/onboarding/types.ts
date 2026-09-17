import type {
  DailyRhythm,
  Dosha,
  Hobby,
  SocialStyle,
} from '../../lib/profile';

export type { DailyRhythm, Hobby, SocialStyle } from '../../lib/profile';

export type DoshaPick = 'vata' | 'pitta' | 'kapha';

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
  Rhythm: PersonalDetails;
  Hobbies: PersonalDetails & { dailyRhythm: DailyRhythm };
  SocialEnergy: PersonalDetails & { dailyRhythm: DailyRhythm; hobbies: Hobby[] };
  Confirm: PersonalDetails & {
    dailyRhythm: DailyRhythm;
    hobbies: Hobby[];
    socialStyle: SocialStyle;
  };
};
