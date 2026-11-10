// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals } from "jsr:@std/assert@1";
import {
  countLabels,
  isCountable,
  MIN_SEMANTIC_CONFIDENCE,
  summariseSignals,
  summaryInferenceSource,
  type SessionTotals,
  type VoiceSignalRow,
} from "./sessionSummary.ts";

const totals: SessionTotals = {
  startedAt: Date.parse("2026-10-20T09:00:00Z"),
  endedAt: Date.parse("2026-10-20T09:30:00Z"),
  totalSeconds: 1800,
  speechSeconds: 420,
  totalSegments: 12,
  matchedSegments: 9,
};

function signal(over: Partial<VoiceSignalRow> = {}): VoiceSignalRow {
  return {
    rms_energy: 0.4,
    pitch_mean_hz: 120,
    pitch_variability: 0.2,
    speaking_rate_wpm: 140,
    silence_ratio: 0.3,
    vocal_stress_index: 0.5,
    primary_emotion: "weariness",
    secondary_emotions: null,
    underlying_need: "rest",
    semantic_confidence: 0.8,
    acoustic_arousal: 0.6,
    acoustic_valence: 0.5,
    inference_source: "mock",
    ...over,
  };
}

Deno.test("counts primary and secondary emotions, and picks the dominant", () => {
  const out = summariseSignals(
    [
      signal({ primary_emotion: "grief", secondary_emotions: ["weariness"], underlying_need: "rest" }),
      signal({ primary_emotion: "grief", secondary_emotions: null, underlying_need: "support" }),
      signal({ primary_emotion: "weariness", secondary_emotions: ["grief"], underlying_need: "rest" }),
    ],
    totals,
  );
  assertEquals(out.emotion_counts, { grief: 3, weariness: 2 });
  assertEquals(out.dominant_emotion, "grief");
  assertEquals(out.need_counts, { rest: 2, support: 1 });
  assertEquals(out.dominant_need, "rest");
});

Deno.test("session facts are carried through", () => {
  const out = summariseSignals([signal()], totals);
  assertEquals(out.session_started_at, "2026-10-20T09:00:00.000Z");
  assertEquals(out.session_ended_at, "2026-10-20T09:30:00.000Z");
  assertEquals(out.session_duration_seconds, 1800);
  assertEquals(out.speech_duration_seconds, 420);
  assertEquals(out.total_segments, 12);
  assertEquals(out.matched_segments, 9);
});

Deno.test("averages skip nulls, and skip zero pitch (meaning not detected)", () => {
  const out = summariseSignals(
    [
      signal({ pitch_mean_hz: 100, vocal_stress_index: 0.2 }),
      signal({ pitch_mean_hz: 0, vocal_stress_index: null }),
      signal({ pitch_mean_hz: 200, vocal_stress_index: 0.4 }),
    ],
    totals,
  );
  assertEquals(out.avg_pitch_mean_hz, 150);
  assertEquals(out.avg_vocal_stress_index, 0.3);
});

Deno.test("no usable values gives null, never a fabricated zero", () => {
  const out = summariseSignals(
    [signal({ vocal_stress_index: null, acoustic_arousal: null, acoustic_valence: null })],
    totals,
  );
  assertEquals(out.avg_vocal_stress_index, null);
  assertEquals(out.avg_arousal, null);
  assertEquals(out.avg_valence, null);
});

Deno.test("one mock segment taints the whole summary's arousal provenance", () => {
  assertEquals(summaryInferenceSource([signal(), signal()]), "mock");
  assertEquals(
    summaryInferenceSource([
      signal({ inference_source: "acoustic_v1" }),
      signal({ inference_source: "mock" }),
    ]),
    "mock",
  );
  assertEquals(
    summaryInferenceSource([
      signal({ inference_source: "acoustic_v1" }),
      signal({ inference_source: "acoustic_v1" }),
    ]),
    "acoustic_v1",
  );
  assertEquals(
    summaryInferenceSource([
      signal({ inference_source: "acoustic_v1" }),
      signal({ inference_source: "fused_v1" }),
    ]),
    "fused_v1",
  );
  // An unknown or absent tag is not a real source.
  assertEquals(summaryInferenceSource([signal({ inference_source: null })]), "mock");
  assertEquals(summaryInferenceSource([]), "mock");
});

