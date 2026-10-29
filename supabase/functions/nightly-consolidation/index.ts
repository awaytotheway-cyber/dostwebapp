// Captured from the deployed function (version 3) on 2026-10-29, which
// had never been committed. Identical at runtime; the only change is
// type annotations on the Supabase client, so the file passes
// `deno check`. Production was left running version 3 — redeploy from
// here only alongside a real change.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

const MIN_NEW_MESSAGES = 5;

Deno.serve(async (req) => {
  // Allow invocation via pg_cron (no JWT) or with service role key
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`consolidation failed for ${candidate.user_id}`, msg);
      results.errors++;
      results.details.push(`${candidate.user_id}: ${msg}`);
    }
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function consolidateUser(admin: SupabaseClient, userId: string, since: string) {
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

  // Phase 3: fetch recent listening summaries (fail-open)
  const voiceBlock = await fetchVoiceContextForSynthesis(admin, userId, since);

  const synthesisPrompt = buildSynthesisPrompt(previous, newMessages, signals, profile, voiceBlock);
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
  previous: Record<string, unknown> | null,
  newMessages: Record<string, unknown>[],
  signals: unknown,
  profile: Record<string, unknown> | null,
  voiceBlock: string,
): string {
  const previousBlock = previous
    ? `PREVIOUS UNDERSTANDING (version ${previous.version}):\n${previous.understanding_text}\n\nPreviously noted recurring themes: ${((previous.recurring_themes as string[]) || []).join(", ") || "none yet"}\nPreviously noted unresolved threads: ${((previous.unresolved_threads as string[]) || []).join(", ") || "none yet"}`
    : "This is the first synthesis for this person — no previous understanding exists yet.";

  const messagesSummary = newMessages
    .map(m => `[${m.conversation_stage}] emotion: ${m.selected_emotion || m.primary_emotion}, need: ${m.selected_need || m.underlying_need || "unclear"}${(m.theme_repeat_count as number) > 1 ? ` (repeat x${m.theme_repeat_count})` : ""}`)
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

${voiceBlock}

${profileBlock}

YOUR TASK: Produce an UPDATED understanding, not a fresh one. Integrate the new data into the previous understanding — reinforce what's still true, revise what's changed, prune anything stale or no longer relevant, and add genuinely new insight. Keep the total understanding_text under 400 words. Do not simply append — consolidate and generalize.

If voice listening data is present, integrate what it reveals about how the person has been speaking, and whether those patterns confirm or contradict the text-based emotional signals. Voice data is a second channel on the same person — it is not separate. Treat it as coarse and partial: it describes recent weeks in aggregate, never a specific moment, and it is never grounds for a confident claim about how they felt on any given day.

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

async function callDeepSeekForSynthesis(prompt: string): Promise<Record<string, unknown>> {
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

// ── Voice context for nightly synthesis (Phase 3) ────────────────────
//
// Reads listening_summaries — per-session aggregates written
// on-device. Labels and numbers only; audio and transcript text are
// never in this table.
//
// THE MOCK QUARANTINE. A summary row mixes two kinds of data:
//
//   REAL  emotion/need distributions (semantic, from the transcript)
//         and measured acoustic features (speaking rate, vocal
//         stress, silence) — direct signal processing.
//   MOCK  avg_arousal / avg_valence — acoustic emotion inference,
//         faked since Phase 1.
//
// inference_source marks the provenance of arousal/valence only.
// Rows are NOT dropped when it reads 'mock' — that would discard
// real voice data over a field we weren't going to use. Instead
// arousal/valence are read only from rows explicitly marked
// 'acoustic_v1' or 'fused_v1'. Until Phase 4 validates a real model
// that means they are never read, and no fabricated number can ever
// reach the synthesis prompt.
//
// Fail-open: if the table is missing or the query fails, returns ""
// and the synthesis proceeds on text data alone.

const REAL_INFERENCE_SOURCES = new Set(["acoustic_v1", "fused_v1"]);

async function fetchVoiceContextForSynthesis(
  admin: SupabaseClient,
  userId: string,
  since: string,
): Promise<string> {
  try {
    const { data, error } = await admin
      .from("listening_summaries")
      .select(
        "session_started_at, session_duration_seconds, speech_duration_seconds, total_segments, matched_segments, emotion_counts, dominant_emotion, need_counts, dominant_need, avg_speaking_rate_wpm, avg_vocal_stress_index, avg_silence_ratio, avg_arousal, avg_valence, inference_source",
      )
      .eq("user_id", userId)
      .gt("session_started_at", since)
      .order("session_started_at", { ascending: true });

    if (error || !data || data.length === 0) return "";

    const lines: string[] = [
      `VOICE LISTENING DATA FOR THIS PERIOD (${data.length} sessions — emotion/need labels and acoustic averages only, never transcript text):`,
    ];

    let totalSpeechMin = 0;
    const allEmotions: Record<string, number> = {};
    const allNeeds: Record<string, number> = {};

    for (const s of data) {
      totalSpeechMin += Number(s.speech_duration_seconds || 0) / 60;

      const emotions = (s.emotion_counts ?? {}) as Record<string, number>;
      for (const [e, c] of Object.entries(emotions)) {
        allEmotions[e] = (allEmotions[e] ?? 0) + c;
      }
      const needs = (s.need_counts ?? {}) as Record<string, number>;
      for (const [n, c] of Object.entries(needs)) {
        allNeeds[n] = (allNeeds[n] ?? 0) + c;
      }
    }

    const topEmotions = Object.entries(allEmotions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([e, c]) => `${e}(${c})`)
      .join(", ");

    const topNeeds = Object.entries(allNeeds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([n, c]) => `${n}(${c})`)
      .join(", ");

    lines.push(`- ${data.length} listening sessions, ~${Math.round(totalSpeechMin)} minutes of speech captured`);
    if (topEmotions) lines.push(`- Voice emotion distribution: ${topEmotions}`);
    if (topNeeds) lines.push(`- Voice need distribution: ${topNeeds}`);

    const stressVals = data
      .map((s) => Number(s.avg_vocal_stress_index))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (stressVals.length > 0) {
      const avgStress = stressVals.reduce((a, b) => a + b, 0) / stressVals.length;
      const label = avgStress > 0.6 ? "elevated" : avgStress > 0.3 ? "moderate" : "low";
      lines.push(`- Average vocal strain (measured, not inferred): ${label} (${Math.round(avgStress * 100)}%)`);
    }

    const wpmVals = data
      .map((s) => Number(s.avg_speaking_rate_wpm))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (wpmVals.length > 0) {
      const avgWpm = Math.round(wpmVals.reduce((a, b) => a + b, 0) / wpmVals.length);
      lines.push(`- Average speaking rate: ${avgWpm} wpm`);
    }

    // Acoustic emotion inference — only from rows with a real model
    // behind them. Mock rows contribute nothing.
    const arousalVals = data
      .filter((s) => REAL_INFERENCE_SOURCES.has(String(s.inference_source)))
      .map((s) => Number(s.avg_arousal))
      .filter((n) => Number.isFinite(n));
    if (arousalVals.length > 0) {
      const avgArousal = arousalVals.reduce((a, b) => a + b, 0) / arousalVals.length;
      const label = avgArousal > 0.6
        ? "more activated than flat"
        : avgArousal < 0.35
        ? "more flat than activated"
        : "middling";
      lines.push(
        `- Overall vocal activation across ${arousalVals.length} of ${data.length} sessions: ${label}. This is a coarse read with known error — treat it as a hint, never a fact.`,
      );
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}
