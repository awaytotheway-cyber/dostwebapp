import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import {
  analyzeVoiceprint,
  averageVoiceprints,
  VOICEPRINT_LENGTH,
  type Voiceprint,
} from './speakerFingerprint';
import { VOICEPRINT_MODEL_VERSION } from './voiceprintModel';

/**
 * Speaker-enrollment orchestration.
 *
 * - captureEnrollmentClip()  calls the native EnrollmentRecorder for a
 *                            short in-app PCM clip (no foreground
 *                            service, no notification, no disk).
 * - saveEnrollment()          averages per-clip voiceprints into a
 *                            reference and upserts speaker_enrollment.
 * - loadReferenceVoiceprint() fetches the enrolled reference once at
 *                            session start; the pipeline caches it
 *                            for the session's lifetime.
 * - isEnrolled()              quick check used to gate the Listening
 *                            Session start button.
 * - deleteEnrollment()        clears the row so no session can start
 *                            until re-enrollment.
 *
 * The enrollment audio (PCM clips) never touches disk. Only the
 * resulting 26-dim voiceprint vector is persisted.
 */

const ENROLLMENT_ACK_KEY = 'dost.hearing.enrollment.complete.v1';
const ENROLLMENT_LANGS_KEY = 'dost.hearing.enrollment.languages.v1';

// Method identifier used by upserts. Matches the check constraint on
// speaker_enrollment.enrollment_method.
const ENROLLMENT_METHOD: 'mfcc_fingerprint' | 'embedding_model' = 'mfcc_fingerprint';
// Enrollments saved under any other version are treated as missing, so
// the user is sent back through enrollment after a model change.
const MODEL_VERSION = VOICEPRINT_MODEL_VERSION;

// Each 12 s clip must contain at least this much voiced audio.
const MIN_CLIP_SPEECH_SECONDS = 3;

export type EnrollmentLanguage = 'en' | 'hi' | 'mr';

export const ENROLLMENT_LANGUAGES: readonly EnrollmentLanguage[] = ['en', 'hi', 'mr'];

export type EnrollmentPrompt = {
  id: string;
  language: EnrollmentLanguage;
  primary: string;      // shown large
  transliteration?: string; // shown small, muted (for Devanagari lines)
  gloss: string;        // shown small (translation, for the reader's confidence)
};

/**
 * Prompt bank grouped by language. Each language has 5 short prompts
 * (~10–15 s spoken) chosen for phonetic variety — vowels, plosives,
 * fricatives, nasals, retroflex consonants in the Indic prompts.
 *
 * selectPromptsFor(languages, TARGET_CLIP_COUNT) picks 5 total,
 * interleaved across whichever languages the user actually speaks so
 * the enrolled voiceprint covers the phonetic space that will show up
 * in real listening sessions.
 */
