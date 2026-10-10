import { setTextOverrides } from './i18n';
import { supabase } from './supabase';

/**
 * Admin control over the built-in onboarding screens.
 *
 * Two things come from the database:
 *   - which screens are active, and in what order
 *     (onboarding_screen_config)
 *   - text overrides for any question prompt or option label
 *     (onboarding_text.override_text)
 *
 * Both are fetched once at app start and cached for the session. If the
 * fetch fails we fall back to the built-in order and the shipped copy,
 * so a network problem can never block onboarding.
 */

export type OnboardingScreenKey =
  | 'Name'
  | 'Intention'
  | 'Birth'
  | 'BirthPlace'
  | 'Dosha'
  | 'Enneagram'
  | 'Numerology'
  | 'TCM'
  | 'MBTI'
  | 'Varna';

/** Shipped order, used when the config has not loaded. */
export const DEFAULT_SCREEN_ORDER: OnboardingScreenKey[] = [
  'Name',
  'Intention',
  'Birth',
  'BirthPlace',
  'Dosha',
  'Enneagram',
  'Numerology',
  'TCM',
  'MBTI',
  'Varna',
];

/** Always last two, never admin-controlled. */
const TAIL_ROUTES = ['AdminExtra', 'Confirm'] as const;

let activeScreens: OnboardingScreenKey[] = [...DEFAULT_SCREEN_ORDER];
let loaded = false;

export function getActiveOnboardingScreens(): OnboardingScreenKey[] {
  return activeScreens;
}

export function isOnboardingConfigLoaded(): boolean {
  return loaded;
}

/**
 * The route to go to after `current` finishes. Walks the active list and
 * falls through to AdminExtra → Confirm at the end, so disabling the last
 * few screens can never strand the user.
 */
export function nextOnboardingRoute(
  current: OnboardingScreenKey | 'Welcome',
): OnboardingScreenKey | 'AdminExtra' | 'Confirm' {
  if (current === 'Welcome') {
    return activeScreens[0] ?? TAIL_ROUTES[0];
  }
  const idx = activeScreens.indexOf(current);
  if (idx === -1 || idx + 1 >= activeScreens.length) {
    return TAIL_ROUTES[0];
  }
  return activeScreens[idx + 1];
}

/** The first screen of the flow — used by Welcome. */
export function firstOnboardingRoute(): OnboardingScreenKey | 'AdminExtra' {
  return activeScreens[0] ?? TAIL_ROUTES[0];
}

function isScreenKey(value: unknown): value is OnboardingScreenKey {
  return (
    typeof value === 'string' &&
    (DEFAULT_SCREEN_ORDER as readonly string[]).includes(value)
  );
}

export async function loadOnboardingConfig(): Promise<void> {
  try {
    const [configResult, textResult] = await Promise.all([
      supabase
        .from('onboarding_screen_config')
        .select('screen_key, position, is_active')
        .eq('is_active', true)
        .order('position', { ascending: true }),
      supabase
        .from('onboarding_text')
        .select('i18n_key, override_text')
        .not('override_text', 'is', null),
    ]);

    if (!configResult.error && Array.isArray(configResult.data)) {
      const keys = configResult.data
        .map((row) => (row as { screen_key?: unknown }).screen_key)
        .filter(isScreenKey);
      // Name is structurally required (saveMyProfile needs it) — if an
      // admin somehow deactivated it, put it back at the front.
      if (keys.length > 0) {
        activeScreens = keys.includes('Name') ? keys : ['Name', ...keys];
      }
    }

    if (!textResult.error && Array.isArray(textResult.data)) {
      const overrides: Record<string, string> = {};
      for (const row of textResult.data) {
        const key = (row as { i18n_key?: unknown }).i18n_key;
        const text = (row as { override_text?: unknown }).override_text;
        if (typeof key === 'string' && typeof text === 'string' && text.trim()) {
          overrides[key] = text;
        }
      }
      setTextOverrides(overrides);
    }
  } catch {
    // Keep the shipped defaults.
  } finally {
    loaded = true;
  }
}
