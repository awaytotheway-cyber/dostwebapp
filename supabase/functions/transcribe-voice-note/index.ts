import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Helpers live in this file so dashboard deploy (this folder only) can bundle.
// CLI deploy of other functions still uses supabase/functions/_shared/safe.ts.

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = "whisper-1";
const MAX_BYTES = 25 * 1024 * 1024;
const FILE_FIELDS = ["file", "audio", "voice"];

const GENERIC_UNAUTHORIZED = "Please sign in to continue.";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_NO_FILE = "No audio file was provided.";
const GENERIC_UPSTREAM = "Transcription is temporarily unavailable.";

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
    jsonResponse(cors, status, body, "transcribe-voice-note");

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
    return jsonResponse({}, 403, { error: "Forbidden" }, "transcribe-voice-note");
  }

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const env = supabaseEnv();
    if (!envIsReady(env)) {
      logFnError("transcribe-voice-note", "env", new Error("MissingEnv"));
      return json(500, { error: GENERIC_ERROR });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!openaiKey) {
      logFnError("transcribe-voice-note", "openai_key", new Error("MissingOpenAIKey"));
      return json(500, { error: GENERIC_ERROR });
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

    const audio = await extractAudioFile(req);
    if (!audio.ok) {
      return json(audio.status, { error: audio.error });
    }

    let transcript: string;
    try {
      transcript = await callWhisper(openaiKey, audio.file);
    } catch (error) {
      logFnError("transcribe-voice-note", "whisper", error);
      return json(502, { error: GENERIC_UPSTREAM });
    }

    console.log(
      "transcribe-voice-note",
      "ok",
      user.id,
      audio.file.size,
      transcript.length,
    );
    return json(200, { transcript });
  } catch (error) {
    logFnError("transcribe-voice-note", "uncaught", error);
    return json(500, { error: GENERIC_ERROR });
  }
}

type AudioOk = { ok: true; file: File };
type AudioErr = { ok: false; status: number; error: string };

async function extractAudioFile(req: Request): Promise<AudioOk | AudioErr> {
  const contentType = (req.headers.get("Content-Type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (error) {
      logFnError("transcribe-voice-note", "formdata", error);
      return { ok: false, status: 400, error: GENERIC_NO_FILE };
    }

    for (const field of FILE_FIELDS) {
      const value = form.get(field);
      if (value instanceof File && value.size > 0) {
        if (value.size > MAX_BYTES) {
          return { ok: false, status: 400, error: GENERIC_NO_FILE };
        }
        return { ok: true, file: value };
      }
    }
    return { ok: false, status: 400, error: GENERIC_NO_FILE };
  }

  // Fallback: raw binary body (e.g. application/octet-stream / audio/*).
  if (
    contentType.startsWith("audio/") ||
    contentType === "application/octet-stream" ||
    contentType === ""
  ) {
    try {
      const buffer = await req.arrayBuffer();
      if (!buffer.byteLength) {
        return { ok: false, status: 400, error: GENERIC_NO_FILE };
      }
      if (buffer.byteLength > MAX_BYTES) {
        return { ok: false, status: 400, error: GENERIC_NO_FILE };
      }
      const ext = contentType.includes("wav")
        ? "wav"
        : contentType.includes("webm")
        ? "webm"
        : "m4a";
      const mime = contentType.startsWith("audio/")
        ? contentType.split(";")[0]!.trim()
        : "audio/mp4";
      const file = new File([buffer], `voice-note.${ext}`, { type: mime });
      return { ok: true, file };
    } catch (error) {
      logFnError("transcribe-voice-note", "body", error);
      return { ok: false, status: 400, error: GENERIC_NO_FILE };
    }
  }

  return { ok: false, status: 400, error: GENERIC_NO_FILE };
}

async function callWhisper(apiKey: string, file: File): Promise<string> {
  if (!OPENAI_TRANSCRIPTIONS_URL.startsWith("https://")) {
    throw new Error("bad_url");
  }

  const form = new FormData();
  form.append("file", file, file.name || "voice-note.m4a");
  form.append("model", OPENAI_MODEL);
  form.append("language", "en");
  form.append("response_format", "json");

  const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`whisper_${response.status}`);
  }

  const data = await response.json();
  const transcript =
    typeof data?.text === "string" ? data.text.trim() : "";
  if (!transcript) {
    throw new Error("empty_transcript");
  }
  return transcript;
}
