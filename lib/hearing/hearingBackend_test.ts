// Deno test (the app has no JS test runner): deno test lib/hearing/
// Excluded from tsc via tsconfig "exclude".
import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickHearingBackend, type Listen } from "./hearingBackend.ts";

const core = () => ({
  startSession: () => Promise.resolve(true),
  stopSession: () => Promise.resolve(true),
  isSessionActive: () => Promise.resolve(false),
});

const androidListen: Listen = () => ({ remove() {} });

Deno.test("android uses HearingModule and DeviceEventEmitter", () => {
  const mod = core();
  const b = pickHearingBackend({ os: "android", androidModule: mod, androidListen });
  assert(b);
  assertEquals(b.platform, "android");
  assert(b.module === mod);
  assert(b.listen === androidListen);
});

Deno.test("ios uses the DostHearing module and its own emitter", () => {
  const heard: Array<[string, unknown]> = [];
  const mod = {
    ...core(),
    addListener(event: string, listener: (p: unknown) => void) {
      heard.push([event, listener]);
      return { remove() {} };
    },
  };
  const b = pickHearingBackend({ os: "ios", loadIosModule: () => mod });
  assert(b);
  assertEquals(b.platform, "ios");
  const sub = b.listen("HearingTick", () => {});
  assertEquals(heard.length, 1);
  assertEquals(heard[0][0], "HearingTick");
  assertEquals(typeof sub.remove, "function");
});

// Expo modules are class instances whose addListener reads `this`. A
// listener detached from its module would throw at the first event.
Deno.test("ios listen keeps addListener bound to the module", () => {
  class FakeModule {
    subscribers = 0;
    startSession() { return Promise.resolve(true); }
    stopSession() { return Promise.resolve(true); }
    isSessionActive() { return Promise.resolve(false); }
    addListener(_event: string, _listener: (p: unknown) => void) {
      this.subscribers++;
      return { remove() {} };
    }
  }
  const mod = new FakeModule();
  const b = pickHearingBackend({ os: "ios", loadIosModule: () => mod });
  assert(b);
  b.listen("HearingSpeechSegment", () => {});
  assertEquals(mod.subscribers, 1);
});

// An iPhone running an older build has no DostHearing module. Listening
// must report "not available", not crash.
Deno.test("ios without the module in this build is unavailable, not an error", () => {
  assertEquals(pickHearingBackend({ os: "ios", loadIosModule: () => null }), null);
  assertEquals(
    pickHearingBackend({ os: "ios", loadIosModule: () => { throw new Error("no module"); } }),
    null,
  );
  assertEquals(pickHearingBackend({ os: "ios" }), null);
});

Deno.test("a module missing core functions or events is rejected", () => {
  assertEquals(
    pickHearingBackend({ os: "ios", loadIosModule: () => ({ startSession() {}, addListener() {} }) }),
    null,
    "missing stopSession / isSessionActive",
  );
  assertEquals(
    pickHearingBackend({ os: "ios", loadIosModule: () => core() }),
    null,
    "no addListener: events could never arrive",
  );
  assertEquals(
    pickHearingBackend({ os: "android", androidModule: core() }),
    null,
    "no event source on android",
  );
});

Deno.test("web and unknown platforms have no listening", () => {
  for (const os of ["web", "windows", "macos", ""]) {
    assertEquals(
      pickHearingBackend({ os, androidModule: core(), androidListen, loadIosModule: () => core() }),
      null,
      os,
    );
  }
});

// Each platform's module must never be picked up on the other one.
Deno.test("platforms do not cross over", () => {
  const iosMod = { ...core(), addListener: () => ({ remove() {} }) };
  assertEquals(pickHearingBackend({ os: "android", loadIosModule: () => iosMod }), null);
  assertEquals(pickHearingBackend({ os: "ios", androidModule: core(), androidListen }), null);
});
