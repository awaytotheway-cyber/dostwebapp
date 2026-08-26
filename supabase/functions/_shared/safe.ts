/** Shared helpers for privacy / memory edge functions. Never log secrets or row content. */

const GENERIC_ERROR = "Something went wrong.";

export function pgCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim().slice(0, 32);
  }
  return "";
}

export function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 64);
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 64);
  }
  return "Error";
}

export function isMissingRelation(error: unknown): boolean {
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

/** Table missing, schema cache stale, or role cannot read/write it. */
export function isInfraDbError(error: unknown): boolean {
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

export function logFnError(fn: string, step: string, error: unknown): void {
  console.error(fn, step, errorName(error), pgCode(error) || "-");
}

export function jsonSafe(value: unknown): unknown {
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

export function serviceRoleKey(): string {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    ""
  );
}

export function supabaseEnv(): {
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

export function envIsReady(env: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}): boolean {
  return Boolean(
    env.url.startsWith("https://") && env.anonKey && env.serviceRoleKey,
  );
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export function isAllowedOrigin(origin: string | null): boolean {
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

export function corsHeaders(origin: string | null): Record<string, string> {
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

export function jsonResponse(
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
