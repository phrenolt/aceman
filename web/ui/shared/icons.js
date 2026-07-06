// Shared inline-SVG icons for JS-built controls (favourite / history rows).
//
// Monochrome, drawn with `currentColor` so they inherit the button's text
// colour and pick up the row's hover recolour for free — matching the
// library-tab icons. `setIcon(btn, name)` drops one into a button.

export const ICONS = {
  // Fat X — the shared clear/close glyph (thick stroke so it reads bold in
  // every browser, unlike the thin ✕ character).
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" ' +
    'stroke-linecap="round" aria-hidden="true">' +
    '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
  // Trash can — the shared delete/remove glyph (favourites + history).
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6h18"/>' +
    '<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
    '<line x1="10" y1="11" x2="10" y2="17"/>' +
    '<line x1="14" y1="11" x2="14" y2="17"/></svg>',
  // Star — add to favourites (same footprint as the trash glyph).
  star:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">' +
    '<path d="M12 2.5l2.9 6.1 6.6.6-5 4.4 1.5 6.5L12 17.9 6.5 20.6 8 14.1l-5-4.4 6.6-.6z"/></svg>',
  // Pencil — edit/rename.
  pencil:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"/>' +
    '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

export function setIcon(btn, name) {
  btn.innerHTML = ICONS[name] || '';
  return btn;
}