const PROMPT_BANK: Record<EnrollmentLanguage, EnrollmentPrompt[]> = {
  en: [
    {
      id: 'en-1',
      language: 'en',
      primary:
        'The quick brown fox jumps over the lazy dog, while children play under the bright moonlight.',
      gloss: 'English',
    },
    {
      id: 'en-2',
      language: 'en',
      primary:
        'She reads philosophy in the evening, drinks lemon tea, and writes long thoughtful letters to her sister.',
      gloss: 'English',
    },
    {
      id: 'en-3',
      language: 'en',
      primary:
        'Every morning the baker measures flour, kneads the dough, and slides warm loaves out of the oven.',
      gloss: 'English',
    },
    {
      id: 'en-4',
      language: 'en',
      primary:
        'Across the wooden bridge, the traveller paused to watch fish glide beneath the still, cold water.',
      gloss: 'English',
    },
    {
      id: 'en-5',
      language: 'en',
      primary:
        'Late at night, thunder rolled through the valley while gentle rain tapped against the tin roof.',
      gloss: 'English',
    },
  ],
  hi: [
    {
      id: 'hi-1',
      language: 'hi',
      primary:
        'आज सुबह मैंने खिड़की से बाहर देखा, आसमान में हल्के बादल थे और हवा में ठंडक थी।',
      transliteration:
        'Aaj subah maine khidki se baahar dekha, aasmaan mein halke baadal the aur hawa mein thandak thi.',
      gloss:
        'This morning I looked out the window; there were light clouds in the sky and coolness in the air.',
    },
    {
      id: 'hi-2',
      language: 'hi',
      primary:
        'मुझे किताबें पढ़ना बहुत पसंद है, खासकर बारिश के दिनों में जब हवा में मिट्टी की खुशबू होती है।',
      transliteration:
        'Mujhe kitaabein padhna bahut pasand hai, khaaskar baarish ke dinon mein jab hawa mein mitti ki khushboo hoti hai.',
      gloss:
        'I love reading books, especially on rainy days when the air smells of wet earth.',
    },
    {
      id: 'hi-3',
      language: 'hi',
      primary:
        'शाम को माँ ने चाय बनाई, अदरक और इलायची की महक पूरे घर में फैल गई।',
      transliteration:
        'Shaam ko maa ne chaay banai, adrak aur ilaaychi ki mehak poore ghar mein phail gayi.',
      gloss:
        'In the evening mother made tea; the scent of ginger and cardamom spread through the whole house.',
    },
    {
      id: 'hi-4',
      language: 'hi',
      primary:
        'बचपन में हम गली में क्रिकेट खेलते थे, और शाम तक धूल में लिपटे घर लौटते थे।',
      transliteration:
        'Bachpan mein hum gali mein cricket khelte the, aur shaam tak dhool mein lipte ghar lautte the.',
      gloss:
        'In childhood we played cricket in the street and came home covered in dust by evening.',
    },
    {
      id: 'hi-5',
      language: 'hi',
      primary:
        'छत पर बैठकर तारे देखना मुझे शांति देता है, दुनिया की हर बात कुछ देर के लिए रुक जाती है।',
      transliteration:
        'Chhat par baithkar taare dekhna mujhe shaanti deta hai, duniya ki har baat kuch der ke liye ruk jaati hai.',
      gloss:
        'Sitting on the roof watching the stars gives me peace; the world pauses for a little while.',
    },
  ],
  mr: [
    {
      id: 'mr-1',
      language: 'mr',
      primary:
        'आपल्या घरातलं जुनं झाड आज खूप हिरवं दिसतंय, आणि त्यावर पक्षी शांतपणे बसले आहेत.',
      transliteration:
        'Aaplyaa gharaatlan juna zaad aaj khoop hiravan disatanya, aani tyaavar pakshi shaantpane basale aahet.',
      gloss:
        'The old tree in our house looks very green today, and birds are sitting quietly on it.',
    },
    {
      id: 'mr-2',
      language: 'mr',
      primary:
        'सकाळी आईने चहा केला आणि गरम गरम पोहे बनवले, ती चव अजून आठवते.',
      transliteration:
        'Sakaali aaine chahaa kelaa aani garam garam pohe banavale, ti chav ajun aathvate.',
      gloss:
        'In the morning mother made tea and hot poha; I still remember that taste.',
    },
    {
      id: 'mr-3',
      language: 'mr',
      primary:
        'पावसाळ्यात आमच्या अंगणात मोर येतात, त्यांचा नाच पाहणं म्हणजे लहानपणाची आठवण.',
      transliteration:
        'Paavasaalyaat aamchya angnaat mor yetaat, tyaancha naach paahne mhanje lahanpanaachi aathvan.',
      gloss:
        'In the monsoon peacocks come to our courtyard; watching them dance is a memory of childhood.',
    },
    {
      id: 'mr-4',
      language: 'mr',
      primary:
        'रात्री गच्चीवर बसून तारे मोजायचे, आणि आजी सांगायच्या जुन्या गोष्टी.',
      transliteration:
        'Raatri gachivar basun taare mojaayche, aani aaji saangaaychya junyaa goshti.',
      gloss:
        'At night we would sit on the terrace counting stars, and grandmother would tell old stories.',
    },
    {
      id: 'mr-5',
      language: 'mr',
      primary:
        'समुद्राच्या किनाऱ्यावर वाळू पायांना गरम लागते, पण लाटांचा आवाज मन शांत करतो.',
      transliteration:
        'Samudraachyaa kinaaryaavar vaalu paayaanna garam laagte, pan laataancha aavaaj man shaant karto.',
      gloss:
        'On the seashore the sand feels hot on our feet, but the sound of the waves calms the mind.',
    },
  ],
};

