// Deno test. Needs --sloppy-imports because the locale files import
// '../core' without an extension:
//
//   deno test --allow-import --sloppy-imports lib/i18n/
//
// Excluded from tsc via tsconfig "exclude".
//
// WHY THIS EXISTS. The listening disclosure is a consent screen, and it
// once promised "Audio never leaves your device" while every transcript
// was being sent to OpenAI for feeling labels. These checks keep the
// facts that matter on that screen in every language, and keep the one
// placeholder in the rewritten copy spelled right.

import { assert } from "jsr:@std/assert@1";
import { interpolate, lookup } from "./core.ts";

const LANGS = ["en", "hi", "mr", "es", "de", "ja", "zh", "ru"] as const;

const REWRITTEN = [
  "disclosure.copy",
  "disclosure.bullet1",
  "disclosure.bullet3",
  "disclosure.bullet4",
  "listening.subtitle",
  "listening.preparingBody",
  "listening.mockBanner",
  "listening.modeHint.attentive",
  "listening.modeHint.balanced",
  "listening.modeHint.light",
  "hearingSettings.cloudOnHint",
  "hearingSettings.cloudOffHint",
  "permissions.micBody",
  "permissions.unavailableHere",
] as const;

async function messagesFor(lang: string): Promise<unknown> {
  const mod = await import(`./locales/${lang}.ts`);
  return mod.default ?? Object.values(mod)[0];
}

function text(M: unknown, lang: string, key: string): string {
  const v = lookup(M, key);
  assert(typeof v === "string" && v.trim().length > 0, `${lang}: ${key} missing or blank`);
  return v;
}

Deno.test("every locale carries the rewritten listening copy", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    for (const key of REWRITTEN) text(M, lang, key);
  }
});

Deno.test("the download size is filled in, in every locale", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    const out = interpolate(text(M, lang, "listening.preparingBody"), { mb: 57 });
    assert(out.includes("57"), `${lang}: preparingBody lost its {mb} placeholder`);
    assert(!/\{\w+\}/.test(out), `${lang}: preparingBody has an unknown placeholder`);
  }
});

Deno.test("the disclosure names who reads the words, in every locale", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    assert(
      text(M, lang, "disclosure.bullet3").includes("OpenAI"),
      `${lang}: disclosure.bullet3 must say the text goes to OpenAI`,
    );
  }
});

Deno.test("the listening indicator is described for both platforms, in every locale", async () => {
  // Android shows a notification; iOS shows only its microphone
  // indicator. Promising a notification on an iPhone is a false promise.
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    const v = text(M, lang, "disclosure.bullet4");
    assert(v.includes("Android") && v.includes("iPhone"), `${lang}: bullet4 must cover Android and iPhone`);
  }
});

Deno.test("no locale still promises that nothing leaves the phone", async () => {
  // The English phrases that were false; translations are checked by the
  // OpenAI test above, and by a human reading them.
  const M = await messagesFor("en");
  const banned = [
    /never leaves/i,
    /stays on your phone/i,
    /entirely on your phone/i,
    /anonymous/i,
    /android-only/i,
  ];
  for (const key of REWRITTEN) {
    const v = text(M, "en", key);
    for (const re of banned) assert(!re.test(v), `en: ${key} still says ${re}`);
  }
});

Deno.test("the model-download failure says how to retry, in every locale", async () => {
  // The message tells the person to tap Begin again; it must name the
  // button by the label they actually see in their language.
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    text(M, lang, "enrollment.modelFailedTitle");
    const body = text(M, lang, "enrollment.modelFailedBody");
    const begin = text(M, lang, "enrollment.begin");
    assert(body.includes(begin), `${lang}: modelFailedBody should name the "${begin}" button`);
  }
});
