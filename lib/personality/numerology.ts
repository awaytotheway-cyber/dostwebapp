import { t, type TKey } from '../i18n';

export function calculateLifePathNumber(birthDateISO: string): number {
  // birthDateISO format: "YYYY-MM-DD"
  const digits = birthDateISO.replace(/[^0-9]/g, '').split('').map(Number);
  let sum = digits.reduce((a, b) => a + b, 0);

  // Reduce to single digit, except master numbers 11 and 22
  while (sum > 9 && sum !== 11 && sum !== 22) {
    sum = sum.toString().split('').map(Number).reduce((a, b) => a + b, 0);
  }
  return sum;
}

export const LIFE_PATH_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22];

export function lifePathRevealCopy(lifePathNumber: number): string {
  if (!LIFE_PATH_NUMBERS.includes(lifePathNumber)) {
    return t('numerology.unreadable');
  }
  return t('numerology.reveal', {
    number: lifePathNumber,
    theme: t(`numerology.themes.${lifePathNumber}` as TKey),
  });
}
