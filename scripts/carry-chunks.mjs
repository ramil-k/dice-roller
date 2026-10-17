// Keep the previous deploys' library chunks on Pages for a while.
//
// Pages serves battle-toolbar.js with `max-age=600`, and its lazy chunks
// (battle-mat-overlay-<hash>.js etc.) change name on every build. A deploy
// replaces the whole site, so a browser still holding the old
// battle-toolbar.js asks for chunk names that now 404 and the battle screen
// silently fails to open. This script runs in the deploy workflow after the
// library is copied into the Pages folder: it reads the live site's
// chunks.json, downloads every listed .js the new build no longer has and
// puts it back next to the new files, so old pages keep loading their own
// (old) code until the cache expires or the tab is reloaded.
//
// chunks.json maps file name -> null (in the current build) or the ISO time
// it first went missing from a build. Retired files are carried for KEEP_DAYS
// (a tab can stay open for days), then dropped. Network trouble never fails
// the deploy: the worst case is the 404 window this script exists to close.
//
// Usage: node scripts/carry-chunks.mjs <pages-dir>
//   PAGES_URL overrides the live site (default https://ramil-k.github.io/dice-roller/)

import fs from 'node:fs';
import path from 'node:path';

const KEEP_DAYS = 30;
const SITE = (process.env.PAGES_URL ?? 'https://ramil-k.github.io/dice-roller/').replace(/\/?$/, '/');
const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/carry-chunks.mjs <pages-dir>');
  process.exit(1);
}

const current = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const manifest = Object.fromEntries(current.map((f) => [f, null]));

let previous = {};
try {
  const res = await fetch(`${SITE}chunks.json`);
  if (res.ok) previous = await res.json();
  else console.log(`carry-chunks: no chunks.json on ${SITE} (${res.status}) - nothing to carry`);
} catch (e) {
  console.log(`carry-chunks: could not read ${SITE}chunks.json (${e.message}) - nothing to carry`);
}

const now = Date.now();
let carried = 0;
for (const [file, retired] of Object.entries(previous)) {
  if (file in manifest || !/^[\w.-]+\.js$/.test(file)) continue;
  const since = retired ?? new Date(now).toISOString();
  if (now - Date.parse(since) > KEEP_DAYS * 864e5) continue;
  try {
    const res = await fetch(SITE + file);
    if (!res.ok) {
      console.log(`carry-chunks: ${file} ${res.status} - dropped`);
      continue;
    }
    fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
    manifest[file] = since;
    carried++;
  } catch (e) {
    console.log(`carry-chunks: ${file} failed (${e.message}) - dropped`);
  }
}

fs.writeFileSync(path.join(dir, 'chunks.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`carry-chunks: ${current.length} current, ${carried} carried over`);
