import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

const MIN_NEW_MESSAGES = 5;

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader && !authHeader.includes(SERVICE_ROLE_KEY)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: candidates, error: candErr } = await admin.rpc(
    "get_users_needing_consolidation",
    { min_new_messages: MIN_NEW_MESSAGES }
  );

  if (candErr) {
    console.error("candidate lookup failed", candErr);
    return new Response(JSON.stringify({ error: "candidate lookup failed", detail: candErr.message }), { status: 500 });
  }

  const results = { processed: 0, skipped: 0, errors: 0, details: [] as string[] };

  for (const candidate of candidates ?? []) {
    try {
      await consolidateUser(admin, candidate.user_id, candidate.since_watermark);
      results.processed++;
    } catch (e: any) {
      console.error(`consolidation failed for ${candidate.user_id}`, e);
      results.errors++;
      results.details.push(`${candidate.user_id}: ${e.message}`);
    }
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function consolidateUser(admin: any, userId: string, since: string) {
  const { data: prevRows } = await admin
    .from("user_understanding")
    .select("*")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1);
  const previous = prevRows?.[0] ?? null;

  const { data: newMessages } = await admin
    .from("message_emotions")
    .select("primary_emotion, secondary_emotions, underlying_need, conversation_stage, selected_emotion, selected_need, theme_repeat_count, created_at")
    .eq("user_id", userId)
    .gt("created_at", since)
    .order("created_at", { ascending: true });

  if (!newMessages || newMessages.length < MIN_NEW_MESSAGES) return;

  const { data: signals } = await admin.rpc("compute_engagement_signals", {
    p_user_id: userId,
    p_since: since,
  });

  const { data: profile } = await admin
    .from("personality_profile")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const synthesisPrompt = buildSynthesisPrompt(previous, newMessages, signals, profile);
  const updated = await callDeepSeekForSynthesis(synthesisPrompt);

  const nextVersion = (previous?.version ?? 0) + 1;
  const { error: insertErr } = await admin.from("user_understanding").insert({
    user_id: userId,
    version: nextVersion,
    understanding_text: updated.understanding_text,
    recurring_themes: updated.recurring_themes || [],
    effective_approaches: updated.effective_approaches || [],
    ineffective_approaches: updated.ineffective_approaches || [],
    pacing_preference: updated.pacing_preference || null,
    unresolved_threads: updated.unresolved_threads || [],
    engagement_snapshot: signals,
    message_count_considered: newMessages.length,
    processed_through: newMessages[newMessages.length - 1].created_at,
  });

  if (insertErr) throw insertErr;
}

function buildSynthesisPrompt(
  previous: any,
  newMessages: any[],
  signals: any,
  profile: any
): string {
  const previousBlock = previous
    ? `PREVIOUS UNDERSTANDING (version ${previous.version}):\n${previous.understanding_text}\n\nPreviously noted recurring themes: ${(previous.recurring_themes || []).join(", ") || "none yet"}\nPreviously noted unresolved threads: ${(previous.unresolved_threads || []).join(", ") || "none yet"}`
    : "This is the first synthesis for this person — no previous understanding exists yet.";

  const messagesSummary = newMessages
    .map(m => `[${m.conversation_stage}] emotion: ${m.selected_emotion || m.primary_emotion}, need: ${m.selected_need || m.underlying_need || "unclear"}${m.theme_repeat_count > 1 ? ` (repeat x${m.theme_repeat_count})` : ""}`)
    .join("\n");

  const profileBlock = profile
    ? `Constitutional profile on file: ${profile.dosha_body || ""} ${profile.dosha_mind || ""}, Enneagram ${profile.enneagram_type || "unknown"}, TCM ${profile.tcm_element || "unknown"}`
    : "No constitutional profile on file.";

  return `
You are updating a private, evolving understanding of a person who talks with DOST, an emotional companion. This understanding is NEVER shown to the person directly and NEVER recited to them — it only shapes DOST's tone, pacing, and what it gently notices in future conversations.

${previousBlock}

NEW CONVERSATIONAL DATA SINCE LAST UPDATE (${newMessages.length} exchanges):
${messagesSummary}

ENGAGEMENT SIGNALS FOR THIS PERIOD:
${JSON.stringify(signals, null, 2)}
- chip_acceptance_rate: how often offered emotion/need suggestions were actually selected, vs the person preferring their own words
- avg/max_theme_repeat_count: how often the same emotional theme resurfaced without resolving
- reached_deeper_stages / reached_integration: how often conversations actually reached belief-work or settled into integration, versus staying shallow

${profileBlock}

YOUR TASK: Produce an UPDATED understanding, not a fresh one. Integrate the new data into the previous understanding — reinforce what's still true, revise what's changed, prune anything stale or no longer relevant, and add genuinely new insight. Keep the total understanding_text under 400 words. Do not simply append — consolidate and generalize.

Be specific and grounded in what actually happened, not generic. "Tends toward shame" is weak. "Shame surfaces specifically around professional competence, and tends to soften when DOST asks about origin before naming the belief directly" is useful.

Respond ONLY with valid JSON in this exact shape:
{
  "understanding_text": "a flowing prose paragraph, under 400 words, capturing who this person is emotionally and how they respond to DOST",
  "recurring_themes": ["short phrase", "short phrase"],
  "effective_approaches": ["what has helped this person open up"],
  "ineffective_approaches": ["what tends to make them close off or disengage"],
  "pacing_preference": "one sentence on how fast/slow, direct/gentle this person needs DOST to move",
  "unresolved_threads": ["themes that keep surfacing without resolving"]
}
`;
}

async function callDeepSeekForSynthesis(prompt: string): Promise<any> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You synthesize private psychological understanding notes. Return JSON only, no markdown, no commentary." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek synthesis failed: ${response.status} ${body}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty synthesis response");

  const parsed = JSON.parse(content);

  if (!parsed.understanding_text || typeof parsed.understanding_text !== "string") {
    throw new Error("Invalid synthesis: missing understanding_text");
  }
  const words = parsed.understanding_text.split(/\s+/);
  if (words.length > 450) {
    parsed.understanding_text = words.slice(0, 450).join(" ") + "...";
  }

  return parsed;
}