Deno.test("empty or label-less signals still produce a valid row", () => {
  const out = summariseSignals(
    [signal({ primary_emotion: null, secondary_emotions: null, underlying_need: null })],
    totals,
  );
  assertEquals(out.emotion_counts, {});
  assertEquals(out.dominant_emotion, null);
  assertEquals(out.need_counts, {});
  assertEquals(out.dominant_need, null);
  assertEquals(out.inference_source, "mock");
});

Deno.test("ties break alphabetically so the dominant label is stable", () => {
  const out = summariseSignals(
    [signal({ primary_emotion: "weariness" }), signal({ primary_emotion: "grief" })],
    totals,
  );
  assertEquals(out.dominant_emotion, "grief");
});

// ─── what counts as a feeling heard ──────────────────────────────

Deno.test("a low-confidence label is not counted, but its acoustics still are", () => {
  // The classifier's "too short or unclear" answer — the label every
  // segment got while transcription was feeding it noise.
  const out = summariseSignals(
    [
      signal({ primary_emotion: "detachment", underlying_need: "understanding", semantic_confidence: 0.2, vocal_stress_index: 0.2 }),
      signal({ primary_emotion: "grief", underlying_need: "support", semantic_confidence: 0.9, vocal_stress_index: 0.4 }),
    ],
    totals,
  );
  assertEquals(out.emotion_counts, { grief: 1 });
  assertEquals(out.need_counts, { support: 1 });
  assertEquals(out.avg_vocal_stress_index, 0.3);
});

Deno.test("the threshold is inclusive", () => {
  assertEquals(MIN_SEMANTIC_CONFIDENCE, 0.5);
  assertEquals(isCountable(signal({ semantic_confidence: 0.5 })), true);
  assertEquals(isCountable(signal({ semantic_confidence: 0.49 })), false);
});

Deno.test("a label with no confidence recorded is not trusted", () => {
  assertEquals(isCountable(signal({ semantic_confidence: null })), false);
});

Deno.test("confidence read back as a numeric string still counts", () => {
  // Postgres numeric can arrive as a string, depending on the client.
  const row = signal({ semantic_confidence: "0.7" as unknown as number });
  assertEquals(isCountable(row), true);
});

Deno.test("neutral speech is recorded but never counted as a feeling", () => {
  const out = summariseSignals(
    [
      signal({ primary_emotion: "neutral", secondary_emotions: [], underlying_need: null, semantic_confidence: 0.95 }),
      signal({ primary_emotion: "neutral", secondary_emotions: [], underlying_need: null, semantic_confidence: 0.95 }),
      signal({ primary_emotion: "fear", secondary_emotions: ["neutral"], underlying_need: "safety" }),
    ],
    totals,
  );
  assertEquals(out.emotion_counts, { fear: 1 });
  assertEquals(out.dominant_emotion, "fear");
  assertEquals(out.need_counts, { safety: 1 });
});

Deno.test("a need attached to a neutral passage is not counted either", () => {
  assertEquals(
    countLabels([signal({ primary_emotion: "neutral", underlying_need: "understanding", semantic_confidence: 0.9 })]),
    { emotion_counts: {}, need_counts: {} },
  );
});

Deno.test("a session with nothing clear enough has no dominant feeling", () => {
  const out = summariseSignals(
    [
      signal({ primary_emotion: "detachment", semantic_confidence: 0.3 }),
      signal({ primary_emotion: "neutral", semantic_confidence: 0.9 }),
    ],
    totals,
  );
  assertEquals(out.emotion_counts, {});
  assertEquals(out.dominant_emotion, null);
  assertEquals(out.need_counts, {});
  assertEquals(out.dominant_need, null);
});

Deno.test("the session screen and the stored summary count the same way", () => {
  const rows = [
    signal({ primary_emotion: "grief", secondary_emotions: ["weariness"] }),
    signal({ primary_emotion: "detachment", semantic_confidence: 0.2 }),
  ];
  const out = summariseSignals(rows, totals);
  assertEquals(countLabels(rows), { emotion_counts: out.emotion_counts, need_counts: out.need_counts });
});