/** The total number of clips collected during enrollment. Kept fixed
 * regardless of how many languages the user picks — a longer sample
 * gives a more robust averaged voiceprint. */
export const TARGET_CLIP_COUNT = 5;

/** Full unified prompt list (used only for tests / debug — the UI
 * always calls selectPromptsFor with the user's language pick). */
export const ENROLLMENT_PROMPTS: EnrollmentPrompt[] = [
  ...PROMPT_BANK.en,
  ...PROMPT_BANK.hi,
  ...PROMPT_BANK.mr,
];

/**
 * Pick `count` prompts interleaved across the user's chosen languages.
 * Round-robins through the selected languages so the enrollment
 * doesn't clump — e.g., en → hi → en → hi → en for a 2-language pick.
 *
 * Requires at least one language; returns [] otherwise.
 */
export function selectPromptsFor(
  languages: readonly EnrollmentLanguage[],
  count: number = TARGET_CLIP_COUNT,
): EnrollmentPrompt[] {
  const langs = languages.filter((l) => ENROLLMENT_LANGUAGES.includes(l));
  if (langs.length === 0 || count <= 0) return [];
  const out: EnrollmentPrompt[] = [];
  const cursors: Record<EnrollmentLanguage, number> = { en: 0, hi: 0, mr: 0 };
  let i = 0;
  while (out.length < count) {
    const lang = langs[i % langs.length];
    const bank = PROMPT_BANK[lang];
    const c = cursors[lang];
    if (c < bank.length) {
      out.push(bank[c]);
      cursors[lang] = c + 1;
    } else {
      // This language ran out; if every language is exhausted, stop.
      const anyLeft = langs.some((l) => cursors[l] < PROMPT_BANK[l].length);
      if (!anyLeft) break;
    }
    i++;
  }
  return out;
}

// Recommended clip duration in ms. Comfortably fits any of the prompts
// above at a natural reading pace with a moment of leeway on each end.
export const ENROLLMENT_CLIP_MS = 12_000;

// ─── language-preference persistence ─────────────────────────────

/** Reads the last-picked enrollment languages, or the default of all
 * three if the user hasn't chosen yet. */
export async function getEnrollmentLanguages(): Promise<EnrollmentLanguage[]> {
  try {
    const raw = await AsyncStorage.getItem(ENROLLMENT_LANGS_KEY);
    if (!raw) return ['en', 'hi', 'mr'];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ['en', 'hi', 'mr'];
    const cleaned = parsed.filter(
      (v: unknown): v is EnrollmentLanguage =>
        typeof v === 'string' && (ENROLLMENT_LANGUAGES as readonly string[]).includes(v),
    );
    return cleaned.length > 0 ? cleaned : ['en', 'hi', 'mr'];
  } catch {
    return ['en', 'hi', 'mr'];
  }
}

export async function saveEnrollmentLanguages(
  languages: readonly EnrollmentLanguage[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ENROLLMENT_LANGS_KEY,
      JSON.stringify(Array.from(new Set(languages))),
    );
  } catch {
    // best-effort
  }
}

// ─── native passthrough ───────────────────────────────────────────

type NativeClipResult = {
  pcmBase64: string;
  sampleRate: number;
  durationMs: number;
};

type HearingNativeModule = {
  captureEnrollmentClip: (durationMs: number) => Promise<NativeClipResult>;
  cancelEnrollmentCapture: () => Promise<boolean>;
};

function nativeModule(): HearingNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as any).HearingModule;
  if (!mod) return null;
  return mod as HearingNativeModule;
}

export type CapturedClip = {
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
};

export async function captureEnrollmentClip(
  durationMs: number = ENROLLMENT_CLIP_MS,
): Promise<CapturedClip> {
  const mod = nativeModule();
  if (!mod) {
    throw new Error('Enrollment is Android-only for now');
  }
  const raw = await mod.captureEnrollmentClip(durationMs);
  return {
    pcm: decodePcm16Base64ToFloat32(raw.pcmBase64),
    sampleRate: raw.sampleRate,
    durationMs: raw.durationMs,
  };
}

export async function cancelEnrollmentCapture(): Promise<void> {
  const mod = nativeModule();
  if (!mod) return;
  try {
    await mod.cancelEnrollmentCapture();
  } catch {
    // best-effort
  }
}

// ─── voiceprint + persistence ─────────────────────────────────────

