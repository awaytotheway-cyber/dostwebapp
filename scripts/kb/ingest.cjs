#!/usr/bin/env node
/**
 * Knowledge-base loader: the mentor's modules → kb_modules (the bot's brain).
 *
 * The chat function embeds each user message and pulls the closest
 * kb_modules rows into the prompt (match_modules). This script fills that
 * table: it reads .docx / .txt / .md files, splits each into ~1,400
 * character sections on paragraph boundaries, embeds them with the same
 * model chat uses (OpenAI text-embedding-3-small, 1536 dims) and upserts
 * them. Smaller sections match a short chat message far better than
 * whole chapters do.
 *
 * Credentials come from the environment or from a .env.kb file at the
 * repo root (gitignored):
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=...   (Dashboard → Project Settings → API)
 *   OPENAI_API_KEY=sk-...
 *
 * Commands:
 *   node scripts/kb/ingest.cjs plan <files|folder>    preview sections, writes nothing
 *   node scripts/kb/ingest.cjs add  <files|folder>    load / replace those modules
 *   node scripts/kb/ingest.cjs list                   modules currently loaded
 *   node scripts/kb/ingest.cjs remove "<title>"       delete one module
 *   node scripts/kb/ingest.cjs rechunk --yes          re-split what is already loaded
 *
 * A module's title is its file name without the extension. Adding a file
 * whose title is already loaded replaces that module (new rows go in
 * first, old rows are deleted after), so re-running is safe.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;
const EMBED_BATCH = 64;
const TARGET_CHARS = 1400;
const MAX_CHARS = 2000;
const OVERLAP_MAX_CHARS = 350;
const SUPPORTED = new Set(['.docx', '.txt', '.md']);
const PART_SUFFIX = /\s*\(part \d+ of \d+\)\s*$/i;

// ─── text extraction ──────────────────────────────────────────────

/** Minimal zip reader: returns the named entry's bytes, or null. */
function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const start =
        local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip compression ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Word document → plain text, one paragraph per line; table cells joined by " | ". */
function docxToText(file) {
  const xml = readZipEntry(fs.readFileSync(file), 'word/document.xml');
  if (!xml) throw new Error('word/document.xml not found');
  const doc = xml.toString('utf8');
  // Text runs, tabs and line breaks, in document order.
  const paragraphText = (p) => {
    const parts = [];
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g)) {
      parts.push(m[1] !== undefined ? m[1] : m[0].startsWith('<w:tab') ? '\t' : '\n');
    }
    return decodeXml(parts.join(''));
  };
  const lines = [];
  const body = doc.split(/<w:body>/)[1] ?? doc;
  // Walk top-level paragraphs and tables in order.
  const blockRe = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const block of body.match(blockRe) ?? []) {
    if (block.startsWith('<w:tbl>')) {
      for (const row of block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
          (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paragraphText).join(' ').trim(),
        );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
    } else {
      lines.push(paragraphText(block));
    }
  }
  return lines.join('\n');
}

function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') return docxToText(file);
  return fs.readFileSync(file, 'utf8');
}

// ─── chunking ─────────────────────────────────────────────────────

function splitLongParagraph(p) {
  if (p.length <= MAX_CHARS) return [p];
  const sentences = p.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) ?? [p];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > TARGET_CHARS) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  // A single run-on "sentence" longer than MAX_CHARS: hard-wrap on spaces.
  return out.flatMap((c) => {
    if (c.length <= MAX_CHARS) return [c];
    const words = c.split(/\s+/);
    const parts = [];
    let w = '';
    for (const word of words) {
      if (w && w.length + word.length + 1 > TARGET_CHARS) {
        parts.push(w);
        w = '';
      }
      w = w ? `${w} ${word}` : word;
    }
    if (w) parts.push(w);
    return parts;
  });
}

/**
 * Paragraph-aware packing into ~TARGET_CHARS sections. A short trailing
 * paragraph is repeated at the start of the next section so an idea that
 * straddles the boundary is findable from either side.
 */
