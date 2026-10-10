import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  DOST_CORE_PROMPT,
  buildPersonalityContext,
  type PersonalityPromptProfile,
} from "../_shared/systemPrompt.ts";
import { DOST_SAMPLE_CONVERSATIONS } from "../_shared/sampleConversations.ts";
import { buildMentorBoxesSection } from "../_shared/mentorBoxes.ts";
import { resolveTurnStage } from "../_shared/conversationStage.ts";
import {
  parseReplyLanguage,
  replyLanguageInstruction,
} from "../_shared/replyLanguage.ts";
import {
  generateSuggestionChips,
  type Stage,
} from "../_shared/suggestionChips.ts";

// Helpers live in this file so dashboard deploy (this folder only) can bundle.
// CLI deploy of other functions still uses supabase/functions/_shared/safe.ts.

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

function isMissingRelation(error: unknown): boolean {
  const code = pgCode(error);
  if (code === "42P01" || code === "PGRST205") return true;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const lower = message.toLowerCase();
      if (lower.includes("schema cache")) return true;
      if (lower.includes("does not exist")) return true;
    }
  }
  return false;
}

function isInfraDbError(error: unknown): boolean {
  if (isMissingRelation(error)) return true;
  const code = pgCode(error);
  if (code === "42501" || code === "PGRST301") return true;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const lower = message.toLowerCase();
      if (lower.includes("permission denied")) return true;
      if (lower.includes("insufficient privilege")) return true;
    }
  }
  return false;
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
  const GENERIC_ERROR = "Something went wrong.";
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

const MAX_MESSAGE_LEN = 2000;
/** Wait for extract-emotions so labels are usually stored before the reply.
 *  If it errors or times out, chat still replies (must not block the user).
 *  Slightly longer than before: extract may do explanation + low-confidence reconsideration. */
const EXTRACT_EMOTIONS_TIMEOUT_MS = 14_000;
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const EMBED_RATE_LIMIT_PER_HOUR = 100;
const EMBED_RATE_WINDOW_MS = 60 * 60 * 1000;
const HISTORY_LIMIT = 20;
const EMBEDDING_DIMS = 1536;
const MATCH_THRESHOLD = 0.7;
const MATCH_COUNT = 3;
const KB_TITLE_MAX = 200;
const KB_CONTENT_MAX = 4000;
const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";

/** Client-selected emotional patterns (not diagnoses). Allowlisted server-side. */
const EMOTIONAL_STATE_TOKENS = new Set([
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
]);

const EMOTIONAL_STATE_GUIDANCE: Record<string, string> = {
  shame:
    "The person selected the pattern 'shame'. Meet the tender sense of not-enoughness. Speak to the need for dignity and belonging. Never say they 'have shame' as a label.",
  anger_grief:
    "The person selected 'anger/grief'. Honor heat and loss together. Help them name what hurt without fixing. Never diagnose anger disorders.",
  multipersona:
    "The person selected 'multipersona' — complex or fragmented parts. Acknowledge different voices gently. Never pathologize identity.",
  shielding_manager:
    "The person selected 'shielding manager' — people-pleasing or control as protection. Softly notice the protector; speak to the need for safety. Never call them a people-pleaser as a verdict.",
  victim_personality:
    "The person selected a 'victim personality' pattern — feeling powerless or repeatedly wronged. Recognize the pain and the unmet need for fairness/agency. NEVER say 'you have a victim personality' or label them.",
  resignation:
    "The person selected 'resignation'. Meet the quiet heaviness. Speak to hope without cheerleading. Never shame them for giving up.",
  denial:
    "The person selected 'denial'. Stay gentle; don't force confrontation. Invite curiosity about what 'fine' might be covering.",
  envy:
    "The person selected 'envy'. Meet the longing underneath comparison. Speak to the unmet need without moralizing.",
  pride:
    "The person selected 'pride' — needing to handle it alone. Honor strength while inviting softness. Never accuse them of arrogance.",
  greed:
    "The person selected 'greed' — grasping or never feeling full. Speak to emptiness and enoughness without judgment.",
  lust:
    "The person selected 'lust' — strong craving or longing. Stay grounded and non-judgmental. Speak to desire and connection needs; never shame.",
  addiction:
    "The person selected 'addiction' as a pattern of pull. Stay compassionate; speak to what the pull soothes. Never diagnose substance use disorders; never lecture.",
  detachment:
    "The person selected 'detachment' — numbing or stepping back. Honor the distance as protection; gently invite feeling when ready.",
  spiritual_bypass:
    "The person selected 'spiritual bypass' — using elevated language to skip feeling. Gently invite the body/emotion underneath without mocking their spirituality.",
  scarcity:
    "The person selected 'scarcity' — a sense that there is never enough time, love, or safety. Meet the fear underneath without toxic positivity. Speak to enoughness and belonging.",
  lamentation:
    "The person selected 'lamentation' — deep sorrow for what was lost or never was. Honor the grief without rushing to fix or reframe. Hold space for what cannot be undone.",
};

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_INVALID = "Invalid message.";
const GENERIC_RATE_LIMIT = "Too many messages. Please wait a moment.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Chat is temporarily unavailable.";

