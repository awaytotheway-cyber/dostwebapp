// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals } from "jsr:@std/assert@1";
import { cleanTranscript, encodeWav, floatToPcm16 } from "./pcm.ts";

function int16s(buffer: ArrayBuffer, byteOffset = 0): number[] {
  const view = new DataView(buffer);
  const out: number[] = [];
  for (let i = byteOffset; i + 1 < buffer.byteLength; i += 2) {
    out.push(view.getInt16(i, true));
  }
  return out;
}

Deno.test("whisper gets two bytes per sample, not the four of a Float32Array", () => {
  // whisper.rn's transcribeData reads its ArrayBuffer as signed 16-bit
  // PCM. Handing it a Float32Array's own bytes makes every sample look
  // like two samples of noise — which is how a 14-second segment came
  // back as one word.
  const pcm = new Float32Array(1600);
  assertEquals(floatToPcm16(pcm).byteLength, 3200);
});

Deno.test("samples map onto the full signed 16-bit range", () => {
  const out = int16s(floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5])));
  assertEquals(out, [0, 32767, -32768, 16383, -16384]);
});

Deno.test("out-of-range samples clip instead of wrapping around", () => {
  const out = int16s(floatToPcm16(new Float32Array([1.7, -3, Number.NaN])));
  assertEquals(out, [32767, -32768, 0]);
});

Deno.test("a view into a larger buffer converts only its own samples", () => {
  const backing = new Float32Array([0.9, 0.25, -0.25, 0.9]);
  const view = backing.subarray(1, 3);
  assertEquals(int16s(floatToPcm16(view)), [8191, -8192]);
});

Deno.test("the WAV body is exactly the PCM whisper is given", () => {
  const pcm = new Float32Array([0, 0.5, -0.5, 1]);
  const wav = encodeWav(pcm, 16000);
  const view = new DataView(wav);
  assertEquals(wav.byteLength, 44 + pcm.length * 2);
  assertEquals(view.getUint32(24, true), 16000);
  assertEquals(view.getUint32(40, true), pcm.length * 2);
  assertEquals(int16s(wav, 44), int16s(floatToPcm16(pcm)));
});

Deno.test("whisper's non-speech tags are not counted as words", () => {
  assertEquals(cleanTranscript("[BLANK_AUDIO]"), "");
  assertEquals(cleanTranscript(" [Music] "), "");
  assertEquals(cleanTranscript("(wind blowing)"), "");
  assertEquals(cleanTranscript("♪ ♪"), "");
  assertEquals(
    cleanTranscript("I am so tired [BLANK_AUDIO] of this (sighs)"),
    "I am so tired of this",
  );
});

Deno.test("ordinary speech passes through untouched", () => {
  assertEquals(cleanTranscript("मुझे बहुत थकान है"), "मुझे बहुत थकान है");
  assertEquals(cleanTranscript("  it's fine, really  "), "it's fine, really");
});
