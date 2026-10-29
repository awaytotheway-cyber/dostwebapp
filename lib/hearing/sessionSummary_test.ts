// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals } from "jsr:@std/assert@1";
import {
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
