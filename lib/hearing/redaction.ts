/**
 * Regex-baseline PII redaction, applied to a Whisper transcript BEFORE
 * it ever reaches the semantic-emotions pipeline.
 *
 * What this catches:
 *   - Phone numbers (Indian mobile, optional +91 country prefix)
 *   - 12-digit ID numbers (Aadhaar-shaped, with optional separators)
 *   - Email addresses
 *   - Address-ish strings ending in road/street/lane/nagar/colony/etc.
 *   - Card numbers (13-16 digits, optionally spaced)
 *
 * What this does NOT catch:
 *   - Personal names, place names, or any contextual identifier that
 *     needs semantic understanding to spot ("my sister Priya", "the
 *     office in Bandra"). Proper NER redaction requires an on-device
 *     tagger, which is a future improvement. The exposure window is
 *     short because the redacted transcript is never stored anyway —
 *     it flows into extract-emotions and is then discarded — but the
 *     limitation is real and worth naming in the UI copy.
 */

// Ordering matters: longer, more-specific numeric patterns run first so
// a 16-digit card can't be partially eaten by the 12-digit id-number
// pattern and leak the trailing 4 digits.
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:\d[ -]*?){13,16}\b/g, '[card-number]'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[id-number]'],
  [/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '[phone]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [
    /\b\d{1,5}\s+[A-Za-z\s]{3,30}\b(?:road|street|lane|nagar|colony|apartment|flat)\b/gi,
    '[address]',
  ],
];

export function redactPII(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
