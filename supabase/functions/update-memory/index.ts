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

const HISTORY_LIMIT = 50;
const MIN_USER_TURNS = 5;
const COOLDOWN_MS = 5 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SUMMARY_LEN = 1200;
const MAX_MESSAGE_SNIPPET = 400;
const MAX_THEME_LEN = 40;
const MIN_THEMES = 3;
const MAX_THEMES = 5;
const MAX_TONE_LEN = 40;
const DEEPSEEK_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_RATE_LIMIT = "Too many requests. Please wait a moment.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Memory update is temporarily unavailable.";

const MEMORY_SYSTEM_PROMPT =
  "You update a rolling memory of one person's inner patterns. Return JSON only.";

const MEMORY_USER_PROMPT =
  "Given this existing summary of the user and their recent messages, produce an updated 3-4 sentence summary of their emotional patterns, themes they return to, and how they tend to communicate. Do NOT include specific personal details (names of people, locations). Focus on patterns.\n\nAlso extract patterns JSON: themes (list of 3-5), tone_preference.\n\nReturn ONLY JSON with keys: summary (string), themes (array of 3-5 short strings), tone_preference (short string).";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "update-memory");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "update-memory");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("update-memory", "env", new Error("MissingEnv"));
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

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const existing = await loadExistingMemory(admin, userId);
    if (existing && isCoolingDown(existing.lastUpdated)) {
      return json(200, { status: "skipped" });
    }

    const history = await loadHistory(admin, userId);
    const userTurns = history.filter((row) => row.role === "user").length;
    if (userTurns < MIN_USER_TURNS) {
      return json(200, { status: "skipped" });
    }

    const rate = await applyRateLimit(admin, userId);
    if (rate === "limited") {
      return json(429, { error: GENERIC_RATE_LIMIT });
    }

    let parsed: MemoryUpdate;
    try {
      parsed = await callDeepSeek(existing?.summary ?? "", history);
    } catch {
      return json(502, { error: GENERIC_UPSTREAM });
    }

    const { error: upsertError } = await admin.from("user_memory").upsert({
      user_id: userId,
      summary: parsed.summary,
      patterns: {
        themes: parsed.themes,
        tone_preference: parsed.tonePreference,
      },
      last_updated: new Date().toISOString(),
    });

    if (upsertError) {
      logFnError("update-memory", "upsert", upsertError);
      return json(502, { error: GENERIC_ERROR });
    }

    return json(200, { status: "ok" });
  } catch (error) {
    logFnError("update-memory", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

type RateResult = "ok" | "limited" | "error";

async function applyRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<RateResult> {
  const { data: row, error: readError } = await admin
    .from("memory_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    logFnError("update-memory", "rate_read", readError);
    return cooldownOnlyFallback(admin, userId);
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
    const { error } = await admin.from("memory_rate_limits").upsert({
      user_id: userId,
      window_start: new Date(now).toISOString(),
      count: 1,
    });
    if (error) {
      logFnError("update-memory", "rate_upsert", error);
      return cooldownOnlyFallback(admin, userId);
    }
    return "ok";
  }

  const count = typeof row.count === "number" ? row.count : 0;
  if (count >= RATE_LIMIT_PER_HOUR) {
    return "limited";
  }

  const { error } = await admin
    .from("memory_rate_limits")
    .update({ count: count + 1 })
    .eq("user_id", userId);

  if (error) {
    logFnError("update-memory", "rate_update", error);
    return cooldownOnlyFallback(admin, userId);
  }
  return "ok";
}

async function cooldownOnlyFallback(
  admin: SupabaseClient,
  userId: string,
): Promise<RateResult> {
  const existing = await loadExistingMemory(admin, userId);
  if (existing && isCoolingDown(existing.lastUpdated)) return "limited";
  return "ok";
}

type ExistingMemory = { summary: string; lastUpdated: number };

async function loadExistingMemory(
  admin: SupabaseClient,
  userId: string,
): Promise<ExistingMemory | null> {
  const { data, error } = await admin
    .from("user_memory")
    .select("summary, last_updated")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") {
    if (error) logFnError("update-memory", "load_memory", error);
    return null;
  }

  const summary = typeof data.summary === "string" ? data.summary : "";
  const lastUpdated = data.last_updated
    ? Date.parse(String(data.last_updated))
    : NaN;
  return {
    summary,
    lastUpdated: Number.isFinite(lastUpdated) ? lastUpdated : 0,
  };
}

function isCoolingDown(lastUpdated: number): boolean {
  return lastUpdated > 0 && Date.now() - lastUpdated < COOLDOWN_MS;
}

type HistoryTurn = { role: "user" | "assistant"; content: string };

async function loadHistory(
  admin: SupabaseClient,
  userId: string,
): Promise<HistoryTurn[]> {
  const { data, error } = await admin
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
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!role || !content) continue;
    turns.push({
      role,
      content: content.slice(0, MAX_MESSAGE_SNIPPET),
    });
  }
  return turns.reverse();
}

type MemoryUpdate = {
  summary: string;
  themes: string[];
  tonePreference: string;
};

async function callDeepSeek(
  existingSummary: string,
  history: HistoryTurn[],
): Promise<MemoryUpdate> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("missing_key");
  }
  if (!DEEPSEEK_COMPLETIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  const historyLines = history.map((turn) => {
    const who = turn.role === "user" ? "User" : "DOST";
    return `${who}: ${turn.content}`;
  });

  const userContent = [
    MEMORY_USER_PROMPT,
    "",
    "Existing summary:",
    existingSummary.trim() || "(none yet)",
    "",
    "Recent messages:",
    historyLines.join("\n"),
  ].join("\n");

  const response = await fetch(DEEPSEEK_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: MEMORY_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 400,
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error("upstream");
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("upstream");
  }

  return parseMemoryUpdate(content);
}

function parseMemoryUpdate(raw: string): MemoryUpdate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("upstream");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("upstream");
  }

  const record = parsed as Record<string, unknown>;
  const summary = sanitizeText(record.summary, MAX_SUMMARY_LEN);
  if (!summary) {
    throw new Error("upstream");
  }

  const themesRaw = Array.isArray(record.themes) ? record.themes : [];
  const themes: string[] = [];
  for (const item of themesRaw) {
    if (typeof item !== "string") continue;
    const theme = sanitizeText(item, MAX_THEME_LEN);
    if (!theme) continue;
    if (!themes.includes(theme)) themes.push(theme);
    if (themes.length >= MAX_THEMES) break;
  }
  if (themes.length < MIN_THEMES) {
    throw new Error("upstream");
  }

  const tonePreference =
    sanitizeText(record.tone_preference, MAX_TONE_LEN) || "gentle";

  return { summary, themes, tonePreference };
}

function stripFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}

function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
