import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeThemeRepeatCount,
  determineStage,
  type RecentStageRow,
  type Stage,
} from "../_shared/conversationStage.ts";

// Helpers live in this file so dashboard deploy (this folder only) can bundle.
// CLI deploy of other functions still uses supabase/functions/_shared/safe.ts.

const MAX_MESSAGE_LEN = 2000;
const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-z][a-z_]{0,39}$/;
const MAX_TOKEN_LEN = 40;
const MAX_SENTENCE_CHARS = 48;
const MAX_EXPLANATION_LEN = 1200;
const CONFIDENCE_THRESHOLD = 0.5;

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_FORBIDDEN = "You cannot save emotions for another account.";
const GENERIC_INVALID = "Invalid request.";
const GENERIC_PARSE =
  "Could not read the emotion result. Please try again.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Emotion extraction is temporarily unavailable.";

/** Vedic coverings + everyday feeling labels used in few-shots / Layer 2. */
const ALLOWED_EMOTIONS = new Set([
  "shame",
  "anger_grief",
  "multipersona",
  "shielding_manager",
  "victim_personality",
  "resignation",
  "denial",
  "envy",
  "pride",
  "greed",
  "lust",
  "addiction",
  "detachment",
  "spiritual_bypass",
  "scarcity",
  "lamentation",
  "inadequacy",
  "loneliness",
  "resentment",
  "guilt",
  "fear",
  "anxiety",
  "grief",
  "anger",
  "helplessness",
  "overwhelm",
  "numbness",
  "disappointment",
  "frustration",
  "confusion",
  "emptiness",
  "betrayal",
  "abandonment",
  "humiliation",
  "embarrassment",
  "jealousy",
  "invisibility",
  "sadness",
  "weariness",
  "hurt",
  "longing",
  "disgust",
  "contempt",
]);

const ALLOWED_NEEDS = new Set([
  "safety",
  "autonomy",
  "recognition",
  "belonging",
  "authenticity",
  "meaning",
  "growth",
  "peace",
  "connection",
  "respect",
  "competence",
  "acceptance",
  "self_acceptance",
  "freedom",
  "understanding",
  "empathy",
  "support",
  "trust",
  "fairness",
  "dignity",
  "purpose",
  "love",
  "reciprocity",
  "consideration",
  "being_seen",
  "being_heard",
  "being_enough",
]);

/** Near-miss / everyday synonyms → allowlisted tokens. */
const EMOTION_ALIASES: Record<string, string> = {
  not_enough: "shame",
  not_good_enough: "shame",
  worthless: "shame",
  self_loathing: "shame",
  people_pleasing: "shielding_manager",
  people_pleaser: "shielding_manager",
  perfectionism: "shielding_manager",
  controlling: "shielding_manager",
  victim: "victim_personality",
  powerless: "helplessness",
  hopeless: "resignation",
  giving_up: "resignation",
  fine: "denial",
  numb: "numbness",
  numbing: "numbness",
  checked_out: "detachment",
  zoning_out: "detachment",
  lonely: "loneliness",
  alone: "loneliness",
  anxious: "anxiety",
  worry: "anxiety",
  worried: "anxiety",
  scared: "fear",
  afraid: "fear",
  terrified: "fear",
  sad: "sadness",
  depressed: "sadness",
  tired: "weariness",
  exhausted: "weariness",
  burnt_out: "weariness",
  burned_out: "weariness",
  jealous: "jealousy",
  invisible: "invisibility",
  unseen: "invisibility",
  overlooked: "invisibility",
  angry: "anger",
  mad: "anger",
  rage: "anger",
  frustrated: "frustration",
  annoyed: "frustration",
  confused: "confusion",
  lost: "confusion",
  empty: "emptiness",
  void: "emptiness",
  hurt_feelings: "hurt",
  wounded: "hurt",
  craving: "longing",
  yearning: "longing",
  bypass: "spiritual_bypass",
  spiritual_bypassing: "spiritual_bypass",
  parts: "multipersona",
  fragmented: "multipersona",
  overwhelmed: "overwhelm",
  stressed: "overwhelm",
  embarrassed: "embarrassment",
  humiliated: "humiliation",
  guilty: "guilt",
  resentful: "resentment",
  bitter: "resentment",
  abandoned: "abandonment",
  betrayed: "betrayal",
  disappointed: "disappointment",
  inadequate: "inadequacy",
  insecure: "inadequacy",
  disgusted: "disgust",
  contemptuous: "contempt",
  disdain: "contempt",
  not_enough_to_go_around: "scarcity",
  lack: "scarcity",
  mourning: "lamentation",
  lament: "lamentation",
  deep_sorrow: "lamentation",
};