/**
 * Extract a voiceprint from a captured clip. Wraps the primitive from
 * speakerFingerprint.ts so callers don't have to touch that module
 * directly.
 */
export function voiceprintFromClip(clip: CapturedClip): Voiceprint {
  const { voiceprint, speechSeconds } = analyzeVoiceprint(clip.pcm, clip.sampleRate);
  if (speechSeconds < MIN_CLIP_SPEECH_SECONDS) {
    throw new Error(
      `We only heard about ${Math.round(speechSeconds)} seconds of your voice. ` +
        'Please read the whole passage aloud, holding the phone a little closer.',
    );
  }
  return voiceprint;
}

export async function saveEnrollment(
  clipVoiceprints: Voiceprint[],
): Promise<void> {
  if (clipVoiceprints.length === 0) {
    throw new Error('No enrollment clips captured');
  }
  const reference = averageVoiceprints(clipVoiceprints);
  if (reference.length !== VOICEPRINT_LENGTH) {
    throw new Error('Voiceprint dimension mismatch');
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error('Sign in required to enroll');
  }
  const userId = userData.user.id;

  const now = new Date().toISOString();
  const { error } = await supabase.from('speaker_enrollment').upsert({
    user_id: userId,
    voiceprint: reference,
    enrollment_method: ENROLLMENT_METHOD,
    model_version: MODEL_VERSION,
    clips_used: clipVoiceprints.length,
    enrolled_at: now,
    updated_at: now,
  });
  if (error) throw error;

  try {
    await AsyncStorage.setItem(ENROLLMENT_ACK_KEY, now);
  } catch {
    // Not critical — Supabase is source of truth.
  }
}

/**
 * Fetch the enrolled reference voiceprint. Returns null if the user
 * hasn't enrolled yet. pgvector returns the column as either a JSON
 * array or a string like "[n1,n2,...]" depending on client codec —
 * this handles both.
 */
export async function loadReferenceVoiceprint(): Promise<Voiceprint | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('speaker_enrollment')
    .select('voiceprint, clips_used, model_version')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data || data.model_version !== MODEL_VERSION) return null;
  return parseVoiceprint(data.voiceprint);
}

/**
 * Fast enrollment check. Reads from Supabase (source of truth) but
 * treats the AsyncStorage ack key as a hint so cold-start UI can
 * avoid a network round-trip when navigating.
 */
export async function isEnrolled(): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return false;
  const { data } = await supabase
    .from('speaker_enrollment')
    .select('user_id, clips_used, model_version')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(
    data && (data.clips_used ?? 0) > 0 && data.model_version === MODEL_VERSION,
  );
}

export async function deleteEnrollment(): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return;
  await supabase.from('speaker_enrollment').delete().eq('user_id', userId);
  try {
    await AsyncStorage.removeItem(ENROLLMENT_ACK_KEY);
  } catch {
    // best-effort
  }
}

// ─── helpers ──────────────────────────────────────────────────────

function parseVoiceprint(raw: unknown): Voiceprint | null {
  if (Array.isArray(raw)) {
    const nums = raw.map((n) => Number(n));
    if (nums.every((n) => Number.isFinite(n)) && nums.length === VOICEPRINT_LENGTH) {
      return nums;
    }
    return null;
  }
  if (typeof raw === 'string') {
    // pgvector's default text serialization is "[n1,n2,...]"
    const trimmed = raw.trim();
    const inner =
      trimmed.startsWith('[') && trimmed.endsWith(']')
        ? trimmed.slice(1, -1)
        : trimmed;
    const nums = inner.split(',').map((s) => Number(s.trim()));
    if (nums.every((n) => Number.isFinite(n)) && nums.length === VOICEPRINT_LENGTH) {
      return nums;
    }
  }
  return null;
}

function decodePcm16Base64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const sampleCount = bytes.length >> 1;
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let v = (hi << 8) | lo;
    if (v & 0x8000) v = v - 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64) as string;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B64_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup: number[] = new Array<number>(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = ((clean.length * 3) >> 2) - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)];
    const c1 = lookup[clean.charCodeAt(i + 1)];
    const c2 = lookup[clean.charCodeAt(i + 2)];
    const c3 = lookup[clean.charCodeAt(i + 3)];
    if (o < outLen) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < outLen) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (o < outLen) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}
