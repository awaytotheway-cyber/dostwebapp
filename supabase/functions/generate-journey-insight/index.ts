import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Helpers live in this file so dashboard deploy (this folder only) can bundle.
// CLI deploy of other functions still uses supabase/functions/_shared/safe.ts.

const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INSIGHT_LEN = 900;
const MAX_EMOTION_KEYS = 40;
const MAX_NEED_KEYS = 20;
const MIN_TOTAL_COUNT = 3;
const TOKEN_RE = /^[a-z][a-z_]{0,39}$/;

const RANGE_KEYS = new Set(["7d", "30d", "all"]);
const RANGE_LABELS: Record<string, string> = {
  "7d": "the past 7 days",
  "30d": "the past 30 days",
  all: "all the time you have shared here",
};

// App languages (lib/i18n/languages.ts) → name used in the prompt.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi (Devanagari script)",
  mr: "Marathi (Devanagari script)",
  es: "Spanish",
  de: "German",
  ru: "Russian",
  zh: "Simplified Chinese",
  ja: "Japanese",
};

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_INVALID = "Invalid request.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Journey insight is temporarily unavailable.";

const SYSTEM_PROMPT =
  "You are DOST, a warm, grounded companion. You notice emotional weather with care. Never clinical, never diagnostic, never preachy. Return JSON only.";

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
    jsonResponse(cors, status, body, "generate-journey-insight");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "generate-journey-insight");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("generate-journey-insight", "env", new Error("MissingEnv"));
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

    const parsed = parseBody(body);
    if (!parsed) {
      return json(400, { error: GENERIC_INVALID });
    }

    const total = Object.values(parsed.emotionCounts).reduce((a, b) => a + b, 0);
    if (total < MIN_TOTAL_COUNT) {
      return json(200, { status: "empty", insight: null, cached: false });
    }

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const cached = await loadCached(admin, userId, parsed.rangeKey, parsed.language);
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
      return json(200, {
        status: "ok",
        insight: cached.insight,
        cached: true,
        generated_at: new Date(cached.generatedAt).toISOString(),
      });
    }

    let insight: string;
    try {
      insight = await callOpenAI(parsed);
    } catch (error) {
      logFnError("generate-journey-insight", "upstream", error);
      if (cached?.insight) {
        return json(200, {
          status: "ok",
          insight: cached.insight,
          cached: true,
          generated_at: new Date(cached.generatedAt).toISOString(),
        });
      }
      return json(502, { error: GENERIC_UPSTREAM });
    }

    const generatedAt = new Date().toISOString();
    const { error: upsertError } = await admin.from("journey_insights").upsert(
      {
        user_id: userId,
        range_key: parsed.rangeKey,
        language: parsed.language,
        insight_text: insight,
        emotion_counts: parsed.emotionCounts,
        top_needs: parsed.topNeeds,
        generated_at: generatedAt,
      },
      { onConflict: "user_id,range_key,language" },
    );

    if (upsertError) {
      logFnError("generate-journey-insight", "upsert", upsertError);
      // Still return the fresh insight even if cache write fails.
    }

    return json(200, {
      status: "ok",
      insight,
      cached: false,
      generated_at: generatedAt,
    });
  } catch (error) {
    logFnError("generate-journey-insight", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

type ParsedBody = {
  rangeKey: string;
  rangeLabel: string;
  emotionCounts: Record<string, number>;
  topNeeds: string[];
  language: string;
};

function parseBody(body: unknown): ParsedBody | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const rangeKey =
    typeof record.range_key === "string"
      ? record.range_key.trim()
      : typeof record.rangeKey === "string"
        ? record.rangeKey.trim()
        : "";
  if (!RANGE_KEYS.has(rangeKey)) return null;

  const rangeLabelRaw =
    typeof record.range_label === "string"
      ? record.range_label.trim()
      : typeof record.rangeLabel === "string"
        ? record.rangeLabel.trim()
        : "";
  const rangeLabel =
    rangeLabelRaw.slice(0, 48) || RANGE_LABELS[rangeKey] || rangeKey;

  const emotionCounts = sanitizeCounts(
    record.emotion_counts ?? record.emotionCounts,
  );
  if (!emotionCounts) return null;

  const topNeeds = sanitizeNeeds(record.top_needs ?? record.topNeeds);

  const languageRaw =
    typeof record.language === "string" ? record.language.trim().toLowerCase() : "";
  const language = languageRaw in LANGUAGE_NAMES ? languageRaw : "en";

  return { rangeKey, rangeLabel, emotionCounts, topNeeds, language };
}

function sanitizeCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  let keys = 0;
  for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
    if (keys >= MAX_EMOTION_KEYS) break;
    const key = rawKey.trim().toLowerCase();
    if (!TOKEN_RE.test(key)) continue;
    const n =
      typeof rawVal === "number"
        ? rawVal
        : typeof rawVal === "string"
          ? Number(rawVal)
          : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(500, Math.round(n));
    keys += 1;
  }
  return out;
}