const VALID_CONVERSATION_STAGES = new Set<string>([
  "meeting",
  "naming_emotion",
  "naming_need",
  "exploring_origin",
  "surfacing_myth",
  "challenging_belief",
  "integration",
  "closed",
]);

const RAG_GROUNDING_INSTRUCTION =
  "Reference material below is for you to draw wisdom from silently. Do not quote it, cite it, or teach from it. Let it shape your reflection.";

const AMBIGUOUS_EMOTION_GUIDANCE =
  "The emotional tone of this message is a bit ambiguous. Acknowledge that gently, and invite the user to share more about their experience if they feel comfortable. Don't push or pry, but create an open space for exploration. Prefer curiosity over naming a firm emotion.";

/** Labels extract-emotions may return — keep chat injection allowlisted. */
const EXTRACTED_EMOTION_TOKENS = new Set([
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

const EXTRACTED_NEED_TOKENS = new Set([
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

/** Snapshot returned by extract-emotions (labels only — never message text). */
type EmotionSnapshot = {
  primary_emotion: string;
  primary_emotions: string[];
  secondary_emotions: string[];
  underlying_need: string;
  needs: string[];
  emotion_intensities: Record<string, number>;
  confidence_score: number;
  is_ambiguous: boolean;
  explanation: string | null;
  conversation_stage: Stage;
  theme_repeat_count: number;
};

type ChatTurnExtras = {
  suggested_emotions: string[];
  suggested_needs: string[];
  conversation_stage: Stage;
};

function buildChatPayload(
  reply: string,
  extras: ChatTurnExtras,
  warning?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reply,
    suggested_emotions: extras.suggested_emotions,
    suggested_needs: extras.suggested_needs,
    conversation_stage: extras.conversation_stage,
    ...warning,
  };
}

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "chat");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "chat");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("chat", "env", new Error("MissingEnv"));
      return json(502, { error: GENERIC_ERROR, step: "env" });
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

    const parsed = parseBody(body);
    if (!parsed.ok) {
      return json(400, { error: GENERIC_INVALID });
    }

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rate = await applyRateLimit(admin, userId);
    if (rate === "limited") {
      return json(429, { error: GENERIC_RATE_LIMIT });
    }

    const [history, profile, memory, personalityProfile, adminAnswers] = await Promise.all([
      loadHistory(userClient, userId),
      loadProfile(userClient, userId),
      loadMemory(userClient, userId),
      loadPersonalityProfile(userClient, userId),
      loadAdminOnboardingAnswers(userClient, userId),
    ]);

    const { data: userRow, error: userInsertError } = await admin
      .from("conversations")
      .insert({ user_id: userId, role: "user", content: parsed.message })
      .select("id")
      .single();
    if (userInsertError || typeof userRow?.id !== "string" || !userRow.id) {
      logFnError("chat", "insert_user", userInsertError ?? new Error("missing_id"));
      if (isMissingRelation(userInsertError)) {
        return json(502, {
          error:
            "Missing conversations table — run migration 014_conversations.sql in Supabase SQL Editor.",
          step: "insert_user",
        });
      }
      return json(502, {
        error: GENERIC_ERROR,
        step: "insert_user",
        code: pgCode(userInsertError),
      });
    }
    const userMessageId = userRow.id;

    // Extract emotions first (timeout-bounded), then RAG with emotion-aware query.
    // On extract error/timeout the reply still proceeds. Assistant messages are never sent.
    const emotionSnapshot = await awaitEmotionExtraction({
      supabaseUrl: env.url,
      anonKey: env.anonKey,
      jwt,
      userId,
      messageId: userMessageId,
      messageText: parsed.message,
    });

    if (parsed.selectedEmotion || parsed.selectedNeed) {
      await storeSelectedChip(admin, userId, userMessageId, {
        selected_emotion: parsed.selectedEmotion,
        selected_need: parsed.selectedNeed,
      });
    }

    const selectedEmotion =
      parsed.selectedEmotion ??
      (await loadRecentSelectedEmotion(admin, userId, userMessageId));
    const conversationStage = resolveTurnStage(
      emotionSnapshot?.conversation_stage ?? "meeting",
      {
        selectedEmotion: parsed.selectedEmotion,
        selectedNeed: parsed.selectedNeed,
      },
    );
    const { suggested_emotions: suggestedEmotions, suggested_needs: suggestedNeeds } =
      generateSuggestionChips({
        conversation_stage: conversationStage,
        primary_emotion: emotionSnapshot?.primary_emotion,
        secondary_emotions: emotionSnapshot?.secondary_emotions,
        confidence_score: emotionSnapshot?.confidence_score,
        selected_emotion: selectedEmotion,
      });
    const turnExtras: ChatTurnExtras = {
      suggested_emotions: suggestedEmotions,
      suggested_needs: suggestedNeeds,
      conversation_stage: conversationStage,
    };

    if (
      emotionSnapshot &&
      (suggestedEmotions.length > 0 || suggestedNeeds.length > 0)
    ) {
      await storeSuggestedChips(admin, userId, userMessageId, {
        suggested_emotions: suggestedEmotions,
        suggested_needs: suggestedNeeds,
      });
    }

    const kbBlock = await retrieveKbBlock(
      admin,
      userId,
      buildKbQuery(parsed.message, emotionSnapshot),
      emotionSnapshot,
    );
    const systemPrompt = buildSystemPrompt(
      profile,
      kbBlock,
      memory,
      parsed.emotionalState,
      emotionSnapshot
        ? { ...emotionSnapshot, conversation_stage: conversationStage }
        : null,
      personalityProfile,
      parsed.language,
      adminAnswers,
    );

    let assistantText: string;
    try {
      assistantText = await callOpenAI(systemPrompt, history, parsed.message);
    } catch (openAiError) {
      logFnError("chat", "openai", openAiError);
      const detail = describeOpenAiFailure(openAiError);
      return json(502, {
        error: detail.message,
        step: "openai",
        code: detail.code,
      });
    }

    const { error: insertError } = await admin.from("conversations").insert({
      user_id: userId,
      role: "assistant",
      content: assistantText,
    });
    if (insertError) {
      logFnError("chat", "insert_assistant", insertError);
      // Still return the reply — user can chat; history may not persist until DB is fixed.
      return json(200, buildChatPayload(assistantText, turnExtras, {
        warning: "history_not_saved",
        step: "insert_assistant",
        code: pgCode(insertError),
      }));
    }

    return json(200, buildChatPayload(assistantText, turnExtras));
  } catch (error) {
    logFnError("chat", "uncaught", error);
    return json(502, { error: GENERIC_ERROR, step: "uncaught" });
  }
}

