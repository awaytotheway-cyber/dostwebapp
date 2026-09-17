import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_ERROR_KEY = 'dost:last_api_error';

export type ApiErrorDiagnostic = {
  at: string;
  source: 'chat' | 'transcribe' | 'voice-pipeline';
  code: string;
  httpStatus?: number;
  serverError?: string;
  step?: string;
  errorName?: string;
  detail?: string;
};

export async function recordApiError(diag: Omit<ApiErrorDiagnostic, 'at'>): Promise<void> {
  const entry: ApiErrorDiagnostic = {
    ...diag,
    at: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(LAST_ERROR_KEY, JSON.stringify(entry));
  } catch {
    // Best-effort only.
  }
}

export async function getLastApiError(): Promise<ApiErrorDiagnostic | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ERROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiErrorDiagnostic;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.code !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearLastApiError(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_ERROR_KEY);
  } catch {
    // ignore
  }
}

/** Format for on-screen display (no secrets). */
export function formatDiagnostic(diag: ApiErrorDiagnostic): string {
  const parts = [`Code: ${diag.code}`];
  if (typeof diag.httpStatus === 'number') parts.push(`HTTP ${diag.httpStatus}`);
  if (diag.step) parts.push(`Step: ${diag.step}`);
  if (diag.serverError) parts.push(`Server: ${diag.serverError}`);
  if (diag.errorName) parts.push(`Type: ${diag.errorName}`);
  if (diag.detail) parts.push(diag.detail);
  parts.push(`At: ${new Date(diag.at).toLocaleString()}`);
  return parts.join('\n');
}
