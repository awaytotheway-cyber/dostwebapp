import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type QuestionType = 'short_text' | 'single_choice';

export type OnboardingScreen = {
  id: string;
  position: number;
  title: string;
  subtitle: string | null;
  question_type: QuestionType;
  options: Array<{ label: string }> | null;
  is_required: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type OnboardingAnswer = {
  user_id: string;
  screen_id: string;
  answer_text: string | null;
  answer_option: string | null;
  answered_at: string;
};

/** A built-in onboarding screen the admin can reorder or switch off. */
export type BuiltInScreen = {
  screen_key: string;
  label: string;
  position: number;
  is_active: boolean;
  is_removable: boolean;
};

/** One editable string on a built-in screen. */
export type OnboardingText = {
  i18n_key: string;
  screen_key: string;
  field_label: string;
  default_text: string;
  override_text: string | null;
  sort_order: number;
};