const NEED_ALIASES: Record<string, string> = {
  selfacceptance: "self_acceptance",
  self_worth: "self_acceptance",
  enoughness: "being_enough",
  to_be_enough: "being_enough",
  to_be_seen: "being_seen",
  to_be_heard: "being_heard",
  validation: "recognition",
  appreciation: "recognition",
  agency: "autonomy",
  control: "autonomy",
  security: "safety",
  community: "belonging",
  intimacy: "connection",
  care: "support",
  compassion: "empathy",
  clarity: "understanding",
  justice: "fairness",
  worth: "dignity",
  mutuality: "reciprocity",
};

const FALLBACK_EMOTION = "detachment";
const FALLBACK_NEED = "understanding";

const EXTRACTION_SYSTEM =
  "You extract emotion labels, NVC needs, and intensity scores from one user message. Return JSON only. Prefer allowlisted tokens. Never invent names, events, phone numbers, emails, or long quoted text.";

function pgCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim().slice(0, 32);
  }
  return "";
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 64);
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 64);
  }
  return "Error";
}

function logFnError(fn: string, step: string, error: unknown): void {
  console.error(fn, step, errorName(error), pgCode(error) || "-");
}

function jsonSafe(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "embedding" || key.endsWith("_embedding")) continue;
      const safe = jsonSafe(nested);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }
  return undefined;
}

function serviceRoleKey(): string {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    ""
  );
}

function supabaseEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  return {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    serviceRoleKey: serviceRoleKey(),
  };
}

function envIsReady(env: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}): boolean {
  return Boolean(
    env.url.startsWith("https://") && env.anonKey && env.serviceRoleKey,
  );
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin || origin === "null") return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();
    if (protocol === "exp:" || protocol === "exps:") return true;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    ) {
      return protocol === "http:" || protocol === "https:";
    }
    if (
      host === "expo.dev" ||
      host.endsWith(".expo.dev") ||
      host.endsWith(".exp.host") ||
      host.endsWith(".exp.direct") ||
      host.endsWith(".expo.direct")
    ) {
      return true;
    }
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return protocol === "http:" || protocol === "https:";
    }
    return protocol === "https:";
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, traceparent, tracestate, baggage",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] =
      origin && origin !== "null" ? origin : "*";
  }
  return headers;
}