function parseBody(
  body: unknown,
):
  | {
    ok: true;
    message: string;
    emotionalState: string | null;
    selectedEmotion: string | null;
    selectedNeed: string | null;
    language: string;
  }
  | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const record = body as Record<string, unknown>;
  const raw = record.message;
  if (typeof raw !== "string") return { ok: false };

  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_MESSAGE_LEN) return { ok: false };

  let emotionalState: string | null = null;
  const emotionRaw = record.emotional_state;
  if (typeof emotionRaw === "string" && emotionRaw.trim()) {
    const token = emotionRaw.trim().toLowerCase();
    if (EMOTIONAL_STATE_TOKENS.has(token)) {
      emotionalState = token;
    }
  }

  let selectedEmotion: string | null = null;
  const selectedEmotionRaw = record.selected_emotion;
  if (typeof selectedEmotionRaw === "string" && selectedEmotionRaw.trim()) {
    const token = allowToken(selectedEmotionRaw, EXTRACTED_EMOTION_TOKENS);
    if (token) selectedEmotion = token;
  }

  let selectedNeed: string | null = null;
  const selectedNeedRaw = record.selected_need;
  if (typeof selectedNeedRaw === "string" && selectedNeedRaw.trim()) {
    const token = allowToken(selectedNeedRaw, EXTRACTED_NEED_TOKENS);
    if (token) selectedNeed = token;
  }

  return {
    ok: true,
    message: trimmed,
    emotionalState,
    selectedEmotion,
    selectedNeed,
    language: parseReplyLanguage(record.language),
  };
}

/**
 * Invokes extract-emotions over HTTP (same project) with the caller's JWT.
 * user_id is the authenticated id from getUser — never a client-supplied spoof.
 * Never logs message_text or other PII.
 *
 * Timing: awaited so rows are usually ready before the reply; a short timeout
 * and any non-OK response still resolve so chat is not blocked (Step 7).
 */
