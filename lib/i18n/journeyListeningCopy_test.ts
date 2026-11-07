// Deno test. Needs --sloppy-imports because the locale files import
// '../core' without an extension:
//
//   deno test --allow-import --sloppy-imports lib/i18n/
//
// Excluded from tsc via tsconfig "exclude".
//
// WHY THIS EXISTS. The Messages<T> type already makes tsc reject a
// locale that is missing a key, so that is not what this covers. What
// tsc cannot see is the inside of a string: a placeholder typed as
// {duraton} compiles perfectly and then renders literally, as
// "background — {duraton}, across 3 sessions", to someone reading in a
// language nobody on the team speaks. These assertions read the real
// locale files and check the sentences actually come out whole.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { interpolate, isPlural, lookup, pickPlural } from "./core.ts";
import { describeListenedDuration } from "../journeyListening.ts";

const LANGS = ["en", "hi", "mr", "es", "de", "ja", "zh", "ru"] as const;

const PLAIN_KEYS = [
  "journey.listeningTitle",
  "journey.listeningHeard",
  "journey.listeningNeeds",
  "journey.listeningSparse",
  "journey.listeningToneHeld",
  "journey.listeningHint",
] as const;

const PLURAL_KEYS = [
  "journey.listeningMinutes",
  "journey.listeningHours",
  "journey.listeningSessions",
] as const;

async function messagesFor(lang: string): Promise<unknown> {
  const mod = await import(`./locales/${lang}.ts`);
  return mod.default ?? Object.values(mod)[0];
}

/** Any {placeholder} left after interpolation is a typo in the copy. */
function assertFullySubstituted(lang: string, key: string, text: string): void {
  const leftover = text.match(/\{(\w+)\}/g);
  assertEquals(
    leftover,
    null,
    `${lang}: ${key} left ${leftover?.join(", ")} unsubstituted — check the placeholder spelling`,
  );
}

Deno.test("every locale carries the listening copy, and it is not empty", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    for (const key of PLAIN_KEYS) {
      const v = lookup(M, key);
      assert(typeof v === "string", `${lang}: ${key} missing or not a string`);
      assert(v.trim().length > 0, `${lang}: ${key} is blank`);
    }
    for (const key of PLURAL_KEYS) {
      const v = lookup(M, key);
      assert(isPlural(v), `${lang}: ${key} is not a plural entry`);
    }
  }
});

Deno.test("the hint sentence composes whole in every locale and every count", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    // 0 and 1 for the singular forms, 2-5 for languages with a 'few',
    // 11 and 21 for the Russian cases that trip naive rules, plus a
    // long span to reach the hours wording.
    for (const sessions of [1, 2, 3, 5, 11, 21, 101]) {
      for (const secs of [30, 60, 45 * 60, 89 * 60, 5 * 3600]) {
        const d = describeListenedDuration(secs);
        const duration = interpolate(
          pickPlural(lang as never, lookup(M, d.key) as never, d.amount),
          { count: d.amount },
        );
        const sessionsText = interpolate(
          pickPlural(
            lang as never,
            lookup(M, "journey.listeningSessions") as never,
            sessions,
          ),
          { count: sessions },
        );
        assertFullySubstituted(lang, d.key, duration);
        assertFullySubstituted(lang, "journey.listeningSessions", sessionsText);

        const hint = interpolate(
          lookup(M, "journey.listeningHint") as string,
          { duration, sessions: sessionsText },
        );
        assertFullySubstituted(lang, "journey.listeningHint", hint);
        // The count must survive into the final sentence, or the person
        // is told "minutes" with no number.
        assert(
          hint.includes(String(d.amount)),
          `${lang}: hint lost the duration number (${hint})`,
        );
      }
    }
  }
});

Deno.test("the emotion and need lines take their lists", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    const heard = interpolate(lookup(M, "journey.listeningHeard") as string, {
      emotions: "anxiety, weariness",
    });
    const needs = interpolate(lookup(M, "journey.listeningNeeds") as string, {
      needs: "rest, ease",
    });
    assertFullySubstituted(lang, "journey.listeningHeard", heard);
    assertFullySubstituted(lang, "journey.listeningNeeds", needs);
    assert(heard.includes("anxiety"), `${lang}: heard line dropped the list`);
    assert(needs.includes("rest"), `${lang}: needs line dropped the list`);
  }
});

// The tone caveat is the user-facing half of the mock quarantine. If it
// ever goes missing in a language, that language silently stops telling
// people their tone is not being read.
Deno.test("the tone caveat says something in every locale", async () => {
  for (const lang of LANGS) {
    const M = await messagesFor(lang);
    const text = lookup(M, "journey.listeningToneHeld");
    assert(typeof text === "string" && text.trim().length > 10, `${lang}`);
    assertFullySubstituted(lang, "journey.listeningToneHeld", text as string);
  }
});