function jsonResponse(
  cors: Record<string, string>,
  status: number,
  body: unknown,
  fn = "fn",
): Response {
  let text: string;
  let outStatus = status;
  try {
    text = JSON.stringify(jsonSafe(body) ?? { error: GENERIC_ERROR });
  } catch (error) {
    logFnError(fn, "serialize", error);
    text = JSON.stringify({ error: GENERIC_ERROR });
    outStatus = status >= 400 ? status : 502;
  }
  return new Response(text, {
    status: outStatus,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "extract-emotions");

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!isAllowedOrigin(origin)) {
    return jsonResponse({}, 403, { error: "Forbidden" }, "extract-emotions");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("extract-emotions", "env", new Error("MissingEnv"));
      return json(502, { error: GENERIC_ERROR });
    }

    const userClient = createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user?.id) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }
    const userId = user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: GENERIC_INVALID });
    }

    const parsedBody = parseRequest(body);
    if (!parsedBody.ok) {
      return json(400, { error: GENERIC_INVALID });
    }

    if (parsedBody.userId !== userId) {
      console.error("extract-emotions", "user_mismatch", userId, parsedBody.messageId);
      return json(403, { error: GENERIC_FORBIDDEN });
    }

    const owned = await messageOwnedByUser(
      userClient,
      userId,
      parsedBody.messageId,
    );
    if (!owned) {
      return json(400, { error: GENERIC_INVALID });
    }

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const existing = await loadExisting(admin, userId, parsedBody.messageId);
    if (existing) {
      console.log(
        "extract-emotions",
        "duplicate",
        userId,
        parsedBody.messageId,
        existing.primary_emotions[0] ?? existing.primary_emotion,
      );
      return json(200, existing);
    }

    const recentRows = await loadRecentStageRows(
      admin,
      userId,
      parsedBody.messageId,
    );

    let extracted: ExtractedEmotions;
    try {
      extracted = await callOpenAI(parsedBody.messageText);
    } catch (error) {
      if (error instanceof Error && error.message === "parse") {
        logFnError("extract-emotions", "parse", error);
        return json(400, { error: GENERIC_PARSE });
      }
      logFnError("extract-emotions", "upstream", error);
      return json(502, { error: GENERIC_UPSTREAM });
    }

    const conversationStage = determineStage(
      recentRows,
      parsedBody.messageText,
    );
    const themeRepeatCount = computeThemeRepeatCount(
      recentRows,
      extracted.primary_emotion,
    );

    const { error: insertError } = await admin.from("message_emotions").insert({
      user_id: userId,
      message_id: parsedBody.messageId,
      primary_emotion: extracted.primary_emotion,
      primary_emotions: extracted.primary_emotions,
      secondary_emotions: extracted.secondary_emotions,
      underlying_need: extracted.underlying_need,
      needs: extracted.needs,
      emotion_intensities: extracted.emotion_intensities,
      confidence_score: extracted.confidence_score,
      is_ambiguous: extracted.is_ambiguous,
      explanation: extracted.explanation,
      conversation_stage: conversationStage,
      theme_repeat_count: themeRepeatCount,
    });

    if (insertError) {
      if (pgCode(insertError) === "23505") {
        const raced = await loadExisting(admin, userId, parsedBody.messageId);
        if (raced) {
          console.log(
            "extract-emotions",
            "duplicate",
            userId,
            parsedBody.messageId,
            raced.primary_emotions[0] ?? raced.primary_emotion,
          );
          return json(200, raced);
        }
        return json(409, { error: "Emotions already saved for this message." });
      }
      logFnError("extract-emotions", "insert", insertError);
      return json(502, { error: GENERIC_ERROR });
    }

    // Step 4 prep (metrics only): labels + confidence/ambiguity — never message text.
    console.log(
      "extract-emotions",
      "ok",
      userId,
      parsedBody.messageId,
      extracted.primary_emotions.join(",") || extracted.primary_emotion,
      extracted.confidence_score,
      extracted.is_ambiguous ? "ambiguous" : "clear",
      conversationStage,
      themeRepeatCount,
    );
    return json(200, {
      ...extracted,
      conversation_stage: conversationStage,
      theme_repeat_count: themeRepeatCount,
    });
  } catch (error) {
    logFnError("extract-emotions", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

type RequestBody = {
  messageId: string;
  messageText: string;
  userId: string;
};

function parseRequest(
  body: unknown,
): { ok: true } & RequestBody | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const record = body as Record<string, unknown>;

  const messageId =
    typeof record.message_id === "string" ? record.message_id.trim() : "";
  const userId = typeof record.user_id === "string" ? record.user_id.trim() : "";
  const messageText =
    typeof record.message_text === "string" ? record.message_text.trim() : "";

  if (!UUID_RE.test(messageId) || !UUID_RE.test(userId)) return { ok: false };
  if (messageText.length < 1 || messageText.length > MAX_MESSAGE_LEN) {
    return { ok: false };
  }

  return { ok: true, messageId, messageText, userId };
}

async function messageOwnedByUser(
  userClient: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<boolean> {
  const { data, error } = await userClient
    .from("conversations")
    .select("id")
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logFnError("extract-emotions", "message_lookup", error);
    return false;
  }
  return Boolean(data && typeof data === "object");
}

type ExtractedEmotions = {
  /** Legacy: first primary emotion. */
  primary_emotion: string;
  primary_emotions: string[];
  secondary_emotions: string[];
  /** Legacy: first need. */
  underlying_need: string;
  needs: string[];
  emotion_intensities: Record<string, number>;
  confidence_score: number;
  is_ambiguous: boolean;
  explanation: string | null;
  conversation_stage: Stage;
  theme_repeat_count: number;
};

async function loadRecentStageRows(
  admin: SupabaseClient,
  userId: string,
  excludeMessageId: string,
  limit = 20,
): Promise<RecentStageRow[]> {
  const { data, error } = await admin
    .from("message_emotions")
    .select(
      "selected_emotion, selected_need, conversation_stage, primary_emotion, created_at",
    )
    .eq("user_id", userId)
    .neq("message_id", excludeMessageId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logFnError("extract-emotions", "recent_stage_rows", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const rows: RecentStageRow[] = [];
  for (const row of data.slice().reverse()) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    rows.push({
      selected_emotion:
        typeof record.selected_emotion === "string"
          ? record.selected_emotion
          : null,
      selected_need:
        typeof record.selected_need === "string"
          ? record.selected_need
          : null,
      conversation_stage:
        typeof record.conversation_stage === "string"
          ? record.conversation_stage
          : "meeting",
      primary_emotion:
        typeof record.primary_emotion === "string"
          ? record.primary_emotion
          : null,
    });
  }
  return rows;
}

async function loadExisting(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<ExtractedEmotions | null> {
  const { data, error } = await admin
    .from("message_emotions")
    .select(
      "primary_emotion, primary_emotions, secondary_emotions, underlying_need, needs, emotion_intensities, confidence_score, is_ambiguous, explanation, conversation_stage, theme_repeat_count, user_id",
    )
    .eq("message_id", messageId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") {
    if (error) logFnError("extract-emotions", "load_existing", error);
    return null;
  }

  const owner = (data as { user_id?: unknown }).user_id;
  if (owner !== userId) return null;

  return toExtracted(data);
}

function toExtracted(row: unknown): ExtractedEmotions | null {
  if (!row || typeof row !== "object") return null;
  return sanitizeExtract(row as Record<string, unknown>);
}

function emotionListForPrompt(): string {
  return [...ALLOWED_EMOTIONS].join(", ");
}

function needListForPrompt(): string {
  return [...ALLOWED_NEEDS].join(", ");
}

function extractionPrompt(messageText: string): string {
  return `You are an emotion extraction system trained on Vedic wisdom and nonviolent communication.

Rules:
- primary_emotions: the 1–2 dominant felt senses or coverings. Prefer a covering (shame, denial, shielding_manager, etc.) when the message shows a protective pattern; otherwise use an everyday feeling.
- secondary_emotions: 0–3 supporting tones that are present but not dominant. Never duplicate primary.
- needs: 1–3 unmet NVC needs underneath (not strategies).
- Intensities (calibrate carefully):
  1 = faint hint / hedged ("a bit", "kinda")
  2 = mild but clear
  3 = solid, unmistakable
  4 = strong / pressing
  5 = overwhelming / flooding
- confidence_score: 0.8–1.0 when wording is clear; 0.5–0.79 when mixed; below 0.5 when sarcastic, minimal, contradictory, or mostly factual with little affect.
- Use ONLY allowlisted tokens (snake_case). Do not invent labels.

Few-shot examples (anonymized). Intensities shown for calibration:

Message: "I feel like I'm never good enough, no matter how hard I try."
primary: shame, inadequacy | secondary: (none) | needs: self_acceptance, competence
intensities: shame:4, inadequacy:3 | confidence: 0.9

Message: "I'm so tired of always being the one who has to reach out and make plans."
primary: resentment, loneliness | secondary: weariness | needs: reciprocity, consideration
intensities: resentment:4, loneliness:3, weariness:3 | confidence: 0.88

Message: "I keep telling myself I'm fine, but I freeze whenever anyone asks how I really am."
primary: denial, fear | secondary: numbness | needs: safety, authenticity
intensities: denial:4, fear:3, numbness:2 | confidence: 0.84

Message: "Everyone else seems to have it figured out. I just feel stuck and invisible."
primary: envy, invisibility | secondary: inadequacy | needs: belonging, recognition
intensities: envy:3, invisibility:4, inadequacy:3 | confidence: 0.86

Message: "I say yes to everything so nobody gets upset, then I resent it later."
primary: shielding_manager | secondary: resentment, fear | needs: autonomy, authenticity, peace
intensities: shielding_manager:4, resentment:3, fear:2 | confidence: 0.87

Message: "I keep telling myself to just surrender and that it's all illusion, but my chest still tightens."
primary: spiritual_bypass | secondary: anxiety, denial | needs: authenticity, peace
intensities: spiritual_bypass:4, anxiety:3, denial:2 | confidence: 0.85

Message: "What's the point of trying again? Nothing ever changes for me."
primary: resignation | secondary: helplessness, sadness | needs: meaning, purpose, support
intensities: resignation:4, helplessness:3, sadness:3 | confidence: 0.88

Message: "Part of me wants to open up and part of me wants to shut everyone out."
primary: multipersona | secondary: fear, longing | needs: safety, connection, authenticity
intensities: multipersona:4, fear:3, longing:3 | confidence: 0.83

Now extract from this message:
"${messageText}"

Return:
1. primary_emotions — 1–2 from: ${emotionListForPrompt()}
2. secondary_emotions — 0–3 from the same list (no overlap with primary)
3. needs — 1–3 from: ${needListForPrompt()}
4. emotion_intensities — every identified emotion → 1–5 using the scale above
5. confidence_score — 0–1

Privacy: never invent names/events; never copy long quotes from the message.

RESPOND ONLY WITH VALID JSON:
{
  "primary_emotions": ["string"],
  "secondary_emotions": ["string"],
  "needs": ["string"],
  "emotion_intensities": {"shame": 4, "inadequacy": 3},
  "confidence_score": 0.85
}`;
}

function explanationPrompt(
  messageText: string,
  extracted: ExtractedEmotions,
): string {
  const emotions = [
    ...extracted.primary_emotions,
    ...extracted.secondary_emotions,
  ].join(", ");
  const needs = extracted.needs.join(", ");
  return `You previously extracted emotions and needs from this user message (context only — do NOT repeat or paraphrase the full message):
"${messageText}"

Extracted emotions: ${emotions || "none"}
Extracted needs: ${needs || "none"}

Write a short thematic rationale:
- Why these emotions? Cite at most 1–2 phrase fragments of ≤5 words each, or describe sentiment themes without quoting.
- Why these needs? Name the clues as themes (e.g. "reaching first", "never measuring up"), not story details.
- No names, places, dates, phone numbers, emails, or full-sentence quotes.

Respond ONLY with valid JSON:
{
  "explanation": "2–4 short sentences. Thematic only."
}`;
}

function reconsiderationPrompt(
  messageText: string,
  extracted: ExtractedEmotions,
): string {
  return `Your confidence in this extraction is quite low at ${extracted.confidence_score}.

Original message (context only; do not quote at length):
"${messageText}"

Previous extraction JSON:
${JSON.stringify({
    primary_emotions: extracted.primary_emotions,
    secondary_emotions: extracted.secondary_emotions,
    needs: extracted.needs,
    emotion_intensities: extracted.emotion_intensities,
    confidence_score: extracted.confidence_score,
  })}

- Prefer a clearer primary emotion/need if the wording supports it.
- If still unclear (sarcasm, mixed signals, thin affect), keep confidence_score below 0.5 and explain why thematically in ambiguity_note.
- Re-check intensities on the 1–5 scale (1 faint … 5 overwhelming).
- Use only allowlisted snake_case tokens.

RESPOND ONLY WITH VALID JSON:
{
  "primary_emotions": ["string"],
  "secondary_emotions": ["string"],
  "needs": ["string"],
  "emotion_intensities": {"shame": 4},
  "confidence_score": 0.4,
  "ambiguity_note": "optional short thematic note, no PII"
}`;
}

async function callOpenAI(messageText: string): Promise<ExtractedEmotions> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("missing_key");
  }
  if (!OPENAI_COMPLETIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  let extracted = await openAIJson(
    apiKey,
    extractionPrompt(messageText),
    350,
  );
  let result = parseExtraction(extracted);
  if (!result) throw new Error("parse");

  // Low confidence → reconsideration; still low → ambiguous.
  // Run before explanation so the stored rationale matches final labels.
  let ambiguityNote: string | null = null;
  if (result.confidence_score < CONFIDENCE_THRESHOLD) {
    try {
      const reconsideredRaw = await openAIJson(
        apiKey,
        reconsiderationPrompt(messageText, result),
        350,
      );
      const reconsidered = parseExtraction(reconsideredRaw);
      ambiguityNote = parseAmbiguityNote(reconsideredRaw);
      if (reconsidered) {
        result = {
          ...reconsidered,
          is_ambiguous: reconsidered.confidence_score < CONFIDENCE_THRESHOLD,
        };
      } else {
        result = { ...result, is_ambiguous: true };
      }
    } catch (error) {
      logFnError("extract-emotions", "reconsider", error);
      result = { ...result, is_ambiguous: true };
    }
  } else {
    result = { ...result, is_ambiguous: false };
  }

  // Explanation follow-up on the settled extraction (enrichment only).
  try {
    const explanationRaw = await openAIJson(
      apiKey,
      explanationPrompt(messageText, result),
      280,
    );
    let explanation = parseExplanation(explanationRaw);
    if (result.is_ambiguous && ambiguityNote) {
      explanation = mergeExplanation(explanation, ambiguityNote);
    }
    if (explanation) {
      result = { ...result, explanation };
    }
  } catch (error) {
    logFnError("extract-emotions", "explanation", error);
    if (result.is_ambiguous && ambiguityNote) {
      result = { ...result, explanation: ambiguityNote };
    }
  }

  return result;
}

async function openAIJson(
  apiKey: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(OPENAI_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error("upstream");
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("parse");
  }
  return content;
}

function parseExtraction(raw: string): ExtractedEmotions | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return sanitizeExtract(parsed as Record<string, unknown>);
}

function parseExplanation(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  return sanitizeExplanation(record.explanation);
}

function parseAmbiguityNote(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  return sanitizeExplanation(record.ambiguity_note);
}

function mergeExplanation(
  explanation: string | null,
  ambiguityNote: string | null,
): string | null {
  const parts = [explanation, ambiguityNote].filter(
    (part): part is string => typeof part === "string" && part.length >= 8,
  );
  if (parts.length === 0) return null;
  return sanitizeExplanation(parts.join(" "));
}

function sanitizeExplanation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let cleaned = value.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // Strip obvious PII / contact / URLs before storing thematic notes.
  cleaned = cleaned
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(
      /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/g,
      "[redacted]",
    )
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted]")
    .replace(/\bwww\.\S+/gi, "[redacted]");

  // Collapse long quoted spans (keep short fragments ≤5 words).
  cleaned = cleaned.replace(/["“”']([^"“”']+)["“”']/g, (_m, inner: string) => {
    const words = String(inner).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    if (words.length > 5) return "a short phrase";
    return `"${words.join(" ")}"`;
  });

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length < 8) return null;
  return cleaned.slice(0, MAX_EXPLANATION_LEN);
}

