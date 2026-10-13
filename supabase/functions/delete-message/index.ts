import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
const GENERIC_ERROR = "Something went wrong.";
const FN = "delete-message";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    jsonResponse(cors, status, body, FN);

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
    return jsonResponse({}, 403, { error: "Forbidden" }, FN);
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError(FN, "env", new Error("MissingEnv"));
      return json(502, { error: GENERIC_ERROR });
    }

    const body: unknown = await req.json().catch(() => null);
    const messageId =
      body && typeof body === "object" && "message_id" in body
        ? (body as { message_id?: unknown }).message_id
        : null;

    if (typeof messageId !== "string" || !messageId.trim()) {
      return json(400, { error: "message_id is required" });
    }

    const userClient = createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user?.id) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }
    const userId = user.id;

    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: delError } = await admin
      .from("conversations")
      .delete()
      .eq("id", messageId.trim())
      .eq("user_id", userId);

    if (delError) {
      logFnError(FN, "delete", delError);
      return json(502, { error: GENERIC_ERROR });
    }

    return json(200, { status: "ok" });
  } catch (error) {
    logFnError(FN, "uncaught", error);
    return json(502, { error: GENERIC_ERROR });
  }
}
