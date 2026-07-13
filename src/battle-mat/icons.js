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
};