function sanitizeExtract(
  record: Record<string, unknown>,
): ExtractedEmotions | null {
  // Support both new arrays and legacy single fields.
  const primarySource = Array.isArray(record.primary_emotions)
    ? record.primary_emotions
    : record.primary_emotion !== undefined
    ? [record.primary_emotion]
    : [];

  const primaryEmotions = collectEmotionTokens(primarySource, [], 2);
  if (primaryEmotions.length === 0) {
    // Last resort: try normalizing a single primary with fallback.
    const primaryRaw = resolveEmotionToken(record.primary_emotion);
    if (primaryRaw && !looksLikeSentence(record.primary_emotion)) {
      primaryEmotions.push(primaryRaw);
    } else {
      return null;
    }
  }

  const secondaryRaw = Array.isArray(record.secondary_emotions)
    ? record.secondary_emotions
    : [];
  const secondaryEmotions = collectEmotionTokens(
    secondaryRaw,
    primaryEmotions,
    3,
  );

  const needsSource = Array.isArray(record.needs)
    ? record.needs
    : record.underlying_need !== undefined
    ? [record.underlying_need]
    : [];
  const needs = collectNeedTokens(needsSource, 3);
  if (needs.length === 0) {
    const need = resolveNeedToken(record.underlying_need);
    if (need && !looksLikeSentence(record.underlying_need)) {
      needs.push(need);
    } else {
      needs.push(FALLBACK_NEED);
    }
  }

  const allEmotions = [...primaryEmotions, ...secondaryEmotions];
  const intensities = sanitizeIntensities(
    record.emotion_intensities,
    allEmotions,
  );

  const confidence = parseConfidence(record.confidence_score);
  if (confidence === null) return null;

  let isAmbiguous = false;
  if (typeof record.is_ambiguous === "boolean") {
    isAmbiguous = record.is_ambiguous;
  }

  const explanation = sanitizeExplanation(record.explanation);

  const conversationStage = parseStage(record.conversation_stage);
  const themeRepeatCount = parseThemeRepeatCount(record.theme_repeat_count);

  return {
    primary_emotion: primaryEmotions[0] ?? FALLBACK_EMOTION,
    primary_emotions: primaryEmotions,
    secondary_emotions: secondaryEmotions,
    underlying_need: needs[0] ?? FALLBACK_NEED,
    needs,
    emotion_intensities: intensities,
    confidence_score: confidence,
    is_ambiguous: isAmbiguous,
    explanation,
    conversation_stage: conversationStage,
    theme_repeat_count: themeRepeatCount,
  };
}

