import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  bearerToken,
  corsHeaders,
  envIsReady,
  isAllowedOrigin,
  jsonResponse,
  logFnError,
  supabaseEnv,
} from "../_shared/safe.ts";
import {
  buildUserPrompt,
  dayBounds,
  type DayRequest,
  type DaySummary,
  type EmotionLabelRow,
  fingerprint,
  isSparse,
  LANGUAGE_NAMES,
  nextRateWindow,
  parseDayRequest,
  pickFeelings,
  type RateState,
  type SourceMessage,
  SYSTEM_PROMPT,
  validateSummary,
} from "./daySummary.ts";

/**
 * generate-day-summary — one day's reflection for Your Patterns.
 *
 * Request:  { day: "YYYY-MM-DD", timeZone?: IANA name, utcOffsetMinutes?: number, language?: string }
 * Response: { status: "ok", day, tone, feelings, summary, safety, cached, is_today }
 *         | { status: "empty", day }               no messages that day
 *         | { status: "sparse", day, feelings }    too little to summarise honestly
 *         | { status: "capped", day }              daily generation cap reached
 *
 * Reads only the caller's own typed messages (role "user") for that local
 * day, and their emotion labels. The rules live in daySummary.ts.
 */

const FN = "generate-day-summary";
const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const MAX_MESSAGES = 300;
/** A second attempt when the first answer fails validation. */
const MAX_ATTEMPTS = 2;

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_INVALID = "Invalid request.";
const GENERIC_ERROR = "Something went wrong.";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) => jsonResponse(cors, status, body, FN);

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!isAllowedOrigin(origin)) return jsonResponse({}, 403, { error: "Forbidden" }, FN);

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) return json(401, { error: GENERIC_UNAUTHORIZED });

    const env = supabaseEnv();
    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!envIsReady(env) || !apiKey) {
      logFnError(FN, "env", new Error("MissingEnv"));
      return json(502, { error: GENERIC_ERROR });
    }

    const userClient = createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) return json(401, { error: GENERIC_UNAUTHORIZED });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: GENERIC_INVALID });
    }
    const request = parseDayRequest(body);
    if (!request) return json(400, { error: GENERIC_INVALID });

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const messages = await loadMessages(admin, userId, request);
    if (messages === null) return json(502, { error: GENERIC_ERROR });

    if (messages.length === 0) {
      // Everything that day was deleted: drop any summary written from it.
      await admin.from("daily_summaries").delete().eq("user_id", userId).eq("day", request.day);
      return json(200, { status: "empty", day: request.day });
    }

    const feelings = pickFeelings(await loadLabels(admin, userId, messages));
    if (isSparse(messages)) {
      return json(200, { status: "sparse", day: request.day, feelings });
    }

    const source = fingerprint(messages);
    const saved = await loadSaved(admin, userId, request);
    if (saved && saved.source_fingerprint === source) {
      return json(200, okBody(request, saved, true));
    }

    if (!(await takeRateSlot(admin, userId))) {
      return json(200, { status: "capped", day: request.day });
    }

    const summary = await writeSummary(apiKey, {
      messages,
      feelings,
      languageName: LANGUAGE_NAMES[request.language],
      isToday: request.isToday,
    });
    if (!summary) return json(502, { error: GENERIC_ERROR });

    const row = {
      user_id: userId,
      day: request.day,
      language: request.language,
      tone: summary.tone,
      feelings,
      summary: summary.summary,
      safety: summary.safety,
      source_fingerprint: source,
      generated_at: new Date().toISOString(),
    };
    const { error: upsertError } = await admin
      .from("daily_summaries")
      .upsert(row, { onConflict: "user_id,day,language" });
    if (upsertError) logFnError(FN, "upsert", upsertError); // still return it

    return json(200, okBody(request, row, false));
  } catch (error) {
    logFnError(FN, "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

type SavedRow = {
  tone: string;
  feelings: string[] | null;
  summary: string;
  safety: boolean;
  source_fingerprint: string;
  generated_at: string;
};

function okBody(request: DayRequest, row: Omit<SavedRow, "source_fingerprint"> & { feelings: string[] | null }, cached: boolean) {
  return {
    status: "ok",
    day: request.day,
    tone: row.tone,
    feelings: row.feelings ?? [],
    summary: row.summary,
    safety: row.safety === true,
    cached,
    is_today: request.isToday,
    generated_at: row.generated_at,
  };
}

async function loadMessages(
  admin: SupabaseClient,
  userId: string,
  request: DayRequest,
): Promise<SourceMessage[] | null> {
  const { startIso, endIso } = dayBounds(request.day, request.zone);
  const { data, error } = await admin
    .from("conversations")
    .select("id, content, created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (error) {
    logFnError(FN, "messages", error);
    return null;
  }
  return (data ?? []).filter(
    (r): r is SourceMessage =>
      typeof r?.id === "string" && typeof r?.content === "string" && typeof r?.created_at === "string",
  );
}

async function loadLabels(
  admin: SupabaseClient,
  userId: string,
  messages: SourceMessage[],
): Promise<EmotionLabelRow[]> {
  const { data, error } = await admin
    .from("message_emotions")
    .select("primary_emotion, secondary_emotions, confidence_score, is_ambiguous")
    .eq("user_id", userId)
    .in("message_id", messages.map((m) => m.id));
  if (error) {
    // Chips are optional; the summary can still be written.
    logFnError(FN, "labels", error);
    return [];
  }
  return (data ?? []) as EmotionLabelRow[];
}

async function loadSaved(
  admin: SupabaseClient,
  userId: string,
  request: DayRequest,
): Promise<SavedRow | null> {
  const { data, error } = await admin
    .from("daily_summaries")
    .select("tone, feelings, summary, safety, source_fingerprint, generated_at")
    .eq("user_id", userId)
    .eq("day", request.day)
    .eq("language", request.language)
    .maybeSingle();
  if (error) {
    logFnError(FN, "load_saved", error);
    return null;
  }
  return (data as SavedRow | null) ?? null;
}

/** Counts one generation against the cap. Fails open on a database error. */
async function takeRateSlot(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("daily_summary_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    logFnError(FN, "rate_read", error);
    return true;
  }
  const state: RateState | null = data
    ? { windowStart: String(data.window_start), count: Number(data.count) || 0 }
    : null;
  const { allowed, next } = nextRateWindow(state, new Date());
  if (!allowed) return false;
  const { error: writeError } = await admin
    .from("daily_summary_rate_limits")
    .upsert({ user_id: userId, window_start: next.windowStart, count: next.count }, { onConflict: "user_id" });
  if (writeError) logFnError(FN, "rate_write", writeError);
  return true;
}

async function writeSummary(
  apiKey: string,
  input: Parameters<typeof buildUserPrompt>[0],
): Promise<DaySummary | null> {
  const userPrompt = buildUserPrompt(input);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(OPENAI_COMPLETIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          temperature: attempt === 1 ? 0.4 : 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: attempt === 1
                ? userPrompt
                : `${userPrompt}\n\nYour previous answer broke the rules. 2 to 4 plain sentences, no clinical or diagnostic words, tone exactly one of light, mixed, heavy.`,
            },
          ],
        }),
      });
      if (!res.ok) {
        logFnError(FN, "openai_status", new Error(`openai_${res.status}`));
        continue;
      }
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") continue;
      const valid = validateSummary(JSON.parse(raw));
      if (valid) return valid;
      logFnError(FN, "invalid_summary", new Error(`attempt_${attempt}`));
    } catch (error) {
      logFnError(FN, "openai", error);
    }
  }
  return null;
}
