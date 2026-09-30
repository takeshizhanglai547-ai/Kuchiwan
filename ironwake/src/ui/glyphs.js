// src/ui/glyphs.js — authored stencil letterforms for the IRONWAKE wordmark and the results
// rank letters (owner: mission/HUD designer). Generated from a 100-unit cap-height grid:
// 22-unit stems, 19-unit bars, 8-unit 45° chamfers, 5-unit stencil bridges (R bowl/leg, O
// halves, A apex, W notched apex, K/E/B/D stems). Each entry: [advance width, SVG path d].
export const GLYPHS = {
  I: [22, 'M8,0 22,0 22,92 14,100 0,100 0,8Z'],
  R: [62, 'M8,0 22,0 22,100 0,100 0,8ZM27,0 54,0 62,8 62,43 53,52 27,52 27,34 41,34 41,18 27,18ZM33,57 54,57 62,92 62,100 41,100Z'],
  O: [62, 'M10,0 28.5,0 28.5,18 22,18 22,82 28.5,82 28.5,100 10,100 0,90 0,10ZM33.5,0 52,0 62,10 62,90 52,100 33.5,100 33.5,82 40,82 40,18 33.5,18Z'],
  N: [64, 'M0,8 8,0 24,0 42,45 42,0 64,0 64,92 56,100 42,100 22,52.4 22,100 0,100Z'],
  W: [98, 'M0,0 21,0 28.6,53.9 38,24 46.5,24 46.5,63.6 35,100 14,100ZM77,0 98,0 84,100 63,100 51.5,63.6 51.5,24 60,24 69.5,53.9Z'],
  A: [66, 'M20,0 30.5,0 30.5,30 26.3,58 39.7,58 35.5,30 35.5,0 46,0 51.9,6 66,100 46,100 42.4,76 23.6,76 20,100 0,100 14.1,6Z'],
  K: [62, 'M8,0 22,0 22,100 0,100 0,8ZM40,0 62,0 47,50 62,100 40,100 27,58 27,42Z'],
  E: [52, 'M8,0 22,0 22,100 8,100 0,92 0,8ZM27,0 44,0 52,8 52,19 27,19ZM27,40.5 47,40.5 47,59.5 27,59.5ZM27,81 52,81 52,92 44,100 27,100Z'],
  S: [60, 'M14,0 60,0 60,28 38,28 38,19 22,19 22,40.5 46,40.5 60,54.5 60,86 46,100 0,100 0,72 22,72 22,81 38,81 38,59.5 14,59.5 0,45.5 0,14Z'],
  B: [60, 'M8,0 22,0 22,100 8,100 0,92 0,8ZM27,0 52,0 60,8 60,42 54,50 60,58 60,92 52,100 27,100 27,81 38,81 38,59.5 27,59.5 27,40.5 38,40.5 38,19 27,19Z'],
  C: [58, 'M10,0 58,0 58,13 52,19 22,19 22,81 52,81 58,87 58,100 10,100 0,90 0,10Z'],
  D: [62, 'M8,0 22,0 22,100 8,100 0,92 0,8ZM27,0 48,0 62,14 62,86 48,100 27,100 27,81 40,81 40,19 27,19Z'],
};

/**
 * Inline SVG for a word set in the stencil letters (viewBox height 100 = cap height; size it
 * with CSS height). Unknown characters are skipped. `track` = gap between letters in units.
 */
export function stencilSVG(text, { track = 10, cls = 'stencil', title = '' } = {}) {
  let x = 0, paths = '';
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch];
    if (!g) continue;
    paths += `<path transform="translate(${x} 0)" d="${g[1]}"/>`;
    x += g[0] + track;
  }
  const w = Math.max(1, x - track);
  return `<svg class="${cls}" viewBox="-2 -2 ${w + 4} 104" preserveAspectRatio="xMinYMid meet" role="img"${title ? ` aria-label="${title}"` : ''}>${paths}</svg>`;
}
