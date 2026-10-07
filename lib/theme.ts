/** Dawn Earth — shared dark palette (matches Home hub / widget). */
export const colors = {
  base: '#1A1614',
  surface: '#241E1B',
  surfaceRaised: '#2E2723',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  clay: '#A69480',
  gold: '#D9A857',
  goldSoft: '#B8924A',
  olive: '#606C38',
  oliveSoft: '#4D5A2E',
  onPrimary: '#1A1614',
  dostBubble: '#2E2723',
  userBubble: '#D9A857',
  error: '#C77B5A',
  success: '#7A8F4A',
  divider: 'rgba(237, 228, 211, 0.12)',
  borderStrong: 'rgba(237, 228, 211, 0.18)',
  goldWash: 'rgba(217, 168, 87, 0.12)',
  goldWashStrong: 'rgba(217, 168, 87, 0.2)',
  oliveWash: 'rgba(96, 108, 56, 0.2)',
  logoutWash: 'rgba(217, 168, 87, 0.08)',
  scrim: 'rgba(26, 22, 20, 0.72)',

  // ── Terracotta / CTA system (replaces gold for buttons in new design) ──
  terracotta: '#B84C30',
  terracottaSoft: '#9E3D22',
  terracottaDot: '#C86040',
  terracottaWash: 'rgba(184, 76, 48, 0.15)',
  terracottaDash: 'rgba(184, 76, 48, 0.28)',
  onTerracotta: '#FFFFFF',

  // ── Light / parchment mode (onboarding, reflection screens) ──
  parchment: '#F2EDE4',
  parchmentDeep: '#EAE3D8',
  blush: '#E8C4B8',
  inkDark: '#1C1410',
  inkMuted: '#7A6355',
  inkLight: '#A09080',
  parchmentBorder: 'rgba(28, 20, 16, 0.12)',
  parchmentDivider: 'rgba(28, 20, 16, 0.08)',
  parchmentCard: 'rgba(255, 255, 255, 0.55)',
} as const;

/**
 * App typefaces (assets/fonts, from Nerd Fonts). iM Writing is iA Writer
 * Quattro; Victor Mono Light Italic is used only for the launch line.
 * Keys match the names registered with useFonts in App.tsx.
 */
export const fonts = {
  regular: 'IMWriting-Regular',
  bold: 'IMWriting-Bold',
  italic: 'IMWriting-Italic',
  display: 'VictorMono-LightItalic',
} as const;

export const type = {
  display: {
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 40,
  },
  dostMessage: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 36,
  },
  reflectivePrompt: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  userMessage: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  '2xl': 20,
  cta: 26,
  full: 9999,
} as const;

export const theme = {
  colors,
  fonts,
  type,
  spacing,
  radius,
} as const;

export default theme;