async function awaitEmotionExtraction(opts: {
  supabaseUrl: string;
  anonKey: string;
  jwt: string;
  userId: string;
  messageId: string;
  messageText: string;
}): Promise<EmotionSnapshot | null> {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/extract-emotions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_EMOTIONS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.jwt}`,
        apikey: opts.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_id: opts.messageId,
        message_text: opts.messageText,
        user_id: opts.userId,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        "chat",
        "extract_emotions",
        opts.userId,
        opts.messageId,
        response.status,
      );
      return null;
    }

    let snapshot: EmotionSnapshot | null = null;
    try {
      const payload: unknown = await response.json();
      snapshot = parseEmotionSnapshot(payload);
    } catch {
      // Success body is optional; extraction may already be persisted server-side.
    }

    const primary =
      snapshot?.primary_emotions[0] ??
      snapshot?.primary_emotion ??
      "-";
    // Step 4.2 metrics (labels/scores only — never message text).
    console.log(
      "chat",
      "extract_emotions",
      opts.userId,
      opts.messageId,
      primary,
      snapshot?.confidence_score ?? "-",
      snapshot?.is_ambiguous ? "ambiguous" : "clear",
    );
    return snapshot;
  } catch (error) {
    const timedOut =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");
    const step = timedOut ? "extract_emotions_timeout" : "extract_emotions";
    logFnError("chat", step, error);
    console.error("chat", step, opts.userId, opts.messageId);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseEmotionSnapshot(payload: unknown): EmotionSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const primaryEmotions = asTokenArray(
    record.primary_emotions,
    2,
    EXTRACTED_EMOTION_TOKENS,
  );
  const secondaryEmotions = asTokenArray(
    record.secondary_emotions,
    3,
    EXTRACTED_EMOTION_TOKENS,
  ).filter((token) => !primaryEmotions.includes(token));
  const needs = asTokenArray(record.needs, 3, EXTRACTED_NEED_TOKENS);

  const legacyPrimary =
    typeof record.primary_emotion === "string"
      ? allowToken(record.primary_emotion, EXTRACTED_EMOTION_TOKENS)
      : "";
  const legacyNeed =
    typeof record.underlying_need === "string"
      ? allowToken(record.underlying_need, EXTRACTED_NEED_TOKENS)
      : "";

  if (primaryEmotions.length === 0 && legacyPrimary) {
    primaryEmotions.push(legacyPrimary);
  }
  if (needs.length === 0 && legacyNeed) {
    needs.push(legacyNeed);
  }
  if (primaryEmotions.length === 0) return null;

  const knownEmotions = new Set([...primaryEmotions, ...secondaryEmotions]);
  const intensities: Record<string, number> = {};
  if (
    record.emotion_intensities &&
    typeof record.emotion_intensities === "object" &&
    !Array.isArray(record.emotion_intensities)
  ) {
    for (const [key, value] of Object.entries(
      record.emotion_intensities as Record<string, unknown>,
    )) {
      const label = allowToken(key, EXTRACTED_EMOTION_TOKENS);
      if (!label || !knownEmotions.has(label)) continue;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) continue;
      const rounded = Math.round(n);
      if (rounded < 1 || rounded > 5) continue;
      intensities[label] = rounded;
    }
  }

  const confidenceRaw = record.confidence_score;
  let confidence = 0;
  if (typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)) {
    confidence = Math.min(1, Math.max(0, confidenceRaw));
  }

  // Thematic notes only — strip contact-ish noise; keep short for prompt safety.
  let explanation: string | null = null;
  if (typeof record.explanation === "string") {
    const scrubbed = sanitizeInject(record.explanation, 280)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
      .replace(/\bhttps?:\/\/\S+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    explanation = scrubbed.length >= 8 ? scrubbed : null;
  }

  return {
    primary_emotion: primaryEmotions[0] ?? legacyPrimary,
    primary_emotions: primaryEmotions,
    secondary_emotions: secondaryEmotions,
    underlying_need: needs[0] ?? legacyNeed,
    needs,
    emotion_intensities: intensities,
    confidence_score: Math.round(confidence * 100) / 100,
    is_ambiguous: record.is_ambiguous === true,
    explanation,
    conversation_stage: parseConversationStage(record.conversation_stage),
    theme_repeat_count: parseThemeRepeatCount(record.theme_repeat_count),
  };
}

function parseConversationStage(value: unknown): Stage {
  if (typeof value === "string" && VALID_CONVERSATION_STAGES.has(value)) {
    return value as Stage;
  }
  return "meeting";
}

function parseThemeRepeatCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.floor(value)));
  }
  return 0;
}

async function loadRecentSelectedEmotion(
  admin: SupabaseClient,
  userId: string,
  excludeMessageId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("message_emotions")
    .select("selected_emotion")
    .eq("user_id", userId)
    .neq("message_id", excludeMessageId)
    .not("selected_emotion", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logFnError("chat", "recent_selected_emotion", error);
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const raw = (data as { selected_emotion?: unknown }).selected_emotion;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const token = allowToken(raw, EXTRACTED_EMOTION_TOKENS);
  return token || null;
}

async function storeSelectedChip(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
  selection: {
    selected_emotion: string | null;
    selected_need: string | null;
  },
): Promise<void> {
  const update: Record<string, string> = {};
  if (selection.selected_emotion) {
    update.selected_emotion = selection.selected_emotion;
  }
  if (selection.selected_need) {
    update.selected_need = selection.selected_need;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await admin
    .from("message_emotions")
    .update(update)
    .eq("user_id", userId)
    .eq("message_id", messageId);

  if (error) {
    logFnError("chat", "store_selected_chip", error);
  }
}

async function storeSuggestedChips(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
  chips: { suggested_emotions: string[]; suggested_needs: string[] },
): Promise<void> {
  const { error } = await admin
    .from("message_emotions")
    .update({
      suggested_emotions: chips.suggested_emotions,
      suggested_needs: chips.suggested_needs,
    })
    .eq("user_id", userId)
    .eq("message_id", messageId);

  if (error) {
    logFnError("chat", "store_suggested_chips", error);
  }
}

function allowToken(value: string, allow: Set<string>): string {
  const token = sanitizeInject(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (!token || !allow.has(token)) return "";
  return token;
}

function asTokenArray(
  value: unknown,
  max: number,
  allow: Set<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const token = allowToken(item, allow);
    if (!token || out.includes(token)) continue;
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

function buildKbQuery(
  message: string,
  emotions: EmotionSnapshot | null,
): string {
  if (!emotions) return message;
  const themes = [
    ...emotions.primary_emotions,
    ...emotions.secondary_emotions,
    ...emotions.needs,
  ]
    .map((t) => sanitizeInject(t, 40))
    .filter(Boolean);
  if (themes.length === 0) return message;
  // Append compact theme tags so embedding retrieval can lean on emotion/need context.
  return `${message}\n\nThemes: ${themes.join(", ")}`;
}

type RateResult = "ok" | "limited";

async function applyRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<RateResult> {
  const { data: row, error: readError } = await admin
    .from("chat_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  // Missing table / grants must not block chat (same fail-open as export-data).
  if (readError) {
    logFnError("chat", "rate_read", readError);
    return "ok";
  }

  const now = Date.now();
  const windowStart = row?.window_start
    ? Date.parse(String(row.window_start))
    : NaN;
  const expired =
    !row ||
    !Number.isFinite(windowStart) ||
    now - windowStart >= RATE_WINDOW_MS;

  if (expired) {
    const { error } = await admin.from("chat_rate_limits").upsert({
      user_id: userId,
      window_start: new Date(now).toISOString(),
      count: 1,
    });
    if (error) {
      logFnError("chat", "rate_upsert", error);
      if (!isInfraDbError(error)) {
        // Non-infra write failure: still allow the message through.
      }
    }
    return "ok";
  }

  const count = typeof row.count === "number" ? row.count : 0;
  if (count >= RATE_LIMIT_PER_MINUTE) {
    return "limited";
  }

  const { error } = await admin
    .from("chat_rate_limits")
    .update({ count: count + 1 })
    .eq("user_id", userId);

  if (error) {
    logFnError("chat", "rate_update", error);
  }
  return "ok";
}

type EmbedRateResult = "ok" | "limited" | "unavailable";

async function applyEmbeddingRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<EmbedRateResult> {
  const { data: row, error: readError } = await admin
    .from("embedding_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) return "unavailable";

  const now = Date.now();
  const windowStart = row?.window_start
    ? Date.parse(String(row.window_start))
    : NaN;
  const expired =
    !row ||
    !Number.isFinite(windowStart) ||
    now - windowStart >= EMBED_RATE_WINDOW_MS;

  if (expired) {
    const { error } = await admin.from("embedding_rate_limits").upsert({
      user_id: userId,
      window_start: new Date(now).toISOString(),
      count: 1,
    });
    return error ? "unavailable" : "ok";
  }

  const count = typeof row.count === "number" ? row.count : 0;
  if (count >= EMBED_RATE_LIMIT_PER_HOUR) {
    return "limited";
  }

  const { error } = await admin
    .from("embedding_rate_limits")
    .update({ count: count + 1 })
    .eq("user_id", userId);

  return error ? "unavailable" : "ok";
}

async function retrieveKbBlock(
  admin: SupabaseClient,
  userId: string,
  message: string,
  emotions: EmotionSnapshot | null = null,
): Promise<string> {
  try {
    const embedRate = await applyEmbeddingRateLimit(admin, userId);
    if (embedRate === "limited") return "";

    const embedding = await embedUserMessage(message);
    if (!embedding) return "";

    const matches = await matchModules(admin, embedding);
    if (matches.length === 0) return "";

    return formatKbBlock(matches, emotions);
  } catch {
    return "";
  }
}

async function embedUserMessage(message: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) return null;
  if (!OPENAI_EMBEDDINGS_URL.startsWith("https://")) return null;

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBED_MODEL,
      input: message,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!response.ok) return null;

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const embedding = (first as { embedding?: unknown }).embedding;
  if (!isEmbedding(embedding)) return null;

  return embedding;
}

type ModuleMatch = { title: string; content: string };

async function matchModules(
  admin: SupabaseClient,
  embedding: number[],
): Promise<ModuleMatch[]> {
  const params = {
    match_threshold: MATCH_THRESHOLD,
    match_count: MATCH_COUNT,
  };

  const first = await admin.rpc("match_modules", {
    ...params,
    query_embedding: embedding,
  });

  if (!first.error && Array.isArray(first.data)) {
    return parseMatches(first.data);
  }

  const second = await admin.rpc("match_modules", {
    ...params,
    query_embedding: `[${embedding.join(",")}]`,
  });

  if (second.error || !Array.isArray(second.data)) return [];
  return parseMatches(second.data);
}

function parseMatches(data: unknown[]): ModuleMatch[] {
  const matches: ModuleMatch[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!title && !content) continue;
    matches.push({ title, content });
  }
  return matches;
}

function formatKbBlock(
  matches: ModuleMatch[],
  emotions: EmotionSnapshot | null = null,
): string {
  const parts = matches.map((match) => {
    const title = sanitizeInject(match.title, KB_TITLE_MAX);
    const content = sanitizeInject(match.content, KB_CONTENT_MAX);
    return [title, content].filter(Boolean).join("\n");
  });
  const body = parts.filter(Boolean).join("\n\n");
  if (!body) return "";

  const themes = emotions
    ? [
        ...emotions.primary_emotions,
        ...emotions.secondary_emotions.slice(0, 2),
        ...emotions.needs.slice(0, 2),
      ]
        .map((t) => sanitizeInject(t, 40))
        .filter(Boolean)
    : [];

  if (themes.length > 0) {
    return [
      `Considering the themes of ${themes.join(", ")}, here are some relevant insights from your knowledge base:`,
      body,
      "Draw on this wisdom gently as you empathize with the user and help them make sense of their experience. Do not quote, cite, or teach from it.",
    ].join("\n");
  }

  return `Relevant reflections from the framework:\n${body}`;
}

function isEmbedding(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMS) return false;
  return value.every((n) => typeof n === "number" && Number.isFinite(n));
}

type HistoryTurn = { role: "user" | "assistant"; content: string };

async function loadHistory(
  userClient: SupabaseClient,
  userId: string,
): Promise<HistoryTurn[]> {
  const { data, error } = await userClient
    .from("conversations")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error || !Array.isArray(data)) return [];

  const turns: HistoryTurn[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const role = row.role === "user" || row.role === "assistant" ? row.role : null;
    const content = typeof row.content === "string" ? row.content : "";
    if (!role || !content) continue;
    turns.push({ role, content });
  }
  return turns.reverse();
}

type ProfileBits = { name: string; intention: string; dosha: string };

async function loadProfile(
  userClient: SupabaseClient,
  userId: string,
): Promise<ProfileBits> {
  const empty = { name: "", intention: "", dosha: "" };
  const { data, error } = await userClient
    .from("profiles")
    .select("name, intention, dosha")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") return empty;

  const doshaRaw = typeof data.dosha === "string" ? data.dosha.toLowerCase() : "";
  const dosha =
    doshaRaw === "vata" ||
    doshaRaw === "pitta" ||
    doshaRaw === "kapha" ||
    doshaRaw === "mixed"
      ? doshaRaw
      : "";

  return {
    name: sanitizeInject(typeof data.name === "string" ? data.name : "", 40),
    intention: sanitizeInject(
      typeof data.intention === "string" ? data.intention : "",
      200,
    ),
    dosha,
  };
}

async function loadPersonalityProfile(
  userClient: SupabaseClient,
  userId: string,
): Promise<PersonalityPromptProfile | null> {
  try {
    const { data, error } = await userClient
      .from("personality_profile")
      .select(
        "dosha_body, dosha_mind, enneagram_type, life_path_number, tcm_element, mbti_type, varna",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data || typeof data !== "object") return null;

    const enneagramRaw = (data as { enneagram_type?: unknown }).enneagram_type;
    const enneagramType =
      typeof enneagramRaw === "number"
        ? enneagramRaw
        : typeof enneagramRaw === "string"
        ? Number(enneagramRaw)
        : null;

    const lifePathRaw = (data as { life_path_number?: unknown }).life_path_number;
    const lifePathNumber =
      typeof lifePathRaw === "number"
        ? lifePathRaw
        : typeof lifePathRaw === "string"
        ? Number(lifePathRaw)
        : null;

    return {
      dosha_body: typeof data.dosha_body === "string" ? data.dosha_body : null,
      dosha_mind: typeof data.dosha_mind === "string" ? data.dosha_mind : null,
      enneagram_type:
        typeof enneagramType === "number" && Number.isFinite(enneagramType)
          ? enneagramType
          : null,
      life_path_number:
        typeof lifePathNumber === "number" && Number.isFinite(lifePathNumber)
          ? lifePathNumber
          : null,
      tcm_element: typeof data.tcm_element === "string" ? data.tcm_element : null,
      mbti_type: typeof data.mbti_type === "string" ? data.mbti_type : null,
      varna: typeof data.varna === "string" ? data.varna : null,
    };
  } catch {
    return null;
  }
}

function sanitizeInject(value: string, max: number): string {
  return value.replace(/[{}]/g, "").trim().slice(0, max);
}

type MemoryBits = { summary: string; recentEmotions: string[] };

async function loadMemory(
  userClient: SupabaseClient,
  userId: string,
): Promise<MemoryBits> {
  const empty: MemoryBits = { summary: "", recentEmotions: [] };
  try {
    const { data, error } = await userClient
      .from("user_memory")
      .select("summary, patterns")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data || typeof data !== "object") return empty;

    const summary =
      typeof data.summary === "string" ? sanitizeInject(data.summary, 800) : "";

    const recentEmotions: string[] = [];
    const patterns = data.patterns;
    if (patterns && typeof patterns === "object" && !Array.isArray(patterns)) {
      const patternRecord = patterns as Record<string, unknown>;
      const patternSources = [
        patternRecord.recent_emotions,
        patternRecord.recentEmotions,
        patternRecord.emotions,
        patternRecord.themes,
      ];
      for (const source of patternSources) {
        const items = Array.isArray(source) ? source : [source];
        for (const item of items) {
          if (typeof item !== "string") continue;
          const emotion = sanitizeInject(item, 40);
          if (
            emotion &&
            !recentEmotions.some(
              (existing) => existing.toLowerCase() === emotion.toLowerCase(),
            )
          ) {
            recentEmotions.push(emotion);
          }
          if (recentEmotions.length >= 5) break;
        }
        if (recentEmotions.length >= 5) break;
      }
    }

    return { summary, recentEmotions };
  } catch {
    return empty;
  }
}

type PromptContext = {
  name: string;
  intention: string;
  dosha: string;
  memory_summary: string;
  recent_emotions: string;
};

function buildUserContextSection(
  profile: ProfileBits,
  memory: MemoryBits,
): string {
  const context: PromptContext = {
    name: profile.name || "Not provided",
    intention: profile.intention || "Not yet known",
    dosha: profile.dosha || "Not yet known",
    memory_summary: memory.summary || "Not yet known",
    recent_emotions: memory.recentEmotions.join(", ") || "Not yet known",
  };

  return [
    "USER CONTEXT (injected per request — use subtly, never announce)",
    `Name: ${context.name}`,
    `Intention: ${context.intention}`,
    `Dosha tendency: ${context.dosha}`,
    `Memory summary: ${context.memory_summary}`,
    `Recent emotional patterns: ${context.recent_emotions}`,
    "Use these to shape tone:",
    "Vata-leaning: more grounding, slower pacing, warmth",
    "Pitta-leaning: cooling, softening, less confrontation",
    "Kapha-leaning: gentle enlivening, encouraging movement",
    "Reference memory and patterns only when genuinely relevant — never force.",
  ].join("\n");
}

function buildSystemPrompt(
  profile: ProfileBits,
  kbBlock: string,
  memory: MemoryBits,
  emotionalState: string | null,
  extracted: EmotionSnapshot | null = null,
  personalityProfile: PersonalityPromptProfile | null = null,
  language = "en",
  adminAnswers: AdminOnboardingAnswerBit[] = [],
): string {
  const stage = extracted?.conversation_stage ?? "meeting";
  const themeRepeatNote =
    extracted && extracted.theme_repeat_count > 1
      ? `NOTE: This theme (${extracted.primary_emotion}) has come up ${extracted.theme_repeat_count} times in this conversation — you may gently, naturally acknowledge this if it fits, but do not force it.`
      : "";

  const kbContext = kbBlock.trim();
  const dialogueExamples = "";
  const personalityContext = buildPersonalityContext(personalityProfile);

  const sections = [
    DOST_CORE_PROMPT.trim(),
    buildMentorBoxesSection().trim(),
    DOST_SAMPLE_CONVERSATIONS.trim(),
    personalityContext.trim(),
    `CURRENT STAGE: ${stage}`,
    themeRepeatNote,
    buildUserContextSection(profile, memory),
    formatAdminOnboardingBlock(adminAnswers),
  ].filter((section) => section.trim().length > 0);

  if (emotionalState && EMOTIONAL_STATE_GUIDANCE[emotionalState]) {
    sections.push(
      [
        "SELECTED EMOTIONAL PATTERN (user-chosen for this moment — a covering/pattern, NOT a diagnosis)",
        EMOTIONAL_STATE_GUIDANCE[emotionalState],
        "Rules for this selection:",
        "- Recognize the pattern gently in how you listen and respond.",
        "- Speak to the underlying unmet need.",
        "- NEVER diagnose or label the person (e.g. never say \"you have a victim personality\").",
        "- NEVER judge.",
        "- NEVER invent or name specific people/events from this selection alone.",
        "- Offer possibilities; stay 1–2 sentences; one question max when you ask.",
      ].join("\n"),
    );
  }

  const extractedBlock = formatExtractedEmotionContext(extracted);
  if (extractedBlock) {
    sections.push(extractedBlock);
  }

  if (kbContext) {
    sections.push(
      [
        `${RAG_GROUNDING_INSTRUCTION}`,
        "Relevant knowledge:",
        kbContext,
      ].join("\n\n"),
    );
  }

  if (dialogueExamples.trim()) {
    sections.push(
      `Example dialogues showing this emotional pattern handled well:\n${dialogueExamples.trim()}`,
    );
  }

  // Last, so it outweighs the English examples above.
  const languageSection = replyLanguageInstruction(language);
  if (languageSection) {
    sections.push(languageSection);
  }

  return sections.join("\n\n");
}

function formatExtractedEmotionContext(
  extracted: EmotionSnapshot | null,
): string {
  if (!extracted) return "";

  const primary = extracted.primary_emotions.join(", ") ||
    extracted.primary_emotion;
  const secondary = extracted.secondary_emotions.join(", ") || "none";
  const needs = extracted.needs.join(", ") || extracted.underlying_need ||
    "unknown";
  const intensityParts = Object.entries(extracted.emotion_intensities)
    .map(([label, score]) => `${sanitizeInject(label, 40)}:${score}`)
    .slice(0, 6);
  const intensities = intensityParts.length > 0
    ? intensityParts.join(", ")
    : "not rated";

  const lines = [
    "EXTRACTED EMOTIONAL SIGNALS (from this message — possibilities only, NOT a diagnosis)",
    `Primary: ${sanitizeInject(primary, 80)}`,
    `Secondary: ${sanitizeInject(secondary, 120)}`,
    `Needs: ${sanitizeInject(needs, 120)}`,
    `Intensities (1–5): ${sanitizeInject(intensities, 160)}`,
    `Confidence: ${extracted.confidence_score}`,
    "How to use this:",
    "- Offer 1–2 possibilities; never declare \"you are feeling X\".",
    "- Intensity 1–2: soft naming / stay gentle. 3: clear reflection OK. 4–5: meet the heat without escalating, fixing, or diagnosing.",
    "- Needs are clues for curiosity, not advice targets.",
    "- Stay boundaried — validate and explore; do not play therapist.",
  ];

  if (extracted.explanation) {
    lines.push(
      `Extraction notes (silent thematic context only — do not quote or read aloud): ${sanitizeInject(extracted.explanation, 280)}`,
    );
  }

  if (extracted.is_ambiguous) {
    lines.push(AMBIGUOUS_EMOTION_GUIDANCE);
  }

  return lines.join("\n");
}

async function callOpenAI(
  systemPrompt: string,
  history: HistoryTurn[],
  userMessage: string,
): Promise<string> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) {
    throw new Error("missing_key");
  }
  if (!OPENAI_COMPLETIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await fetch(OPENAI_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages,
      max_tokens: 200,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errType = "api_error";
    try {
      const parsed = JSON.parse(errBody) as {
        error?: { type?: string; code?: string; message?: string };
      };
      errType =
        parsed?.error?.code ??
        parsed?.error?.type ??
        parsed?.error?.message?.slice(0, 40) ??
        "api_error";
    } catch {
      errType = errBody.slice(0, 40) || "api_error";
    }
    console.error(
      "chat",
      "openai_completions",
      response.status,
      errType,
    );
    throw new Error(`upstream:${response.status}:${errType}`);
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const finishReason =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : "";

  if (typeof content !== "string") {
    throw new Error(`upstream:200:no_content:${finishReason || "unknown"}`);
  }

  const reply = content.trim();
  if (!reply) {
    throw new Error(`upstream:200:empty_reply:${finishReason || "unknown"}`);
  }
  return reply.length > MAX_MESSAGE_LEN ? reply.slice(0, MAX_MESSAGE_LEN) : reply;
}

function describeOpenAiFailure(error: unknown): { message: string; code?: string } {
  if (!(error instanceof Error)) {
    return { message: GENERIC_UPSTREAM, code: "unknown" };
  }
  if (error.message === "missing_key") {
    return {
      message:
        "OPENAI_API_KEY missing on chat Edge Function — add it under Project Settings → Edge Functions → Secrets.",
      code: "missing_key",
    };
  }
  if (error.message === "bad_url") {
    return { message: GENERIC_UPSTREAM, code: "bad_url" };
  }

  const parts = error.message.split(":");
  if (parts[0] !== "upstream") {
    return { message: GENERIC_UPSTREAM, code: error.message.slice(0, 32) };
  }

  const httpStatus = parts[1] ?? "";
  const reason = parts.slice(2).join(":") || "api_error";

  if (httpStatus === "200" && reason.startsWith("empty_reply")) {
    return {
      message:
        "OpenAI returned an empty reply. Try again, or check content filters on your API key.",
      code: "empty_reply",
    };
  }
  if (httpStatus === "200" && reason.startsWith("no_content")) {
    return {
      message: "OpenAI returned an unexpected response shape. Try again shortly.",
      code: "no_content",
    };
  }

  if (httpStatus === "401") {
    return {
      message:
        "OpenAI rejected the API key (401). Re-copy OPENAI_API_KEY into Edge Function secrets — no extra spaces.",
      code: "401",
    };
  }
  if (httpStatus === "429") {
    return {
      message:
        "OpenAI rate limit or quota exceeded (429). Add billing/credits at platform.openai.com.",
      code: "429",
    };
  }
  if (httpStatus) {
    return {
      message: `OpenAI chat failed (HTTP ${httpStatus}: ${reason}). Check API key, billing, and model gpt-4o-mini.`,
      code: httpStatus,
    };
  }

  return {
    message:
      "OpenAI chat failed after a valid response. Redeploy the chat function and try again.",
    code: reason.slice(0, 32),
  };
}

/**
 * Admin-authored onboarding answers (admin_onboarding_screens +
 * admin_onboarding_answers). Loaded per request and injected into the
 * system prompt as auxiliary context so the bot can use what the user
 * shared earlier without the user knowing a mental-health admin wrote
 * the question.
 */
type AdminOnboardingAnswerBit = {
  title: string;
  answer: string;
};

async function loadAdminOnboardingAnswers(
  userClient: SupabaseClient,
  userId: string,
): Promise<AdminOnboardingAnswerBit[]> {
  try {
    const { data, error } = await userClient
      .from("admin_onboarding_answers")
      .select(
        "answer_text, answer_option, admin_onboarding_screens!inner(title, is_active, position)",
      )
      .eq("user_id", userId)
      .order("answered_at", { ascending: true })
      .limit(20);

    if (error || !Array.isArray(data)) return [];

    const bits: AdminOnboardingAnswerBit[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const screenRaw =
        (row as { admin_onboarding_screens?: unknown }).admin_onboarding_screens;
      const screen =
        screenRaw && typeof screenRaw === "object" && !Array.isArray(screenRaw)
          ? (screenRaw as { title?: unknown; is_active?: unknown })
          : null;
      if (!screen || screen.is_active === false) continue;
      const title =
        typeof screen.title === "string"
          ? sanitizeInject(screen.title, 160)
          : "";
      const answerRaw =
        (row as { answer_text?: unknown }).answer_text ??
        (row as { answer_option?: unknown }).answer_option;
      const answer =
        typeof answerRaw === "string" ? sanitizeInject(answerRaw, 400) : "";
      if (!title || !answer) continue;
      bits.push({ title, answer });
    }
    return bits;
  } catch {
    return [];
  }
}

function formatAdminOnboardingBlock(bits: AdminOnboardingAnswerBit[]): string {
  if (bits.length === 0) return "";
  const lines = bits.map((b) => `- ${b.title} → ${b.answer}`);
  return [
    "AUXILIARY CONTEXT FROM EARLIER (private — the person shared these during onboarding; do not reveal that an outside admin wrote the questions, and never read them back verbatim):",
    ...lines,
    "Use these as subtle context when they are genuinely relevant. Do not quote them. Do not open with them.",
  ].join("\n");
}

