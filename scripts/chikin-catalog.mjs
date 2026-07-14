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
//   node scripts/chikin-catalog.mjs --auto          # auto-group into D&D themes (JSON)
//   node scripts/chikin-catalog.mjs --auto --counts # theme -> match count summary
//   node scripts/chikin-catalog.mjs --auto-registry # paste-ready CATEGORIES for the themes

import { writeFile } from 'node:fs/promises';

const INDEX_URL = 'https://sergeychikin.ru/365/';

// Keyword-based auto-categorization into game-relevant token themes. Terms
// match as substrings against the lower-cased "ru + en + path" of each icon,
// so Russian roots ("меч") catch declensions ("мечи", "меча"); English terms
// catch the EN caption and filename. Themes are checked in order and an icon
// lands in the FIRST theme it matches (so put specific themes before broad
// ones). Only these game-facing themes are emitted; everything else falls into
// "Uncategorized". Edit the term lists to tune the split — it's just data.
const THEMES = [
  {
    id: 'undead',
    label: 'Undead',
    kw: ['зомби', 'скелет', 'череп', 'нежить', 'вампир', 'упыр', 'привидение', 'призрак', 'полтергейст',
      'мертв', 'труп', 'гроб', 'могил', 'надгроб', 'кладбищ', 'жнец', 'смерт',
      'undead', 'zombie', 'skeleton', 'skull', 'vampire', 'ghost', 'poltergeist', 'wraith', 'lich',
      'reaper', 'coffin', 'grave', 'tomb', 'rip'],
  },
  {
    id: 'monsters',
    label: 'Monsters',
    kw: ['дракон', 'демон', 'дьявол', 'чудовищ', 'монстр', 'ктулху', 'чужой', 'ксеноморф', 'гаргул',
      'единорог', 'пегас', 'грифон', 'мантикора', 'кентавр', 'русалк', 'джинн', 'сатир', 'горгон',
      'гидра', 'годзилла', 'йети', 'снежный человек', 'оборот', 'вервольф', 'фенрир', 'перитон', 'химер',
      'dragon', 'demon', 'devil', 'monster', 'cthulhu', 'alien', 'xenomorph', 'gargoyle', 'unicorn',
      'pegasus', 'gryphon', 'griffin', 'manticore', 'centaur', 'mermaid', 'genie', 'satyr', 'gorgon',
      'hydra', 'godzilla', 'yeti', 'werewolf', 'fenrir', 'peryton', 'chimera', 'goblin', 'ogre', 'troll'],
  },
  {
    id: 'weapons',
    label: 'Weapons',
    kw: ['меч', 'сабл', 'клинок', 'кинжал', 'секир', 'топор', 'булав', 'палиц', 'моргенштерн',
      'копь', 'посох', 'алебард', 'бердыш', 'трезубец', 'кистен', 'нунчак', 'сюрикен',
      'лук', 'арбалет', 'катана', 'вакидзаси', 'томагавк', 'бумеранг', 'боевой нож', 'боевой топор',
      'sword', 'sabre', 'saber', 'dagger', 'axe', 'mace', 'morning star', 'spear',
      'halberd', 'bardiche', 'trident', 'crossbow', 'shuriken',
      'nunchuck', 'katana', 'wakizashi', 'tomahawk', 'boomerang', 'excalibur', 'glaive', 'naginata',
      'battleaxe', 'cleaver'],
  },
  {
    id: 'armor',
    label: 'Armor',
    kw: ['щит', 'доспех', 'броня', 'шлем', 'кольчуг', 'латы', 'наруч', 'поножи', 'кираса',
      'shield', 'armor', 'armour', 'helmet', 'helm', 'chainmail', 'gauntlet', 'breastplate', 'greaves'],
  },
  {
    id: 'treasure',
    label: 'Treasure',
    kw: ['сундук', 'клад', 'сокровищ', 'монет', 'золот', 'самоцвет', 'алмаз', 'бриллиант', 'кристалл',
      'драгоцен', 'корон', 'кольц', 'мешок денег', 'слиток', 'сейф',
      'chest', 'treasure', 'coin', 'gold', 'gem', 'diamond', 'crystal', 'jewel', 'crown', 'ring',
      'money bag', 'ingot', 'safe', 'loot'],
  },
  {
    id: 'magic',
    label: 'Magic',
    kw: ['зель', 'элексир', 'эликсир', 'колб', 'склянк', 'яд', 'свиток', 'манускрипт', 'пергамент',
      'руна', 'амулет', 'талисман', 'жезл', 'посох мага', 'заклин', 'магическ', 'волшебн', 'алтар',
      'идол', 'тотем', 'пентаграмм', 'портал', 'кристалл', 'книга закл', 'гримуар',
      'potion', 'elixir', 'flask', 'poison', 'scroll', 'manuscript', 'parchment', 'rune', 'amulet',
      'talisman', 'wand', 'spell', 'magic', 'altar', 'idol', 'totem', 'pentagram', 'portal', 'grimoire'],
  },
  {
    id: 'dungeon',
    label: 'Dungeon',
    kw: ['ключ', 'замок', 'засов', 'дверь', 'ворота', 'решётк', 'решетк', 'факел', 'фонар',
      'бочк', 'колодец', 'лестниц', 'цеп', 'капкан', 'ловушк', 'шип', 'рычаг', 'котёл', 'котел',
      'key', 'padlock', 'lock', 'door', 'gate', 'grate', 'torch', 'lantern', 'barrel', 'well',
      'ladder', 'chain', 'trap', 'spike', 'lever', 'cauldron'],
  },
  {
    id: 'animals',
    label: 'Animals',
    kw: ['волк', 'медвед', 'лис', 'олен', 'кабан', 'конь', 'лошад', 'собак', 'пёс', 'кот', 'кошк',
      'лев', 'тигр', 'крыс', 'мыш', 'летуч', 'орёл', 'орел', 'сова', 'ворон', 'змея', 'паук', 'заяц', 'кролик',
      'wolf', 'bear', 'fox', 'deer', 'boar', 'horse', 'dog', 'cat', 'lion', 'tiger', 'rat',
      'bat', 'eagle', 'owl', 'raven', 'crow', 'snake', 'spider', 'hare', 'rabbit'],
  },
  {
    id: 'humanoids',
    label: 'Humanoids',
    kw: ['рыцар', 'воин', 'солдат', 'самурай', 'ниндзя', 'пират', 'викинг', 'мушкетёр', 'мушкетер',
      'ковбой', 'маг', 'волшебник', 'ведьм', 'монах', 'лучник', 'король', 'королев', 'принцесс', 'жрец',
      'крестьян', 'разбойник', 'вор ', 'бард', 'варвар', 'паладин', 'друид',
      'knight', 'warrior', 'soldier', 'samurai', 'ninja', 'pirate', 'viking', 'musketeer', 'cowboy',
      'wizard', 'mage', 'witch', 'monk', 'archer', 'king', 'queen', 'princess', 'priest', 'peasant',
      'rogue', 'bard', 'barbarian', 'paladin', 'druid', 'ranger'],
  },
];

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

