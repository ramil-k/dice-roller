// Built-in token icon registry: a hand-curated slice of Chikin Icons
// (https://sergeychikin.ru/365/). The icons are free to use, but commercial
// use requires a license from sergeychikin.ru — see the README. Icons are
// hot-linked from that domain at runtime (rendered via <img>, which needs no
// CORS); exports persist the URL and never inline the SVG.
//
// There is no machine-readable index on the site, so entries are curated by
// hand from the published set. Paths were verified against the live page.
// Add new categories by appending to CATEGORIES; the pool UI renders them
// in order after the page-provided roster tabs.
//
// DOM-free; covered by test/battle-mat-registry.test.js.

const BASE = 'https://sergeychikin.ru/365';

export const CATEGORIES = [
  {
    id: 'humanoids',
    label: 'Humanoids',
    icons: [
      { name: 'Man', path: '090-human/man.svg' },
      { name: 'Woman', path: '090-human/woman.svg' },
      { name: 'Knight', path: '090-human/knight.svg' },
      { name: 'Samurai', path: '090-human/samurai.svg' },
      { name: 'Ninja', path: '090-human/ninja.svg' },
      { name: 'Pirate', path: '090-human/pirate.svg' },
      { name: 'Viking', path: '090-human/norseman.svg' },
      { name: 'Hoplite', path: '090-human/hoplite.svg' },
      { name: 'Musketeer', path: '090-human/musketeer.svg' },
      { name: 'Cowboy', path: '090-human/cowboy.svg' },
      { name: 'Magician', path: '090-human/magician.svg' },
      { name: 'Peasant', path: '090-human/peasant.svg' },
      { name: 'Monk', path: '100-sport&person/monk.svg' },
      { name: 'Archer', path: '100-sport&person/archer.svg' },
      { name: 'Witch', path: '100-sport&person/witch.svg' },
      { name: 'Wizard', path: '100-sport&person/gandalf.svg' },
    ],
  },
  {
    id: 'animals',
    label: 'Animals',
    icons: [
      { name: 'Wolf', path: '070-animals/wolf.svg' },
      { name: 'Bear', path: '070-animals/bear.svg' },
      { name: 'Horse', path: '070-animals/horse.svg' },
      { name: 'Dog', path: '070-animals/dog.svg' },
      { name: 'Cat', path: '070-animals/cat.svg' },
      { name: 'Fox', path: '070-animals/fox.svg' },
      { name: 'Lion', path: '070-animals/lion.svg' },
      { name: 'Boar', path: '070-animals/hog.svg' },
      { name: 'Deer', path: '070-animals/deer.svg' },
      { name: 'Rat', path: '070-animals/rat.svg' },
      { name: 'Bat', path: '070-animals/bat.svg' },
      { name: 'Eagle', path: '060-birds/eagle.svg' },
      { name: 'Owl', path: '060-birds/owl.svg' },
      { name: 'Raven', path: '060-birds/raven.svg' },
      { name: 'Snake', path: '050-insects&reptiles/snake.svg' },
      { name: 'Spider', path: '050-insects&reptiles/spider.svg' },
    ],
  },
  {
    id: 'monsters',
    label: 'Monsters',
    icons: [
      { name: 'Dragon', path: '080-other-animals/dragon.svg' },
      { name: 'Ghost', path: '080-other-animals/ghost.svg' },
      { name: 'Zombie', path: '120-faces/zombie.svg' },
      { name: 'Demon', path: '120-faces/demon.svg' },
      { name: 'Vampire', path: '100-sport&person/vampire.svg' },
      { name: 'Grim Reaper', path: '100-sport&person/grim-reaper.svg' },
      { name: 'Cthulhu', path: '080-other-animals/cthulhu.svg' },
      { name: 'Alien', path: '080-other-animals/alien.svg' },
      { name: 'Griffin', path: '080-other-animals/griffin.svg' },
      { name: 'Manticore', path: '080-other-animals/manticore.svg' },
      { name: 'Gargoyle', path: '080-other-animals/gargoyle.svg' },
      { name: 'Centaur', path: '080-other-animals/centaur.svg' },
      { name: 'Mermaid', path: '080-other-animals/mermaid.svg' },
      { name: 'Unicorn', path: '080-other-animals/unicorn.svg' },
      { name: 'Hydra', path: '050-insects&reptiles/hydra.svg' },
      { name: 'Godzilla', path: '050-insects&reptiles/godzilla.svg' },
    ],
  },
];

// Registry entries carry a site-relative `path`; roster entries passed by the
// page may instead carry a full `url`, which wins when present.
export function iconUrl(icon) {
  return icon.url ?? `${BASE}/${icon.path}`;
}
