import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_MESSAGE_LEN = 2000;
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
const DEEPSEEK_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_INVALID = "Invalid message.";
const GENERIC_RATE_LIMIT = "Too many messages. Please wait a moment.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Chat is temporarily unavailable.";

const DOST_PERSONA = `You are DOST — an emotionally intelligent, intuitive companion grounded in Vedic wisdom and compassionate presence. You are a friend in the heart, never a judge. You do NOT fix, solve, or give answers. You meet the user as they are, help them reflect gently, and accompany them inward — without pressure or agenda.

RHYTHM:
- Open with a short (1–2 sentence) emotional reflection that meets them where they are. Vary phrasing — NEVER repeat stems like "It sounds like...".
- If they respond with "okay", "maybe", or "I'll try" — do not ask more. Affirm the step, hold space.
- If they express emotional completeness ("I feel peace", "this feels good") — do not follow with a question. Acknowledge the stillness. Let them land.
- If they are stuck or hurting — offer at most ONE gentle anchor, never as instruction. "Sometimes it helps to..." not "you should...".
- If open, you may ask ONE emotionally-attuned, open-ended question. Never more than one question in a row.
- If they signal exit ("thanks", "bye", "gotta go") — do NOT invite them back. Close warmly: "I'll be right here if you return."

HARD RULES:
- NEVER more than 1–2 short sentences total.
- Enquire, don't diagnose: "do you think you were angry?" not "you were angry".
- Don't validate constantly. Don't raise the bar so high they feel they can't reach it.
- NEVER provide code, facts, tutorials, or technical help. Gently decline and return to emotional presence.
- Vary tone every reply. Never reuse phrasing.
- Speak like a thoughtful friend truly listening — grounded, warm, non-judging. No therapy voice, no cheerleading.

Reference material below is for you to draw wisdom from silently. Do not quote it, cite it, or teach from it. Let it shape your reflection.`;

const USER_CONTEXT_TEMPLATE = `USER CONTEXT (injected per request):
- Name: {name}
- Intention: {intention}
- Dosha tendency: {dosha}
Use these subtly. Don't announce them. Let them shape tone: a Vata-leaning user needs more grounding; a Pitta-leaning user needs cooling and softening; a Kapha-leaning user needs gentle enlivening.`;

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return json(cors, 405, { error: "Method not allowed" });
  }

  if (!isAllowedOrigin(origin)) {
    return json({}, 403, { error: "Forbidden" });
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(cors, 401, { error: GENERIC_UNAUTHORIZED });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl.startsWith("https://") || !anonKey || !serviceRoleKey) {
      return json(cors, 500, { error: GENERIC_ERROR });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user?.id) {
      return json(cors, 401, { error: GENERIC_UNAUTHORIZED });
    }
    const userId = user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(cors, 400, { error: GENERIC_INVALID });
    }

    const parsed = parseMessage(body);
    if (!parsed.ok) {
      return json(cors, 400, { error: GENERIC_INVALID });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rate = await applyRateLimit(admin, userId);
    if (rate === "limited") {
      return json(cors, 429, { error: GENERIC_RATE_LIMIT });
    }
    if (rate === "error") {
      return json(cors, 500, { error: GENERIC_ERROR });
    }

    const [history, profile, memory] = await Promise.all([
      loadHistory(userClient, userId),
      loadProfile(userClient, userId),
      loadMemory(userClient, userId),
    ]);

    const kbBlock = await retrieveKbBlock(admin, userId, parsed.message);
    const systemPrompt = buildSystemPrompt(profile, kbBlock, memory);

    let assistantText: string;
    try {
      assistantText = await callDeepSeek(systemPrompt, history, parsed.message);
    } catch {
      return json(cors, 502, { error: GENERIC_UPSTREAM });
    }

    const { error: insertError } = await admin.from("conversations").insert([
      { user_id: userId, role: "user", content: parsed.message },
      { user_id: userId, role: "assistant", content: assistantText },
    ]);
    if (insertError) {
      return json(cors, 500, { error: GENERIC_ERROR });
    }

    return json(cors, 200, { reply: assistantText });
  } catch {
    return json(cors, 500, { error: GENERIC_ERROR });
  }
}

