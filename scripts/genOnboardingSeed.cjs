/**
 * Generates supabase/migrations/024_onboarding_admin_control.sql.
 *
 * Reads the English i18n catalog and emits seed rows for:
 *   onboarding_screen_config — which built-in screens appear, in what order
 *   onboarding_text          — every admin-editable string, with its default
 *
 * Re-run with:  node scripts/genOnboardingSeed.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnglish() {
  let src = fs.readFileSync(path.join(ROOT, 'lib/i18n/locales/en.ts'), 'utf8');
  src = src.replace(/^import[^;]+;/m, '');
  src = src.replace(/export const \w+\s*=\s*/m, 'module.exports = ');
  src = src.replace(/\bas const\b/g, '');
  src = 'const plural = (o) => ({ __plural: true, ...o });\n' + src;
  const tmp = path.join(ROOT, '.tmp_en_seed.cjs');
  fs.writeFileSync(tmp, src);
  const en = require(tmp);
  fs.unlinkSync(tmp);
  return en;
}

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[p] = v;
    else if (v && typeof v === 'object' && !v.__plural) flatten(v, p, out);
  }
  return out;
}

/** Built-in onboarding screens, in their current flow order. */
const SCREENS = [
  { key: 'Name', label: 'Your name', removable: false },
  { key: 'Intention', label: 'What brings you here', removable: true },
  { key: 'Birth', label: 'Date & time of birth', removable: true },
  { key: 'BirthPlace', label: 'Place of birth', removable: true },
  { key: 'Dosha', label: 'Dosha (Ayurveda)', removable: true },
  { key: 'Enneagram', label: 'Enneagram', removable: true },
  { key: 'Numerology', label: 'Numerology', removable: true },
  { key: 'TCM', label: 'Chinese medicine (5 elements)', removable: true },
  { key: 'MBTI', label: 'Myers-Briggs type', removable: true },
  { key: 'Varna', label: 'Varna disposition', removable: true },
];

const DOSHA_Q = {
  body_frame: 'Body frame',
  stress: 'Under stress',
  energy: 'Energy',
  sleep: 'Sleep',
  learning: 'Learning',
};

/** i18n keys the admin may edit, grouped by screen, with human labels. */
function buildCatalog(en) {
  const flat = flatten(en, '', {});
  const rows = [];
  let order = 0;

  const add = (screen, key, label) => {
    if (typeof flat[key] !== 'string') return;
    rows.push({ key, screen, label, def: flat[key], order: order++ });
  };

  // — simple screens —
  add('Name', 'onboarding.nameHeading', 'Heading');
  add('Name', 'onboarding.nameSub', 'Subheading');
  add('Name', 'onboarding.namePlaceholder', 'Input placeholder');
  add('Name', 'onboarding.privacyNote', 'Privacy note');

  add('Intention', 'onboarding.intentionHeading', 'Heading');
  add('Intention', 'onboarding.intentionPlaceholder', 'Input placeholder');
  add('Intention', 'onboarding.intentionHelper', 'Helper text');

  add('Birth', 'onboarding.birthHeading', 'Heading');
  add('Birth', 'onboarding.unknownTime', 'Unknown-time toggle label');

  add('BirthPlace', 'onboarding.birthPlaceHeading', 'Heading');
  add('BirthPlace', 'onboarding.birthPlaceHelper', 'Helper text');

  // — Dosha quiz —
  let dq = 1;
  for (const [slug, human] of Object.entries(DOSHA_Q)) {
    add('Dosha', `doshaQuiz.${slug}.prompt`, `Q${dq} (${human}) · prompt`);
    add('Dosha', `doshaQuiz.${slug}.vata`, `Q${dq} · option A (scores Vata)`);
    add('Dosha', `doshaQuiz.${slug}.pitta`, `Q${dq} · option B (scores Pitta)`);
    add('Dosha', `doshaQuiz.${slug}.kapha`, `Q${dq} · option C (scores Kapha)`);
    dq++;
  }

  // — Enneagram —
  add('Enneagram', 'enneagram.alreadyKnow', 'Link: already know my type');
  add('Enneagram', 'enneagram.ifYouKnow', 'Eyebrow on self-report view');
  add('Enneagram', 'enneagram.whichType', 'Self-report heading');
  add('Enneagram', 'enneagram.whichTypeLead', 'Self-report lead');
  add('Enneagram', 'enneagram.lensNotBox', 'Result note');
  add('Enneagram', 'enneagram.skipForNow', 'Skip link');
  for (let i = 1; i <= 8; i++) {
    add('Enneagram', `enneagram.questions.q${i}.prompt`, `Q${i} · prompt`);
    add('Enneagram', `enneagram.questions.q${i}.o1`, `Q${i} · option A`);
    add('Enneagram', `enneagram.questions.q${i}.o2`, `Q${i} · option B`);
    add('Enneagram', `enneagram.questions.q${i}.o3`, `Q${i} · option C`);
  }

  // — Numerology —
  add('Numerology', 'numerology.eyebrow', 'Eyebrow');
  add('Numerology', 'numerology.lifePath', 'Heading');
  add('Numerology', 'numerology.lensNote', 'Note under the result');
  add('Numerology', 'numerology.skip', 'Skip link');
  add('Numerology', 'numerology.unreadable', 'Fallback when it cannot be read');

  // — TCM —
  add('TCM', 'tcm.emotionHeading', 'Step 1 heading');
  add('TCM', 'tcm.emotionLead', 'Step 1 lead');
  for (const el of ['Wood', 'Fire', 'Earth', 'Metal', 'Water']) {
    add('TCM', `tcm.emotion.${el}`, `Step 1 · option (scores ${el})`);
  }
  add('TCM', 'tcm.climateHeading', 'Step 2 heading');
  add('TCM', 'tcm.climateLead', 'Step 2 lead');
  for (const el of ['Fire', 'Wood', 'Earth', 'Metal', 'Water']) {
    add('TCM', `tcm.climate.${el}`, `Step 2 · option (scores ${el})`);
  }

  // — MBTI —
  add('MBTI', 'mbti.optional', 'Eyebrow');
  add('MBTI', 'mbti.heading', 'Heading');
  add('MBTI', 'mbti.lead', 'Lead');
  add('MBTI', 'mbti.nonstandard', 'Note for a non-standard type');
  add('MBTI', 'mbti.saveType', 'Save button label');

  // — Varna —
  add('Varna', 'varna.optional', 'Eyebrow');
  add('Varna', 'varna.heading', 'Heading');
  add('Varna', 'varna.lead', 'Lead');
  add('Varna', 'varna.pickVoiceHint', 'Hint under the options');
  for (let i = 1; i <= 4; i++) {
    add('Varna', `varna.questions.q${i}.prompt`, `Q${i} · prompt`);
    add('Varna', `varna.questions.q${i}.o1`, `Q${i} · option A (scores Brahmana)`);
    add('Varna', `varna.questions.q${i}.o2`, `Q${i} · option B (scores Kshatriya)`);
    add('Varna', `varna.questions.q${i}.o3`, `Q${i} · option C (scores Vaishya)`);
    add('Varna', `varna.questions.q${i}.o4`, `Q${i} · option D (scores Shudra)`);
  }
  for (const v of ['brahmana', 'kshatriya', 'vaishya', 'shudra']) {
    add('Varna', `varna.labels.${v}`, `Result label · ${v}`);
  }

  return rows;
}

