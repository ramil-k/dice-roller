// Scrape the Chikin Icons index (https://sergeychikin.ru/365/) into a JSON
// catalog of every icon: { category, path, ru, en, name }. Feeds the battle-mat
// token registry — run it, then hand-pick paths for a CATEGORIES entry (or use
// --category to print a ready-to-paste registry block).
//
// The index page lists each icon as:
//   <div class="container-16">
//     <a download href="070-animals/wolf.svg">
//     <img ... src="070-animals/wolf.svg">
//     <div>волк, wolf</div></a>
//   </div>
// The folder in the path is the category; the caption is "русское, english"
// (sometimes Russian only). We derive an ASCII `name` from the English caption
// (Title Case), falling back to the filename when there is no English.
//
// Usage:
//   node scripts/chikin-catalog.mjs                 # write catalog to stdout (JSON)
//   node scripts/chikin-catalog.mjs --out cat.json  # write to a file
//   node scripts/chikin-catalog.mjs --list          # list category ids + counts
//   node scripts/chikin-catalog.mjs --category 170-weapon        # dump that folder's icons (JSON)
//   node scripts/chikin-catalog.mjs --category 170-weapon --registry Weapons
//                                                   # print a CATEGORIES-shaped block
//   node scripts/chikin-catalog.mjs --grep кинжал   # find icons whose caption/path matches

import { writeFile } from 'node:fs/promises';

const INDEX_URL = 'https://sergeychikin.ru/365/';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// Turn an English caption ("flying squirrel") or a filename ("polar-bear") into
// a Title-Case ASCII name ("Flying Squirrel", "Polar Bear"). Registry names must
// be printable ASCII, so we strip anything else.
function toName(en, path) {
  let base = (en || '').trim();
  if (!base) {
    base = path.split('/').pop().replace(/\.svg$/, '').replace(/[-_]+/g, ' ');
  }
  const ascii = base.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  if (!ascii) return null; // no usable ASCII name (Russian-only caption, non-latin file)
  // Title Case, but don't capitalize the letter after an apostrophe
  // ("Newton's", not "Newton'S").
  return ascii.replace(/[A-Za-z]+('[A-Za-z]+)?/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// Split "русское, english" — the LAST comma-separated segment that is mostly
// ASCII is the English name (some captions list several Russian synonyms first).
function splitCaption(caption) {
  const parts = caption.split(',').map((s) => s.trim()).filter(Boolean);
  let en = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const asciiRatio = (parts[i].replace(/[^\x20-\x7e]/g, '').length) / Math.max(1, parts[i].length);
    if (asciiRatio > 0.6) {
      en = parts[i];
      break;
    }
  }
  const ru = parts.filter((p) => p !== en).join(', ');
  return { ru, en };
}

function parseCatalog(html) {
  const icons = [];
  // one <a download href="cat/file.svg"> ... <div>caption</div></a> per icon
  const re = /<a\s+download\s+href="([0-9]{3}-[^"/]+\/[^"]+\.svg)"[\s\S]*?<div>([^<]*)<\/div><\/a>/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const caption = m[2].trim();
    const category = path.split('/')[0];
    const { ru, en } = splitCaption(caption);
    const name = toName(en, path);
    icons.push({ category, path, ru, en, name });
  }
  return icons;
}

function registryBlock(icons, id, label) {
  const usable = icons.filter((i) => i.name);
  // dedupe by name within the category (registry requires unique paths; names
  // clashing would confuse the pool UI)
  const byName = new Map();
  for (const i of usable) if (!byName.has(i.name)) byName.set(i.name, i);
  const lines = [...byName.values()].map((i) => `      { name: '${i.name.replace(/'/g, "\\'")}', path: '${i.path}' },`);
  return `  {\n    id: '${id}',\n    label: '${label}',\n    icons: [\n${lines.join('\n')}\n    ],\n  },`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`fetch ${INDEX_URL} -> ${res.status}`);
  const html = await res.text();
  const catalog = parseCatalog(html);

  if (args.list) {
    const counts = new Map();
    for (const i of catalog) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    for (const [cat, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(String(n).padStart(4), cat);
    }
    return;
  }

  if (args.grep) {
    const q = String(args.grep).toLowerCase();
    const hits = catalog.filter(
      (i) => i.ru.toLowerCase().includes(q) || i.en.toLowerCase().includes(q) || i.path.toLowerCase().includes(q),
    );
    console.log(JSON.stringify(hits, null, 2));
    return;
  }

  if (args.category) {
    const icons = catalog.filter((i) => i.category === args.category);
    if (!icons.length) {
      console.error(`no icons in category "${args.category}" (try --list)`);
      process.exit(1);
    }
    if (args.registry) {
      const id = String(args.registry).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      console.log(registryBlock(icons, id, String(args.registry)));
    } else {
      console.log(JSON.stringify(icons, null, 2));
    }
    return;
  }

  const json = JSON.stringify(catalog, null, 2);
  if (args.out) {
    await writeFile(args.out, json);
    console.error(`wrote ${catalog.length} icons to ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
