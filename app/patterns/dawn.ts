import type { Tone } from '../../lib/patterns/dayStrip';

/** Dark home-family surface — matches Home / Past Reflections Dawn Earth. */
export const dawn = {
  base: '#1A1614',
  card: '#241E1B',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  gold: '#D9A857',
  clay: '#B8A090',
  border: 'rgba(201, 183, 156, 0.22)',
  segmentIdle: 'rgba(36, 30, 27, 0.9)',
  selectedBorder: 'rgba(217, 168, 87, 0.35)',
  chipFill: 'rgba(217, 168, 87, 0.12)',
} as const;

/**
 * Day tones on Your Patterns, from colours the screen already uses: gold
 * for a lighter day, sand for a mixed one, and the weather chart's cool
 * grey-brown for a heavy one. Always shown with a word too, never by
 * colour alone.
 */
export const TONE_COLORS: Record<Tone, string> = {
  light: dawn.gold,
  mixed: dawn.sand,
  heavy: '#A89F94',
};