function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function main() {
  const en = loadEnglish();
  const rows = buildCatalog(en);

  const screenValues = SCREENS.map(
    (s, i) =>
      `  (${sqlStr(s.key)}, ${sqlStr(s.label)}, ${i}, true, ${s.removable})`,
  ).join(',\n');

  const textValues = rows
    .map(
      (r) =>
        `  (${sqlStr(r.key)}, ${sqlStr(r.screen)}, ${sqlStr(r.label)}, ${sqlStr(r.def)}, ${r.order})`,
    )
    .join(',\n');

  const sql = `-- DOST admin: control over the built-in onboarding screens.
--
-- Generated by scripts/genOnboardingSeed.cjs — re-run that script rather
-- than hand-editing the seed rows below.
--
--   onboarding_screen_config  which built-in screens appear and in what
--                             order. Setting is_active = false removes a
--                             screen from the flow without losing its
--                             config. 'Name' is not removable because
--                             saveMyProfile requires a name.
--
--   onboarding_text           every admin-editable string on those
--                             screens. default_text is the shipped
--                             English copy; override_text is what the
--                             admin typed. A non-null override replaces
--                             the string in every language.
--
-- Scoring is carried by the i18n KEY (e.g. doshaQuiz.sleep.vata scores
-- Vata), so editing the text never breaks the psychometrics. Questions
-- cannot be added or removed from a built-in quiz for the same reason.

create table if not exists public.onboarding_screen_config (
  screen_key text primary key,
  label text not null,
  position int not null default 0,
  is_active boolean not null default true,
  is_removable boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_text (
  i18n_key text primary key,
  screen_key text not null,
  field_label text not null,
  default_text text not null,
  override_text text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_text_screen_idx
  on public.onboarding_text (screen_key, sort_order);

insert into public.onboarding_screen_config (screen_key, label, position, is_active, is_removable)
values
${screenValues}
on conflict (screen_key) do nothing;

insert into public.onboarding_text (i18n_key, screen_key, field_label, default_text, sort_order)
values
${textValues}
on conflict (i18n_key) do update
  set screen_key = excluded.screen_key,
      field_label = excluded.field_label,
      default_text = excluded.default_text,
      sort_order = excluded.sort_order;

alter table public.onboarding_screen_config enable row level security;
alter table public.onboarding_text enable row level security;

drop policy if exists "screen_config_read" on public.onboarding_screen_config;
create policy "screen_config_read"
  on public.onboarding_screen_config for select using (true);

drop policy if exists "screen_config_write" on public.onboarding_screen_config;
create policy "screen_config_write"
  on public.onboarding_screen_config for all using (true) with check (true);

drop policy if exists "onboarding_text_read" on public.onboarding_text;
create policy "onboarding_text_read"
  on public.onboarding_text for select using (true);

drop policy if exists "onboarding_text_write" on public.onboarding_text;
create policy "onboarding_text_write"
  on public.onboarding_text for all using (true) with check (true);

grant select, insert, update, delete on public.onboarding_screen_config to anon, authenticated;
grant select, insert, update, delete on public.onboarding_text to anon, authenticated;

notify pgrst, 'reload schema';
`;

  const out = path.join(ROOT, 'supabase/migrations/024_onboarding_admin_control.sql');
  fs.writeFileSync(out, sql);
  console.log(`wrote ${out}`);
  console.log(`  ${SCREENS.length} screens, ${rows.length} editable strings`);
}

main();
