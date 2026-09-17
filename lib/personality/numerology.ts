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

export const LIFE_PATH_THEMES: Record<number, string> = {
  1: 'the independent leader — driven, pioneering, sometimes needing to learn to lean on others',
  2: 'the harmonizer — sensitive, cooperative, often the peacekeeper in relationships',
  3: 'the expressive creative — communicative, joyful, sometimes scattered by too many ideas',
  4: 'the steady builder — practical, disciplined, sometimes rigid under pressure',
  5: 'the free spirit — adventurous, adaptable, sometimes restless or avoidant of commitment',
  6: 'the nurturer — responsible, caring, sometimes overextending for others at their own cost',
  7: 'the seeker — introspective, analytical, drawn to meaning beneath the surface',
  8: 'the achiever — ambitious, capable, sometimes equating worth with accomplishment',
  9: 'the humanitarian — compassionate, idealistic, sometimes carrying more than their share',
  11: 'the intuitive — highly sensitive, visionary, often feeling things more intensely than most',
  22: 'the master builder — capable of turning big dreams into real, lasting structures',
};

export function lifePathRevealCopy(lifePathNumber: number): string {
  const theme = LIFE_PATH_THEMES[lifePathNumber];
  if (!theme) {
    return 'We could not read a life path from this birth date. You can skip this and continue.';
  }
  return `Your Life Path Number is ${lifePathNumber} — ${theme}.`;
}