function parseStage(value: unknown): Stage {
  const stages: Stage[] = [
    "meeting",
    "naming_emotion",
    "naming_need",
    "exploring_origin",
    "surfacing_myth",
    "challenging_belief",
    "integration",
    "closed",
  ];
  if (typeof value === "string" && stages.includes(value as Stage)) {
    return value as Stage;
  }
  return "meeting";
}

function parseThemeRepeatCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

function collectEmotionTokens(
  source: unknown[],
  exclude: string[],
  max: number,
): string[] {
  const out: string[] = [];
  for (const item of source) {
    if (looksLikeSentence(item)) continue;
    const token = resolveEmotionToken(item);
    if (!token) continue;
    if (exclude.includes(token) || out.includes(token)) continue;
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

function collectNeedTokens(source: unknown[], max: number): string[] {
  const out: string[] = [];
  for (const item of source) {
    if (looksLikeSentence(item)) continue;
    const token = resolveNeedToken(item);
    if (!token) continue;
    if (out.includes(token)) continue;
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

function resolveEmotionToken(value: unknown): string | null {
  const token = normalizeToken(value);
  if (!token) return null;
  if (ALLOWED_EMOTIONS.has(token)) return token;
  const aliased = EMOTION_ALIASES[token];
  if (aliased && ALLOWED_EMOTIONS.has(aliased)) return aliased;
  return null;
}

function resolveNeedToken(value: unknown): string | null {
  const token = normalizeToken(value);
  if (!token) return null;
  if (ALLOWED_NEEDS.has(token)) return token;
  const aliased = NEED_ALIASES[token];
  if (aliased && ALLOWED_NEEDS.has(aliased)) return aliased;
  return null;
}

function sanitizeIntensities(
  value: unknown,
  emotions: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  // Resolve aliased keys (e.g. "anxious": 4 → anxiety) before lookup.
  const resolvedRaw: Record<string, unknown> = {};
  for (const [key, score] of Object.entries(raw)) {
    const token = resolveEmotionToken(key);
    if (!token) continue;
    if (resolvedRaw[token] === undefined) resolvedRaw[token] = score;
  }

  for (const emotion of emotions) {
    const score = parseIntensity(resolvedRaw[emotion] ?? raw[emotion]);
    out[emotion] = score ?? 3;
  }

  // Ignore unknown keys; only store allowlisted emotions we already accepted.
  return out;
}

function parseIntensity(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) n = value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === null) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function normalizeToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/[{}]/g, "").trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_TOKEN_LEN) return "";
  const token = trimmed.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  if (!TOKEN_RE.test(token)) return "";
  return token;
}

function looksLikeSentence(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length > MAX_SENTENCE_CHARS) return true;
  if (/[.!?]/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 3;
}

function parseConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0 || value > 1) return null;
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    return Math.round(n * 100) / 100;
  }
  return null;
}

function stripFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}