// Words that share a prefix/substring with a keyword but mean something else —
// they'd cause false positives under prefix matching, so a word equal to any of
// these never counts as a keyword hit ("мечеть" vs "меч", "лук" the onion vs the
// bow). Cheaper and clearer than perfect morphology.
const STOPWORDS = new Set([
  // weapons roots (меч/нож/лук/стрел/коса/копь…) that hit unrelated words
  'мечеть', 'мечта', 'мечтать', 'лукашенко', 'луковица', 'лук', 'получка', 'булочка',
  'ножницы', 'ножках', 'ножка', 'многоножка', 'сороконожка', 'сколопендра', 'косатка',
  'стрелка', 'стрелки', 'стрелец', 'стрелок', 'бант', 'бантик', 'бэнкси', 'боулинг',
  'вилка', 'булавка', 'открывашка', 'дубинка', 'тачка', 'тачанка',
  // arrows/nav & suit symbols that came in via "стрел"/"cross"/"club"/"crest"
  'влево', 'вправо', 'вверх', 'вниз', 'налево', 'направо', 'галочка', 'крестик', 'крести',
  // treasure roots (клад/кольц/gem/chest) on unrelated words
  'кладка', 'каштан', 'chestnut', 'gemini', 'близнецы', 'борромео', 'brickwork',
  // dungeon roots: ключ=key but also clef/wrench; замок=castle; бочка=drum
  'скрипичный', 'альтовый', 'басовый', 'clef', 'разводной', 'газовый', 'трубный', 'wrench',
  'замок', 'castle', 'терка', 'grater', 'клавиши', 'пианино',
  // magic roots (колб=flask but колбаса=sausage; карт)
  'колбаса', 'sausage', 'кредитная', 'card',
  // NOTE: multi-word captions ("скрипичный ключ" clef, "кофейная колба" coffee
  // flask, "эрекционное кольцо") still match on the generic root word (ключ,
  // колба, кольцо). Per-word stopwords can't suppress those without dropping
  // the real key/flask/ring icons — review and prune the generated block.
  // english mid-word hits
  'sparrow', 'scissors', 'centipede', 'bowie', 'bowknot', 'bowling', 'bowl', 'elbow',
  'rainbow', 'onion', 'face', 'pharmacy', 'mosque', 'cart', 'command', 'club', 'clubs',
  'crossroads', 'crossword', 'across',
]);