function sanitizeNeeds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= MAX_NEED_KEYS) break;
    if (typeof item !== "string") continue;
    const token = item.trim().toLowerCase();
    if (!TOKEN_RE.test(token)) continue;
    if (out.includes(token)) continue;
    out.push(token);
  }
  return out;
}

type CachedInsight = { insight: string; generatedAt: number };

async function loadCached(
  admin: SupabaseClient,
  userId: string,
  rangeKey: string,
  language: string,
): Promise<CachedInsight | null> {
  const { data, error } = await admin
    .from("journey_insights")
    .select("insight_text, generated_at")
    .eq("user_id", userId)
    .eq("range_key", rangeKey)
    .eq("language", language)
    .maybeSingle();

  if (error) {
    logFnError("generate-journey-insight", "load_cache", error);
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const insight =
    typeof data.insight_text === "string" ? data.insight_text.trim() : "";
  if (!insight) return null;

  const generatedAt = data.generated_at
    ? Date.parse(String(data.generated_at))
    : NaN;
  if (!Number.isFinite(generatedAt)) return null;

  return { insight: insight.slice(0, MAX_INSIGHT_LEN), generatedAt };
}

async function callOpenAI(parsed: ParsedBody): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("missing_key");
  }
  if (!OPENAI_COMPLETIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  const sortedEmotions = Object.entries(parsed.emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([token, count]) => `${token}: ${count}`)
    .join(", ");

  const needsLine =
    parsed.topNeeds.length > 0
      ? parsed.topNeeds.slice(0, 8).join(", ")
      : "(none clear yet)";

  const userContent = `Write DOST's gentle reflection for ${parsed.rangeLabel}.

Emotion counts (patterns only, no stories): ${sortedEmotions || "(sparse)"}
Top needs under the surface: ${needsLine}

Voice:
- Warm, intimate, poetic — like a trusted friend who notices weather, not a clinician.
- 2–3 short paragraphs, or one longer soft paragraph. No bullets, no headings, no emoji.
- Speak in first person as DOST ("I notice…", "It feels like…"). Address the person as "you".
- Do not diagnose, prescribe, or list coping strategies. No medical/therapy jargon.
- Never invent specific events, names, places, or quote private words.
- If one emotion dominates, name its weather softly; if several share the sky, hold them together.
- Write the reflection in ${LANGUAGE_NAMES[parsed.language]}, in natural everyday wording rather than a literal translation. Keep the JSON key "insight" in English.

Respond ONLY with valid JSON:
{ "insight": "your reflection here" }`;

  const response = await fetch(OPENAI_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 420,
      temperature: 0.7,
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

  const insight = parseInsight(content);
  if (!insight) throw new Error("parse");
  return insight;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseInsight(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const insight =
    typeof record.insight === "string"
      ? record.insight
      : typeof record.reflection === "string"
        ? record.reflection
        : "";
  const cleaned = insight.replace(/\s+/g, " ").trim();
  if (cleaned.length < 40) return null;
  return cleaned.slice(0, MAX_INSIGHT_LEN);
}
