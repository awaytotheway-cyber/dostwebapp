// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assertEquals } from "jsr:@std/assert@1";
import {
  enrollmentEngineFor,
  SPEAKER_MODEL_URLS,
  tryInOrder,
} from "./speakerModelSource.ts";

Deno.test("GitHub is tried first, then the Hugging Face mirror", () => {
  assertEquals(SPEAKER_MODEL_URLS.length, 2);
  assertEquals(new URL(SPEAKER_MODEL_URLS[0]).host, "github.com");
  assertEquals(new URL(SPEAKER_MODEL_URLS[1]).host, "huggingface.co");
  // Both must name the same file; the app accepts it only at its exact size.
  for (const url of SPEAKER_MODEL_URLS) {
    assertEquals(url.endsWith("/wespeaker_en_voxceleb_resnet34.onnx"), true);
  }
});

Deno.test("stops at the first source that works", async () => {
  const tried: string[] = [];
  const winner = await tryInOrder(["a", "b", "c"], async (src) => {
    tried.push(src);
    return src === "b";
  });
  assertEquals(winner, "b");
  assertEquals(tried, ["a", "b"]);
});

Deno.test("a source that throws is skipped, not fatal", async () => {
  const winner = await tryInOrder(["blocked", "mirror"], async (src) => {
    if (src === "blocked") throw new Error("network unreachable");
    return true;
  });
  assertEquals(winner, "mirror");
});

Deno.test("null when every source fails", async () => {
  assertEquals(await tryInOrder(["a", "b"], async () => false), null);
  assertEquals(await tryInOrder([], async () => true), null);
});

Deno.test("a phone that can run the model never quietly gets the weak voiceprint", () => {
  assertEquals(enrollmentEngineFor({ neuralSupported: true, modelReady: true }), "neural");
  // The failure that rejected every segment of the owner's own speech:
  // the model could run, but its download failed.
  assertEquals(enrollmentEngineFor({ neuralSupported: true, modelReady: false }), null);
});

Deno.test("the basic voiceprint stays for builds that cannot run the model at all", () => {
  assertEquals(enrollmentEngineFor({ neuralSupported: false, modelReady: false }), "mfcc");
});
