// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * hearing-extract-emotions
 *
 * Classifies a redacted transcript segment against DOST's 16-emotion
 * taxonomy and NVC needs list, returning inline. Reads/writes nothing:
 * the client stitches the returned tags into a voice_signals row
 * alongside acoustic features. Kept separate from the Phase 5
 * extract-emotions function because that function is coupled to the
 * messages/message_emotions schema; the hearing pipeline has no
 * messages row and never stores the transcript.
 *
 * Request:  { text: string }             — must be redacted client-side first
 * Response: { primary_emotion: string,
 *             secondary_emotions: string[],
 *             underlying_need: string,
 *             semantic_confidence: number }
 */

const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const MAX_TEXT_LEN = 4000;

const ALLOWED_EMOTIONS = new Set([
  "shame", "anger_grief", "multipersona", "shielding_manager",
  "victim_personality", "resignation", "denial", "envy", "pride", "greed",
  "lust", "addiction", "detachment", "spiritual_bypass", "scarcity",
  "lamentation", "inadequacy", "loneliness", "resentment", "guilt", "fear",
  "anxiety", "grief", "anger", "helplessness", "overwhelm", "numbness",
  "disappointment", "frustration", "confusion", "emptiness", "betrayal",
  "abandonment", "humiliation", "embarrassment", "jealousy", "invisibility",
  "sadness", "weariness", "hurt", "longing", "disgust", "contempt",
]);

const ALLOWED_NEEDS = new Set([
  "safety", "autonomy", "recognition", "belonging", "authenticity",
  "meaning", "growth", "peace", "connection", "respect", "competence",
  "acceptance", "self_acceptance", "freedom", "understanding", "empathy",
  "support", "trust", "fairness", "dignity", "purpose", "love",
  "reciprocity", "consideration", "being_seen", "being_heard", "being_enough",
]);

const FALLBACK_EMOTION = "detachment";
const FALLBACK_NEED = "understanding";

const SYSTEM_PROMPT =
  `You classify one short spoken passage against DOST's emotion taxonomy and NVC needs list.

Return a single JSON object with these fields, and nothing else:
  primary_emotion       ONE token from the allowed emotions list
  secondary_emotions    up to 2 additional tokens from that list (may be empty)
  underlying_need       ONE token from the allowed needs list
  semantic_confidence   a number 0..1

Rules:
  - Prefer allowlisted tokens exactly. Do not invent tokens.
  - The passage may contain placeholders like [phone] [email] [address]. Treat them as opaque.
  - Never quote names, events, phone numbers, or emails back to the caller.
  - If the passage is too short or unclear, return primary_emotion="${FALLBACK_EMOTION}", underlying_need="${FALLBACK_NEED}", and semantic_confidence <= 0.4.

Allowed emotions: ${[...ALLOWED_EMOTIONS].join(", ")}
Allowed needs:    ${[...ALLOWED_NEEDS].join(", ")}`;

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function coerceToken(v: unknown, allowed: Set<string>): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (allowed.has(t)) return t;
  return null;
}

function coerceTokenList(v: unknown, allowed: Set<string>, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = coerceToken(item, allowed);
    if (t && !out.includes(t) && out.length < max) out.push(t);
  }
  return out;
}

function coerceConfidence(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.4;
  return Math.max(0, Math.min(1, n));
}

async function classify(text: string): Promise<{
  primary_emotion: string;
  secondary_emotions: string[];
  underlying_need: string;
  semantic_confidence: number;
}> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch(OPENAI_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, MAX_TEXT_LEN) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`openai_${res.status}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("openai_empty");
  }
  const parsed = JSON.parse(raw);

  const primary =
    coerceToken(parsed.primary_emotion, ALLOWED_EMOTIONS) ?? FALLBACK_EMOTION;
  const secondary = coerceTokenList(
    parsed.secondary_emotions,
    ALLOWED_EMOTIONS,
    2,
  ).filter((t) => t !== primary);
  const need =
    coerceToken(parsed.underlying_need, ALLOWED_NEEDS) ?? FALLBACK_NEED;
  const confidence = coerceConfidence(parsed.semantic_confidence);

  return {
    primary_emotion: primary,
    secondary_emotions: secondary,
    underlying_need: need,
    semantic_confidence: confidence,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  try {
    const token = bearer(req.headers.get("authorization"));
    if (!token) return json(401, { error: "unauthorized" }, origin);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!url || !anon) return json(500, { error: "config" }, origin);

    const client = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await client.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "unauthorized" }, origin);
    }

    const body = await req.json().catch(() => null);
    const text =
      typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return json(400, { error: "empty_text" }, origin);
    }

    const result = await classify(text);
    return json(200, result, origin);
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    console.error("hearing-extract-emotions", name, msg);
    return json(500, { error: "extraction_failed" }, req.headers.get("origin"));
  }
});
