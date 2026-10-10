import { supabase } from './supabase';

/**
 * Fetch + save for the admin-authored onboarding screens.
 *
 * The admin app at /admin writes to admin_onboarding_screens. The mobile
 * app renders the active ones in position order between Varna and
 * Confirm, and saves answers to admin_onboarding_answers. The chat edge
 * function later reads those answers to seed context so the bot can use
 * what the user shared from next session onwards.
 */

export type QuestionType = 'short_text' | 'single_choice';

export type AdminOnboardingScreen = {
  id: string;
  position: number;
  title: string;
  subtitle: string | null;
  question_type: QuestionType;
  options: Array<{ label: string }> | null;
  is_required: boolean;
  is_active: boolean;
};

export type AdminOnboardingAnswer = {
  screen_id: string;
  answer_text?: string | null;
  answer_option?: string | null;
};

export async function fetchActiveAdminScreens(): Promise<AdminOnboardingScreen[]> {
  const { data, error } = await supabase
    .from('admin_onboarding_screens')
    .select('id, position, title, subtitle, question_type, options, is_required, is_active')
    .eq('is_active', true)
    .order('position', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data as AdminOnboardingScreen[];
}

export async function saveAdminAnswers(
  answers: AdminOnboardingAnswer[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (answers.length === 0) return { ok: true };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: 'Sign-in required to save your answers.' };
  }

  const rows = answers.map((a) => ({
    user_id: userId,
    screen_id: a.screen_id,
    answer_text: a.answer_text ?? null,
    answer_option: a.answer_option ?? null,
    answered_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('admin_onboarding_answers')
    .upsert(rows, { onConflict: 'user_id,screen_id' });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
