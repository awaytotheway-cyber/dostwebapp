import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BATCH_SIZE = 10;
const EMBEDDING_DIMS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small";

const GENERIC_UNAUTHORIZED = "Unauthorized";
const GENERIC_ERROR = "Something went wrong.";
const GENERIC_UPSTREAM = "Embedding is temporarily unavailable.";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const expectedSecret = Deno.env.get("EMBED_ADMIN_SECRET") ?? "";
    if (!expectedSecret) {
      return json(500, { error: GENERIC_ERROR });
    }

    const providedSecret = req.headers.get("x-embed-admin-secret") ?? "";
    if (!secretsEqual(providedSecret, expectedSecret)) {
      return json(401, { error: GENERIC_UNAUTHORIZED });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!openaiKey) {
      return json(500, { error: GENERIC_ERROR });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl.startsWith("https://") || !serviceRoleKey) {
      return json(500, { error: GENERIC_ERROR });
    }
    if (!OPENAI_EMBEDDINGS_URL.startsWith("https://")) {
      return json(500, { error: GENERIC_ERROR });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error: fetchError } = await admin
      .from("kb_modules")
      .select("id, module_name, content")
      .is("embedding", null)
      .limit(BATCH_SIZE);

    if (fetchError || !Array.isArray(rows)) {
      return json(500, { error: GENERIC_ERROR });
    }

    if (rows.length === 0) {
      return json(200, { processed: 0, remaining: 0 });
    }

    const batch: Array<{ id: string; text: string }> = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = row.id;
      if (id === null || id === undefined) continue;
      const text = embedText(row.module_name, row.content);
      if (!text) continue;
      batch.push({ id: String(id), text });
    }

    if (batch.length === 0) {
      const remaining = await countRemaining(admin);
      if (remaining === null) {
        return json(500, { error: GENERIC_ERROR });
      }
      return json(200, { processed: 0, remaining });
    }

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openaiKey, batch.map((item) => item.text));
    } catch {
      return json(502, { error: GENERIC_UPSTREAM });
    }

    if (embeddings.length !== batch.length) {
      return json(502, { error: GENERIC_UPSTREAM });
    }

    for (let i = 0; i < batch.length; i++) {
      const embedding = embeddings[i];
      if (!isEmbedding(embedding)) {
        return json(502, { error: GENERIC_UPSTREAM });
      }
      const { error: updateError } = await admin
        .from("kb_modules")
        .update({ embedding })
        .eq("id", batch[i].id);
      if (updateError) {
        return json(500, { error: GENERIC_ERROR });
      }
    }

    const remaining = await countRemaining(admin);
    if (remaining === null) {
      return json(500, { error: GENERIC_ERROR });
    }

    return json(200, { processed: batch.length, remaining });
  } catch {
    return json(500, { error: GENERIC_ERROR });
  }
}

function embedText(moduleName: unknown, content: unknown): string {
  const title = typeof moduleName === "string" ? moduleName.trim() : "";
  const body = typeof content === "string" ? content.trim() : "";
  return [title, body].filter(Boolean).join("\n\n");
}

async function countRemaining(
  admin: ReturnType<typeof createClient>,
): Promise<number | null> {
  const { count, error } = await admin
    .from("kb_modules")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);
  if (error || typeof count !== "number") return null;
  return count;
}

async function embedBatch(apiKey: string, input: string[]): Promise<number[][]> {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!response.ok) {
    throw new Error("upstream");
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("upstream");
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("upstream");
  }

  const sorted = [...data].sort((a, b) => {
    const ia = itemIndex(a);
    const ib = itemIndex(b);
    return ia - ib;
  });

  const embeddings: number[][] = [];
  for (const item of sorted) {
    if (!item || typeof item !== "object") {
      throw new Error("upstream");
    }
    const embedding = (item as { embedding?: unknown }).embedding;
    if (!isEmbedding(embedding)) {
      throw new Error("upstream");
    }
    embeddings.push(embedding);
  }

  return embeddings;
}

function itemIndex(item: unknown): number {
  if (!item || typeof item !== "object") return 0;
  const index = (item as { index?: unknown }).index;
  return typeof index === "number" && Number.isFinite(index) ? index : 0;
}

function isEmbedding(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMS) return false;
  return value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function secretsEqual(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const av = i < a.length ? a[i] : 0;
    const bv = i < b.length ? b[i] : 0;
    mismatch |= av ^ bv;
  }
  return mismatch === 0;
}

function json(
  status: number,
  body: Record<string, string | number>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
