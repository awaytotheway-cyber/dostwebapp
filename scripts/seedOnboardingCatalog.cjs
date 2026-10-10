/**
 * Seeds onboarding_screen_config and onboarding_text from the generated
 * migration's INSERT statements, via PostgREST.
 *
 * Run after applying 024_onboarding_admin_control.sql's DDL:
 *   node scripts/seedOnboardingCatalog.cjs
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from admin/.env.local so there
 * is one place holding the project credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readEnv() {
  const envPath = path.join(ROOT, 'admin/.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return {
    url: out.VITE_SUPABASE_URL,
    key: out.VITE_SUPABASE_ANON_KEY,
  };
}

/** Pull the VALUES tuples back out of the generated migration. */
function parseMigration() {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/024_onboarding_admin_control.sql'),
    'utf8',
  );

  const unq = (s) => s.slice(1, -1).replace(/''/g, "'");

  const screensBlock = sql.split('insert into public.onboarding_screen_config')[1].split('on conflict')[0];
  const screens = [];
  for (const m of screensBlock.matchAll(/\(\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*,\s*(\d+)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g)) {
    screens.push({
      screen_key: unq(m[1]),
      label: unq(m[2]),
      position: Number(m[3]),
      is_active: m[4] === 'true',
      is_removable: m[5] === 'true',
    });
  }

  const textBlock = sql.split('insert into public.onboarding_text')[1].split('on conflict')[0];
  const texts = [];
  for (const m of textBlock.matchAll(/\(\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*,\s*(\d+)\s*\)/g)) {
    texts.push({
      i18n_key: unq(m[1]),
      screen_key: unq(m[2]),
      field_label: unq(m[3]),
      default_text: unq(m[4]),
      sort_order: Number(m[5]),
    });
  }

  return { screens, texts };
}

async function upsert(url, key, table, rows, onConflict) {
  const res = await fetch(
    `${url}/rest/v1/${table}?on_conflict=${onConflict}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    throw new Error(`${table}: ${res.status} ${await res.text()}`);
  }
}

(async () => {
  const { url, key } = readEnv();
  if (!url || !key) throw new Error('Missing Supabase creds in admin/.env.local');

  const { screens, texts } = parseMigration();
  console.log(`parsed ${screens.length} screens, ${texts.length} strings`);

  await upsert(url, key, 'onboarding_screen_config', screens, 'screen_key');
  console.log('seeded onboarding_screen_config');

  // Preserve any override_text the admin already set.
  await upsert(url, key, 'onboarding_text', texts, 'i18n_key');
  console.log('seeded onboarding_text');
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
