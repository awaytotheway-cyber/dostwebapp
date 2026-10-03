import { t as translate } from './i18n';
import { supabase } from './supabase';

export type HmTime = { hour: number; minute: number };

const DEFAULT_TIME: HmTime = { hour: 20, minute: 0 };

export function parseReflectionTime(value: unknown): HmTime {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      const hour = Math.min(23, Math.max(0, Number(match[1])));
      const minute = Math.min(59, Math.max(0, Number(match[2])));
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return { hour, minute };
      }
    }
  }
  return DEFAULT_TIME;
}

export function formatReflectionTime({ hour, minute }: HmTime): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

export function tomorrowDateLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function morningOf(dateStr: string, hour = 8, minute = 0): Date {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(hour, minute, 0, 0);
    return fallback;
  }
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

export function nextOccurrence({ hour, minute }: HmTime): Date {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now() + 5000) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export async function loadReflectionTime(): Promise<HmTime> {
  const { data, error } = await supabase
    .from('profiles')
    .select('reflection_time')
    .maybeSingle();

  if (error || !data) return DEFAULT_TIME;
  return parseReflectionTime((data as { reflection_time?: unknown }).reflection_time);
}

export async function saveReflectionTime(time: HmTime): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ reflection_time: formatReflectionTime(time) })
    .eq('id', userId);

  if (error) {
    return {
      ok: false,
      message: translate('errors.reflectionTimeSaveFailed'),
    };
  }
  return { ok: true };
}

export async function saveDailyIntentions(
  noticing1: string,
  noticing2: string,
): Promise<{ ok: true; forDate: string; intentions: [string, string] } | { ok: false; message: string }> {
  const one = noticing1.trim().slice(0, 120);
  const two = noticing2.trim().slice(0, 120);
  if (!one || !two) {
    return { ok: false, message: translate('errors.nameTwoThings') };
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) {
    return { ok: false, message: translate('errors.verifySession') };
  }

  const forDate = tomorrowDateLocal();
  const row = {
    user_id: userId,
    for_date: forDate,
    intentions: [one, two],
  };

  const upsert = await supabase.from('daily_intentions').upsert(row, {
    onConflict: 'user_id,for_date',
  });

  if (upsert.error) {
    const insert = await supabase.from('daily_intentions').insert(row);
    if (insert.error) {
      return {
        ok: false,
        message: translate('errors.noticingsSaveFailed'),
      };
    }
  }

  return { ok: true, forDate, intentions: [one, two] };
}