// Split a caption/path into lower-cased word tokens (letters and digits only).
function words(s) {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

// Does any word in `tokens` match keyword `k`? A word matches when it is not a
// stopword AND it equals `k`, or (for roots of length >= 3) starts with `k`
// followed by at most 3 more letters — enough for Russian case/number endings
// ("меч" -> "мечи", "меча") without reaching unrelated longer words.
function wordMatches(tokens, k) {
  for (const w of tokens) {
    if (STOPWORDS.has(w)) continue;
    if (w === k) return true;
    if (k.length >= 3 && w.startsWith(k) && w.length - k.length <= 3) return true;
  }
  return false;
}

// Assign each icon to the first theme any of whose keywords matches a word in
// its "ru en path" text. Returns a Map theme.id -> { label, icons } plus an
// "uncategorized" bucket. Word/prefix matching (not raw substring) avoids
// mid-word false positives like "мечеть" for "меч".
function autoGroup(catalog) {
  const groups = new Map(THEMES.map((t) => [t.id, { label: t.label, icons: [] }]));
  groups.set('uncategorized', { label: 'Uncategorized', icons: [] });
  for (const icon of catalog) {
    const text = `${icon.ru} ${icon.en} ${icon.path}`.toLowerCase();
    const tokens = words(text);
    // multi-word keywords ("morning star") match as a phrase substring; single
    // words go through the stopword-aware word/prefix matcher
    const theme = THEMES.find((t) =>
      t.kw.some((k) => (k.includes(' ') ? text.includes(k) : wordMatches(tokens, k))),
    );
    groups.get(theme ? theme.id : 'uncategorized').icons.push(icon);
  }
  return groups;
}

function registryBlock(icons, id, label) {
  const usable = icons.filter((i) => i.name);
  // dedupe by name within the category (registry requires unique paths; names
  // clashing would confuse the pool UI)
  const byName = new Map();
  for (const i of usable) if (!byName.has(i.name)) byName.set(i.name, i);
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const lines = [...byName.values()].map((i) => `      { name: '${esc(i.name)}', path: '${esc(i.path)}' },`);
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

  if (args.auto || args['auto-registry']) {
    const groups = autoGroup(catalog);
    if (args.counts) {
      for (const [id, g] of groups) console.log(String(g.icons.length).padStart(4), id);
      return;
    }
    if (args['auto-registry']) {
      // paste-ready CATEGORIES blocks for the game themes (skip uncategorized)
      const blocks = [];
      for (const [id, g] of groups) {
        if (id === 'uncategorized' || !g.icons.length) continue;
        blocks.push(registryBlock(g.icons, id, g.label));
      }
      console.log(blocks.join('\n'));
      return;
    }
    // --auto: JSON of theme -> icons
    const out = {};
    for (const [id, g] of groups) out[id] = { label: g.label, icons: g.icons };
    console.log(JSON.stringify(out, null, 2));
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
