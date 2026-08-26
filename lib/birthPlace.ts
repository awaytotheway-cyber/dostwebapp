export type BirthPlace = {
  birthCity: string;
  birthDistrict: string;
  birthState: string;
  birthCountry: string;
};

export const DEFAULT_BIRTH_COUNTRY = 'India';

export const COUNTRIES = [
  'India',
  'Nepal',
  'Bangladesh',
  'Sri Lanka',
  'Pakistan',
  'United Arab Emirates',
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Singapore',
  'Other',
] as const;

const FIELD_MAX = 80;

export function emptyBirthPlace(): BirthPlace {
  return {
    birthCity: '',
    birthDistrict: '',
    birthState: '',
    birthCountry: DEFAULT_BIRTH_COUNTRY,
  };
}

export function sanitizeBirthField(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, FIELD_MAX);
}

export function birthPlaceForDb(place: BirthPlace): {
  birth_city: string | null;
  birth_district: string | null;
  birth_state: string | null;
  birth_country: string | null;
} {
  return {
    birth_city: sanitizeBirthField(place.birthCity),
    birth_district: sanitizeBirthField(place.birthDistrict),
    birth_state: sanitizeBirthField(place.birthState),
    birth_country: sanitizeBirthField(place.birthCountry) ?? DEFAULT_BIRTH_COUNTRY,
  };
}
