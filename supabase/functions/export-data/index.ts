import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  bearerToken,
  corsHeaders,
  envIsReady,
  isAllowedOrigin,
  jsonResponse,
  jsonSafe,
  logFnError,
  supabaseEnv,
} from "../_shared/safe.ts";

const RATE_LIMIT_PER_DAY = 3;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_RATE_LIMIT = "Too many exports today. Please try again tomorrow.";
const GENERIC_ERROR = "Something went wrong.";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "export-data");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "export-data");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("export-data", "env", new Error("MissingEnv"));
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

    const rate = await applyRateLimit(admin, userId);
    if (rate === "limited") {
      return json(429, { error: GENERIC_RATE_LIMIT });
    }

    const [profile, conversations, memory, intentions] = await Promise.all([
      loadProfile(admin, userId),
      loadConversations(admin, userId),
      loadMemory(admin, userId),
      loadIntentions(admin, userId),
    ]);

    return json(200, {
      exported_at: new Date().toISOString(),
      profile,
      conversations,
      memory,
      intentions,
    });
  } catch (error) {
    logFnError("export-data", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

type RateResult = "ok" | "limited";

async function applyRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<RateResult> {
  const { data: row, error: readError } = await admin
    .from("export_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    logFnError("export-data", "rate_read", readError);
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
    const { error } = await admin.from("export_rate_limits").upsert({
      user_id: userId,
      window_start: new Date(now).toISOString(),
      count: 1,
    });
    if (error) logFnError("export-data", "rate_upsert", error);
    return "ok";
  }

  const count = typeof row.count === "number" ? row.count : 0;
  if (count >= RATE_LIMIT_PER_DAY) {
    return "limited";
  }

  const { error } = await admin
    .from("export_rate_limits")
    .update({ count: count + 1 })
    .eq("user_id", userId);

  if (error) logFnError("export-data", "rate_update", error);
  return "ok";
}

async function loadProfile(admin: SupabaseClient, userId: string) {
  const full =
    "name, intention, dosha, reflection_time, dob, dob_time, created_at";
  const core = "name, intention, dosha, dob, dob_time";

  let { data, error } = await admin
    .from("profiles")
    .select(full)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logFnError("export-data", "profile", error);
    const retry = await admin
      .from("profiles")
      .select(core)
      .eq("id", userId)
      .maybeSingle();
    if (retry.error) {
      logFnError("export-data", "profile_core", retry.error);
      return null;
    }
    data = retry.data;
  }

  if (!data || typeof data !== "object") return null;
  return jsonSafe(data);
}

async function loadConversations(admin: SupabaseClient, userId: string) {
  const rows: unknown[] = [];
  let from = 0;
  while (from < MAX_ROWS) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("conversations")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      logFnError("export-data", "conversations", error);
      break;
    }
    if (!Array.isArray(data)) break;
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      rows.push({
        id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
        role: typeof row.role === "string" ? row.role : "",
        content: typeof row.content === "string" ? row.content : "",
        created_at:
          typeof row.created_at === "string"
            ? row.created_at
            : String(row.created_at ?? ""),
      });
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function loadMemory(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("user_memory")
    .select("summary, patterns, last_updated")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logFnError("export-data", "memory", error);
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return jsonSafe({
    summary: typeof record.summary === "string" ? record.summary : "",
    patterns: record.patterns ?? null,
    last_updated: record.last_updated ?? null,
  });
}

async function loadIntentions(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("daily_intentions")
    .select("for_date, intentions, created_at")
    .eq("user_id", userId)
    .order("for_date", { ascending: true });

  if (error) {
    logFnError("export-data", "intentions", error);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return jsonSafe(data);
}
