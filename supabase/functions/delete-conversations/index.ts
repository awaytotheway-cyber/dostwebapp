import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  bearerToken,
  corsHeaders,
  envIsReady,
  isAllowedOrigin,
  isInfraDbError,
  jsonResponse,
  logFnError,
  supabaseEnv,
} from "../_shared/safe.ts";

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_ERROR = "Something went wrong.";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, "delete-conversations");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "delete-conversations");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("delete-conversations", "env", new Error("MissingEnv"));
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

    const { error: convError } = await admin
      .from("conversations")
      .delete()
      .eq("user_id", userId);

    if (convError) {
      logFnError("delete-conversations", "conversations", convError);
      if (!isInfraDbError(convError)) {
        return json(502, { error: GENERIC_ERROR });
      }
    }

    const { error: memError } = await admin
      .from("user_memory")
      .delete()
      .eq("user_id", userId);

    if (memError) {
      logFnError("delete-conversations", "user_memory", memError);
      if (!isInfraDbError(memError)) {
        return json(502, { error: GENERIC_ERROR });
      }
    }

    return json(200, { status: "ok" });
  } catch (error) {
    logFnError("delete-conversations", "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}