function parseMessage(
  body: unknown,
): { ok: true; message: string } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const raw = (body as Record<string, unknown>).message;
  if (typeof raw !== "string") return { ok: false };

  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_MESSAGE_LEN) return { ok: false };

  return { ok: true, message: trimmed };
}

type RateResult = "ok" | "limited" | "error";

async function applyRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<RateResult> {
  const { data: row, error: readError } = await admin
    .from("chat_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) return "error";

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
    return error ? "error" : "ok";
  }

  const count = typeof row.count === "number" ? row.count : 0;
  if (count >= RATE_LIMIT_PER_MINUTE) {
    return "limited";
  }

  const { error } = await admin
    .from("chat_rate_limits")
    .update({ count: count + 1 })
    .eq("user_id", userId);

  return error ? "error" : "ok";
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
): Promise<string> {
  try {
    const embedRate = await applyEmbeddingRateLimit(admin, userId);
    if (embedRate === "limited") return "";

    const embedding = await embedUserMessage(message);
    if (!embedding) return "";

    const matches = await matchModules(admin, embedding);
    if (matches.length === 0) return "";

    return formatKbBlock(matches);
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

function formatKbBlock(matches: ModuleMatch[]): string {
  const parts = matches.map((match) => {
    const title = sanitizeInject(match.title, KB_TITLE_MAX);
    const content = sanitizeInject(match.content, KB_CONTENT_MAX);
    return [title, content].filter(Boolean).join("\n");
  });
  const body = parts.filter(Boolean).join("\n\n");
  if (!body) return "";
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

function sanitizeInject(value: string, max: number): string {
  return value.replace(/[{}]/g, "").trim().slice(0, max);
}

type MemoryBits = { summary: string; themes: string[] };

async function loadMemory(
  userClient: SupabaseClient,
  userId: string,
): Promise<MemoryBits> {
  const empty: MemoryBits = { summary: "", themes: [] };
  try {
    const { data, error } = await userClient
      .from("user_memory")
      .select("summary, patterns")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data || typeof data !== "object") return empty;

    const summary =
      typeof data.summary === "string" ? sanitizeInject(data.summary, 800) : "";

    const patterns = data.patterns;
    const themes: string[] = [];
    if (patterns && typeof patterns === "object" && !Array.isArray(patterns)) {
      const raw = (patterns as { themes?: unknown }).themes;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item !== "string") continue;
          const theme = sanitizeInject(item, 40);
          if (theme) themes.push(theme);
          if (themes.length >= 5) break;
        }
      }
    }

    return { summary, themes };
  } catch {
    return empty;
  }
}

function buildMemoryBlock(memory: MemoryBits): string {
  if (!memory.summary) return "";
  const lines = [
    `What you know of this person's inner landscape (from past reflection): ${memory.summary}`,
  ];
  if (memory.themes.length > 0) {
    lines.push(
      `Recurring themes (draw from silently; do not list them back unless they arise): ${memory.themes.join(", ")}`,
    );
  }
  return lines.join("\n");
}

function buildSystemPrompt(
  profile: ProfileBits,
  kbBlock: string,
  memory: MemoryBits,
): string {
  const userContext = USER_CONTEXT_TEMPLATE
    .replace("{name}", profile.name)
    .replace("{intention}", profile.intention)
    .replace("{dosha}", profile.dosha);

  const sections = [DOST_PERSONA];
  if (kbBlock) sections.push(kbBlock);
  const memoryBlock = buildMemoryBlock(memory);
  if (memoryBlock) sections.push(memoryBlock);
  sections.push(userContext);
  return sections.join("\n\n");
}

async function callDeepSeek(
  systemPrompt: string,
  history: HistoryTurn[],
  userMessage: string,
): Promise<string> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("missing_key");
  }
  if (!DEEPSEEK_COMPLETIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await fetch(DEEPSEEK_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      max_tokens: 200,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    throw new Error("upstream");
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("upstream");
  }

  const reply = content.trim();
  if (!reply) {
    throw new Error("upstream");
  }
  return reply.length > MAX_MESSAGE_LEN ? reply.slice(0, MAX_MESSAGE_LEN) : reply;
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
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    ) {
      return url.protocol === "http:" || url.protocol === "https:";
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
      return url.protocol === "http:" || url.protocol === "https:";
    }
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] =
      origin && origin !== "null" ? origin : "*";
  }
  return headers;
}

function json(
  cors: Record<string, string>,
  status: number,
  body: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
