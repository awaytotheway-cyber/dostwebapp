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

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_CONFIRM = "Type DELETE to confirm.";
const GENERIC_ERROR = "Something went wrong.";

const USER_TABLES: Array<{ table: string; column: string }> = [
  { table: "conversations", column: "user_id" },
  { table: "user_memory", column: "user_id" },
  { table: "daily_intentions", column: "user_id" },
  { table: "messages", column: "user_id" },
  { table: "export_rate_limits", column: "user_id" },
  { table: "memory_rate_limits", column: "user_id" },
  { table: "chat_rate_limits", column: "user_id" },
  { table: "embedding_rate_limits", column: "user_id" },
  { table: "profiles", column: "id" },
];

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "delete-account");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "delete-account");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("delete-account", "env", new Error("MissingEnv"));
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

    let confirm = "";
    try {
      const body: unknown = await req.json();
      if (body && typeof body === "object") {
        const raw = (body as Record<string, unknown>).confirm;
        if (typeof raw === "string") confirm = raw.trim();
      }
    } catch {
      confirm = "";
    }

    if (confirm !== "DELETE") {
      return json(400, { error: GENERIC_CONFIRM });
    }

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await deleteUserRows(admin, userId);

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      logFnError("delete-account", "deleteUser", deleteError);
      return json(502, { error: GENERIC_ERROR });
    }

    return json(200, { status: "ok" });
  } catch (error) {
    logFnError("delete-account", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}

async function deleteUserRows(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const { table, column } of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error) {
      logFnError("delete-account", table, error);
    }
  }
}
