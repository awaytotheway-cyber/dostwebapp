// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type HearingClassification,
  normaliseClassification,
  SYSTEM_PROMPT,
} from "./classification.ts";

/**
 * hearing-extract-emotions
 *
 * Classifies a redacted transcript segment against DOST's emotion
 * taxonomy and NVC needs list, returning inline. Reads/writes nothing:
 * the client stitches the returned tags into a voice_signals row
 * alongside acoustic features. Kept separate from the Phase 5
 * extract-emotions function because that function is coupled to the
 * messages/message_emotions schema; the hearing pipeline has no
 * messages row and never stores the transcript.
 *
 * Request:  { text: string }             — must be redacted client-side first
 * Response: { primary_emotion: string,   — a feeling, or "neutral"
 *             secondary_emotions: string[],
 *             underlying_need: string | null,
 *             semantic_confidence: number }
 *
 * The prompt and the rules for cleaning the model's answer live in
 * classification.ts, where they are tested.
 */

const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const MAX_TEXT_LEN = 4000;

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

async function classify(text: string): Promise<HearingClassification> {
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
  return normaliseClassification(JSON.parse(raw));
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
