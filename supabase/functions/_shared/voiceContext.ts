/**
 * Private tonal lens from listening sessions (Phase 3).
 *
 * Folds recent listening_summaries rows into one short system-prompt
 * block. Labels and numbers only — the summaries carry no audio and no
 * transcript text, so none can reach the prompt.
 *
 * THE MOCK QUARANTINE. A summary row mixes two kinds of data:
 *
 *   REAL  emotion/need distributions (semantic, from the redacted
 *         transcript) and measured acoustic features — speaking rate,
 *         vocal strain, silence. Direct signal processing.
 *   MOCK  avg_arousal / avg_valence — acoustic emotion inference,
 *         faked since Phase 1.
 *
 * inference_source marks the provenance of arousal/valence only. Rows are
 * NOT dropped when it reads 'mock' — that would throw away real voice
 * data over a field we weren't going to use. Instead arousal is read only
 * from rows explicitly marked 'acoustic_v1' or 'fused_v1'. Until Phase 4
 * validates a real model that means never, so no fabricated number can
 * reach a reply.
 *
 * Tone rules live in the block itself: this is background colour for
 * pacing and warmth, never something DOST may claim out loud. What the
 * person says in this conversation always outranks it.
 */

export type VoiceSummaryRow = {
  session_started_at?: string | null;
  speech_duration_seconds?: number | null;
  emotion_counts?: Record<string, number> | null;
  need_counts?: Record<string, number> | null;
  avg_speaking_rate_wpm?: number | null;
  avg_vocal_stress_index?: number | null;
  avg_silence_ratio?: number | null;
  avg_arousal?: number | null;
  inference_source?: string | null;
};

const REAL_INFERENCE_SOURCES = new Set(["acoustic_v1", "fused_v1"]);

/** Labels are model output; keep prompt-injection surface closed. */
function safeLabel(value: string): string {
  return value.replace(/[{}]/g, "").trim().slice(0, 40);
}

function topLabels(
  rows: VoiceSummaryRow[],
  pick: (row: VoiceSummaryRow) => Record<string, number> | null | undefined,
  limit: number,
): string[] {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const counts = pick(row);
    if (!counts || typeof counts !== "object") continue;
    for (const [rawLabel, rawCount] of Object.entries(counts)) {
      const label = safeLabel(rawLabel);
      const count = typeof rawCount === "number" ? rawCount : Number(rawCount);
      if (!label || !Number.isFinite(count) || count <= 0) continue;
      totals[label] = (totals[label] ?? 0) + count;
    }
  }
  return Object.entries(totals)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
  );
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/**
 * The block, or "" when there is nothing worth saying. Callers inject it
 * verbatim; it already carries its own usage rules.
 */
export function formatVoiceContext(rows: VoiceSummaryRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const emotions = topLabels(rows, (r) => r.emotion_counts, 5);
  const needs = topLabels(rows, (r) => r.need_counts, 3);
  const stress = average(rows.map((r) => r.avg_vocal_stress_index));
  const wpm = average(rows.map((r) => r.avg_speaking_rate_wpm));

  const observations: string[] = [];
  if (emotions.length > 0) {
    observations.push(`- Themes heard most often: ${emotions.join(", ")}.`);
  }
  if (needs.length > 0) {
    observations.push(`- Needs that surfaced: ${needs.join(", ")}.`);
  }
  if (stress !== null) {
    const label = stress > 0.6 ? "elevated" : stress > 0.3 ? "moderate" : "low";
    observations.push(`- Vocal strain, measured across those sessions: ${label}.`);
  }
  if (wpm !== null) {
    const pace = wpm > 170 ? "quick" : wpm < 110 ? "unhurried" : "steady";
    observations.push(`- Speaking pace: generally ${pace}.`);
  }

  // Acoustic emotion inference — only where a validated model produced it.
  const arousals = rows
    .filter((r) => REAL_INFERENCE_SOURCES.has(String(r.inference_source)))
    .map((r) => r.avg_arousal)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (arousals.length > 0) {
    const avg = arousals.reduce((a, b) => a + b, 0) / arousals.length;
    const label = avg > 0.6
      ? "more activated than flat"
      : avg < 0.35
      ? "more flat than activated"
      : "middling";
    observations.push(
      `- Overall vocal activation: ${label}. A coarse read with known error — a hint, never a fact.`,
    );
  }

  if (observations.length === 0) return "";

  const speechMinutes = Math.round(
    rows.reduce((sum, r) => sum + (Number(r.speech_duration_seconds) || 0), 0) / 60,
  );
  const scope = `${rows.length} recent listening ${rows.length === 1 ? "session" : "sessions"}` +
    (speechMinutes > 0 ? `, about ${speechMinutes} minutes of speech` : "");

  return [
    `PRIVATE TONAL LENS (from ${scope} the person chose to record — never shown to them, never mentioned)`,
    ...observations,
    "How to use this:",
    "- It is background colour for your tone and pacing. It is not something that happened in this conversation.",
    "- NEVER tell them what you heard, that you were listening, or how they sounded. Never say \"you've seemed…\" on this basis alone.",
    "- It describes recent weeks in aggregate, never a specific moment, and it is never grounds for a confident claim about today.",
    "- What they say to you right now always outranks it. If the two disagree, follow their words and let this go.",
  ].join("\n");
}