function chunkText(text) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const p of paragraphs) {
    if (len > 0 && len + p.length + 1 > TARGET_CHARS) {
      chunks.push(cur.join('\n'));
      const last = cur[cur.length - 1];
      cur = last.length <= OVERLAP_MAX_CHARS ? [last] : [];
      len = cur.reduce((n, s) => n + s.length + 1, 0);
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) {
    const tail = cur.join('\n');
    // Fold a tiny tail into the previous section instead of a stub row.
    if (chunks.length && tail.length < 300 && chunks[chunks.length - 1].length + tail.length < MAX_CHARS) {
      chunks[chunks.length - 1] += `\n${tail}`;
    } else {
      chunks.push(tail);
    }
  }
  return chunks;
}

function sectionNames(title, n) {
  if (n === 1) return [title];
  return Array.from({ length: n }, (_, i) => `${title} (part ${i + 1} of ${n})`);
}

function titleFromFile(file) {
  return path.basename(file, path.extname(file)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectFiles(args) {
  const files = [];
  for (const a of args) {
    const p = path.resolve(a);
    if (!fs.existsSync(p)) throw new Error(`not found: ${a}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) {
        if (f.startsWith('~$') || f.startsWith('.')) continue; // Word lock files, dotfiles
        if (SUPPORTED.has(path.extname(f).toLowerCase())) files.push(path.join(p, f));
      }
    } else if (SUPPORTED.has(path.extname(p).toLowerCase())) {
      files.push(p);
    } else {
      throw new Error(`unsupported file type: ${a} (use .docx, .txt or .md)`);
    }
  }
  if (!files.length) throw new Error('no .docx / .txt / .md files found');
  return files;
}

// ─── Supabase + OpenAI ────────────────────────────────────────────

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env.kb');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const need = (k) => {
    if (!env[k]) throw new Error(`missing ${k} — set it in the environment or in .env.kb`);
    return env[k];
  };
  return {
    url: need('SUPABASE_URL').replace(/\/$/, ''),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    openaiKey: () => need('OPENAI_API_KEY'),
  };
}

async function rest(env, method, query, body, prefer) {
  const res = await fetch(`${env.url}/rest/v1/kb_modules${query}`, {
    method,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchAllRows(env, select = 'id,module_name,content') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(env, 'GET', `?select=${select}&order=id.asc&offset=${from}&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function embed(env, texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openaiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.slice(i, i + EMBED_BATCH), dimensions: EMBED_DIMS }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text).data.sort((a, b) => a.index - b.index);
    out.push(...data.map((d) => d.embedding));
  }
  return out;
}

/** Rows belonging to one module title: the bare title or "<title> (part i of n)". */
function rowsForTitle(rows, title) {
  const t = title.toLowerCase();
  return rows.filter((r) => (r.module_name ?? '').replace(PART_SUFFIX, '').trim().toLowerCase() === t);
}

/** Insert the new sections, then delete the module's previous rows. */
async function replaceModule(env, title, chunks, existingRows) {
  const names = sectionNames(title, chunks.length);
  // Embed title + body, exactly as embed-modules does.
  const vectors = await embed(env, chunks.map((c, i) => `${names[i]}\n\n${c}`));
  const inserted = await rest(
    env,
    'POST',
    '?select=id',
    chunks.map((content, i) => ({ module_name: names[i], content, embedding: vectors[i] })),
    'return=representation',
  );
  const oldIds = rowsForTitle(existingRows, title).map((r) => r.id);
  for (let i = 0; i < oldIds.length; i += 100) {
    await rest(env, 'DELETE', `?id=in.(${oldIds.slice(i, i + 100).join(',')})`);
  }
  return { inserted: inserted.length, removed: oldIds.length };
}

// ─── commands ─────────────────────────────────────────────────────

function planFiles(files) {
  return files.map((file) => {
    const title = titleFromFile(file);
    const chunks = chunkText(extractText(file));
    return { file, title, chunks };
  });
}

function printPlan(plans) {
  let total = 0;
  for (const p of plans) {
    total += p.chunks.length;
    const sizes = p.chunks.map((c) => c.length);
    console.log(
      `${p.title}\n  ${p.chunks.length} section(s), ${sizes.reduce((a, b) => a + b, 0)} chars` +
        (sizes.length ? ` (min ${Math.min(...sizes)}, max ${Math.max(...sizes)})` : ''),
    );
    if (!p.chunks.length) console.log('  ⚠ no text found — is this a scanned PDF/image saved as .docx?');
  }
  console.log(`\n${plans.length} module(s), ${total} section(s).`);
}

async function cmdPlan(args) {
  const plans = planFiles(collectFiles(args));
  printPlan(plans);
  if (process.env.KB_SHOW) {
    for (const p of plans) {
      p.chunks.forEach((c, i) => console.log(`\n── ${sectionNames(p.title, p.chunks.length)[i]} ──\n${c}`));
    }
  }
}

async function cmdAdd(args) {
  const env = loadEnv();
  const plans = planFiles(collectFiles(args)).filter((p) => p.chunks.length);
  const existing = await fetchAllRows(env, 'id,module_name');
  for (const p of plans) {
    const r = await replaceModule(env, p.title, p.chunks, existing);
    console.log(`✓ ${p.title}: ${r.inserted} section(s) loaded${r.removed ? `, replaced ${r.removed} old row(s)` : ''}`);
  }
  console.log('\nDone. The chat function uses the new sections from the next message on.');
}

async function cmdList() {
  const env = loadEnv();
  const rows = await fetchAllRows(env, 'id,module_name,content,embedding');
  const modules = new Map();
  for (const r of rows) {
    const t = (r.module_name ?? '(untitled)').replace(PART_SUFFIX, '').trim();
    const m = modules.get(t) ?? { sections: 0, chars: 0, missing: 0 };
    m.sections++;
    m.chars += (r.content ?? '').length;
    if (!r.embedding) m.missing++;
    modules.set(t, m);
  }
  for (const [t, m] of modules) {
    console.log(`${String(m.sections).padStart(3)} section(s)  ${String(m.chars).padStart(7)} chars  ${t}${m.missing ? `  ⚠ ${m.missing} not embedded` : ''}`);
  }
  console.log(`\n${modules.size} module(s), ${rows.length} row(s).`);
}

async function cmdRemove(args) {
  const title = args.join(' ').trim();
  if (!title) throw new Error('usage: remove "<module title>"');
  const env = loadEnv();
  const rows = rowsForTitle(await fetchAllRows(env, 'id,module_name'), title);
  if (!rows.length) throw new Error(`no module titled "${title}" — run "list" to see exact titles`);
  for (let i = 0; i < rows.length; i += 100) {
    await rest(env, 'DELETE', `?id=in.(${rows.slice(i, i + 100).map((r) => r.id).join(',')})`);
  }
  console.log(`✓ removed "${title}" (${rows.length} row(s))`);
}

/**
 * Join stored sections back into one text, dropping the overlap paragraph
 * chunkText repeats at the start of each section, so rechunking twice
 * doesn't duplicate text.
 */
function mergeParts(contents) {
  const lines = [];
  for (const c of contents) {
    const ls = c.split('\n');
    if (lines.length && ls[0] === lines[lines.length - 1]) ls.shift();
    lines.push(...ls);
  }
  return lines.join('\n');
}

/** Merge each module's stored parts back together and re-split them into smaller sections. */
async function cmdRechunk(args) {
  const env = loadEnv();
  const rows = await fetchAllRows(env);
  const byTitle = new Map();
  for (const r of rows) {
    const t = (r.module_name ?? '').replace(PART_SUFFIX, '').trim();
    if (!t) continue;
    const part = Number((r.module_name.match(/\(part (\d+) of \d+\)\s*$/i) ?? [])[1] ?? 1);
    const list = byTitle.get(t) ?? [];
    list.push({ part, content: r.content ?? '' });
    byTitle.set(t, list);
  }
  const plans = [...byTitle].map(([title, parts]) => ({
    title,
    chunks: chunkText(mergeParts(parts.sort((a, b) => a.part - b.part).map((p) => p.content))),
  }));
  printPlan(plans);
  if (!args.includes('--yes')) {
    console.log('\nNothing written. Re-run with --yes to replace the stored sections with these.');
    return;
  }
  for (const p of plans.filter((x) => x.chunks.length)) {
    const r = await replaceModule(env, p.title, p.chunks, rows);
    console.log(`✓ ${p.title}: ${r.removed} → ${r.inserted} section(s)`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const commands = { plan: cmdPlan, add: cmdAdd, list: cmdList, remove: cmdRemove, rechunk: cmdRechunk };
  if (!commands[cmd]) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(cmd ? 1 : 0);
  }
  await commands[cmd](args);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, chunkText, mergeParts, docxToText, sectionNames, titleFromFile, rowsForTitle };
