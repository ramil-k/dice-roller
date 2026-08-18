// Inline SVG glyphs for the battle-mat toolbar. All are 24x24 stroke icons
// drawn to match the dice components' hand-rolled icon style; the project
// bans emoji, so every pictogram is real SVG.

const wrap = (body) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${body}</svg>`;

export const ICONS = {
  select: wrap('<path d="M5 3l14 8-6.5 1.5L9 19z"/>'),
  pan: wrap(
    '<path d="M12 4v16M4 12h16"/><path d="M12 4l-2 2M12 4l2 2M12 20l-2-2M12 20l2-2M4 12l2-2M4 12l2 2M20 12l-2-2M20 12l-2 2"/>',
  ),
  pen: wrap('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>'),
  line: wrap('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.4"/><circle cx="19" cy="5" r="1.4"/>'),
  rect: wrap('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: wrap('<ellipse cx="12" cy="12" rx="8" ry="5.5"/>'),
  eraser: wrap('<path d="M8.5 18.5H19M3.5 15.5l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-5 5H9z"/>'),
  ruler: wrap('<rect x="2.5" y="13.5" width="19" height="7" rx="1" transform="rotate(-32 12 17)"/><path d="M8 14.8l1.2 2M11.5 12.6l1.2 2M15 10.4l1.2 2"/>'),
  image: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3.5 17.5l5-5 4 4 3.5-3.5 4.5 4.5"/>'),
  grid: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>'),
  download: wrap('<path d="M12 4v11M7.5 11l4.5 4.5L16.5 11M5 19.5h14"/>'),
  upload: wrap('<path d="M12 15V4M7.5 8L12 3.5 16.5 8M5 19.5h14"/>'),
  trash: wrap('<path d="M4.5 6.5h15M9.5 6V4.5h5V6M7 6.5l1 13h8l1-13M10.3 10v6M13.7 10v6"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  // Screen-toolbar controls, matching the <battle-toolbar> dock glyphs:
  // grid-map, token circles, Chikin's crossed swords, the roll-dice d20.
  map: wrap(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  ),
  pool: wrap('<circle cx="8" cy="8.5" r="3.6"/><circle cx="16.5" cy="10" r="2.9"/><circle cx="11" cy="16.8" r="3.2"/>'),
  // Sergey Chikin's 170-weapon/weapon glyph — the same icon the dock and the
  // standalone <initiative-tracker> use (fill-based, hence no wrap()).
  tracker: `<svg class="icon" viewBox="0 0 150 190" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M120.12,145c-6.1,6.36-15.55-.75-13.75-7.35l-10.89-9.13-14,7-2.94-4.74,6.32-6.48-9.25-9.17-8.46,8.49,3.27,5.81C62.19,137.62,51.88,132,51.88,132L41.41,141.2l1.48,3c-9.23,9.08-21-3-12-11.89l2.9,1.33L43,123.06s-5.13-11.38,2.31-18.7L51,107.68l8.92-8.09L35.27,75.19l-1.7-15,15.11.62L74.84,86.06,99.5,63.7l17-2.7L114,76.72l-23.91,24,9.22,8.89,5.31-5.44,4.88,3-6.67,12.69,10,11.91C119.65,130.34,125.77,139.11,120.12,145ZM107.63,76.18l3.21-9.49L101,69.47S60.59,108,56,112.19s2.34,11.87,7.53,6.91S107.63,76.18,107.63,76.18Z"/>
  </svg>`,
  dice: wrap(
    '<path d="M12 2.2 21.5 7.6v8.8L12 21.8 2.5 16.4V7.6z"/><path d="M6.7 9 12 15.5 17.3 9z"/><path d="M12 2.2 6.7 9 2.5 7.6M12 2.2 17.3 9l4.2-1.4M6.7 9 2.5 16.4 12 21.8l9.5-5.4L17.3 9M12 15.5V21.8"/>',
  ),
};
