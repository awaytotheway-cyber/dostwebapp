// Deno test (the app has no JS test runner): deno test lib/legal/
// Excluded from tsc via tsconfig "exclude".
//
// The drafts describe what the app really does. These checks catch the
// two ways they could quietly become wrong: an invented detail where
// only the owner knows the answer, and a promise the code doesn't keep.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { LEGAL_DOCUMENTS } from "./index.ts";

function allText(doc: (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS]): string {
  return [doc.intro ?? "", ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");
}

Deno.test("both documents exist, are marked draft, and have content", () => {
  for (const key of ["privacy", "terms"] as const) {
    const doc = LEGAL_DOCUMENTS[key];
    assertEquals(doc.isDraft, true, `${key} must stay marked draft until legal review`);
    assert(doc.sections.length >= 5, `${key} looks too thin`);
    for (const s of doc.sections) {
      assert(s.heading.trim().length > 0, `${key}: empty heading`);
      assert(s.paragraphs.length > 0, `${key}: "${s.heading}" has no text`);
    }
  }
});

Deno.test("facts only the owner knows are placeholders, never invented", () => {
  for (const key of ["privacy", "terms"] as const) {
    const text = allText(LEGAL_DOCUMENTS[key]);
    assert(/\[Contact email[^\]]*\]/.test(text), `${key}: contact email must be a placeholder`);
    assert(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(text), `${key}: contains what looks like a real email address`);
  }
  assert(/\[Minimum age[^\]]*\]/.test(allText(LEGAL_DOCUMENTS.terms)), "terms: minimum age must be a placeholder");
});

Deno.test("the privacy policy names every service that receives personal data", () => {
  const text = allText(LEGAL_DOCUMENTS.privacy);
  for (const name of ["Supabase", "OpenAI", "Groq", "Google"]) {
    assert(text.includes(name), `privacy policy must name ${name}`);
  }
});

Deno.test("the privacy policy keeps the promises the app makes", () => {
  const text = allText(LEGAL_DOCUMENTS.privacy).toLowerCase();
  // Listening audio lives only in memory and is never stored.
  assert(text.includes("listening") && text.includes("never saved"), "listening audio: never saved");
  // Voice notes can be kept, so the policy must not claim otherwise.
  assert(text.includes("voice note"), "voice notes must be covered");
  // Daily summaries: covered, exported and deleted with conversations.
  assert(text.includes("daily summar"), "daily summaries must be covered");
  assert(text.includes("export"), "export must be described");
  assert(text.includes("delete"), "deletion must be described");
});

Deno.test("the terms say DOST is not an emergency service and how to get help", () => {
  const text = allText(LEGAL_DOCUMENTS.terms);
  assert(/not .*emergency/i.test(text), "terms must say DOST is not an emergency service");
  assert(text.includes("14416"), "terms must give Tele-MANAS 14416");
});
