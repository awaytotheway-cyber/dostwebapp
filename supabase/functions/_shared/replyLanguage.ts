/**
 * The app language a person picked, used to steer which language DOST
 * replies in. Mirrors APP_LANGUAGES in lib/i18n/languages.ts.
 */
export const REPLY_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  es: "Spanish",
  de: "German",
  ru: "Russian",
  zh: "Simplified Chinese",
  ja: "Japanese",
};

const SCRIPT_NOTES: Record<string, string> = {
  hi: " (Devanagari script)",
  mr: " (Devanagari script)",
  zh: " (simplified characters)",
};

/** Allowlisted language code from a request body; anything else is English. */
export function parseReplyLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "en";
  const code = raw.trim().toLowerCase();
  return code in REPLY_LANGUAGE_NAMES ? code : "en";
}

/** System-prompt section telling the model which language to answer in. */
export function replyLanguageInstruction(language: string): string {
  if (language === "en" || !(language in REPLY_LANGUAGE_NAMES)) return "";
  const name = REPLY_LANGUAGE_NAMES[language];
  const script = SCRIPT_NOTES[language] ?? "";
  return [
    "REPLY LANGUAGE",
    `The person uses DOST in ${name}. Write every reply in natural, everyday ${name}${script} — the way a warm friend would actually speak, not a formal or literal translation.`,
    "If they write to you in a different language or script (for example Hindi typed in Latin letters), mirror the language and script they used instead.",
    "All the guidance above still applies: same warmth, same brevity, same rules. The examples above are in English only to show tone.",
  ].join("\n");
}
