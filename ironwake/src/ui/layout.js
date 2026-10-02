// src/ui/layout.js — pure HUD / menu layout helpers (no DOM, no three.js; owner: mission/HUD
// designer). Unit-tested in tests/mission.test.mjs.

/** Overlap area of two axis-aligned rects (x0, y0, x1, y1). */
export function overlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const h = Math.min(ay1, by1) - Math.max(ay0, by0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Candidate slots of the locked-target readout, in order of preference. */
export const READOUT_SIDES = ['right', 'left', 'above-right', 'above-left', 'above', 'below'];
/** placeReadout() result side when every candidate collides: dock in the fixed top slot. */
export const READOUT_DOCK = -2;

/**
 * Place the locked-target readout so it never covers another marker, the reticle, the player's
 * own rig or a fixed HUD block. Candidates (READOUT_SIDES): right of the lock brackets, left,
 * diagonally above-right / above-left of the bracket corners (gap = 0.6 x bracket half size),
 * centred above, centred below. Each candidate is clamped into the safe area `view`; the first
 * one with zero overlap wins (the previous choice is kept while it stays clear, so the box does
 * not flip-flop). If every candidate collides the result is READOUT_DOCK: the caller shows the
 * readout in its fixed docked slot instead (never on top of anything).
 *
 * @param {number} tx, ty       target centre (px)
 * @param {number} w, h         readout size (px)
 * @param {number} gap          min distance from the target centre to a side readout (px)
 * @param {number} keep         half size of the target's own bracket box (px)
 * @param {Float32Array} rects  obstacle rects [x0, y0, x1, y1] * n (px)
 * @param {number} n            obstacle count
 * @param {{x0,y0,x1,y1}} view  safe area (px)
 * @param {number} prev         previous candidate index (-1 = none)
 * @param {{x,y,side,score}} out  written: top-left corner, chosen index (or READOUT_DOCK), overlap
 */
export function placeReadout(tx, ty, w, h, gap, keep, rects, n, view, prev, out) {
  let best = -1, bestScore = Infinity, bx = 0, by = 0;   // first clear candidate (or least bad)
  const g2 = keep * 0.6;
  for (let c = 0; c < READOUT_SIDES.length; c++) {
    let x, y;
    switch (c) {
      case 0: x = tx + gap; y = ty - keep; break;                         // right
      case 1: x = tx - gap - w; y = ty - keep; break;                     // left
      case 2: x = tx + keep + g2; y = ty - keep - g2 - h; break;          // above-right
      case 3: x = tx - keep - g2 - w; y = ty - keep - g2 - h; break;      // above-left
      case 4: x = tx - w * 0.5; y = ty - gap - h; break;                  // above
      default: x = tx - w * 0.5; y = ty + gap; break;                     // below
    }
    x = Math.min(view.x1 - w, Math.max(view.x0, x));
    y = Math.min(view.y1 - h, Math.max(view.y0, y));
    // the target's own brackets are an obstacle too (a clamped candidate may slide over them)
    let s = overlap(x, y, x + w, y + h, tx - keep, ty - keep, tx + keep, ty + keep);
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      s += overlap(x, y, x + w, y + h, rects[k], rects[k + 1], rects[k + 2], rects[k + 3]);
    }
    if (c === prev && s === 0) { best = c; bestScore = 0; bx = x; by = y; break; } // keep the old side
    if (s < bestScore) { best = c; bestScore = s; bx = x; by = y; }
    if (bestScore === 0 && (prev < 0 || c >= prev)) break; // nothing later can beat a clear one
  }
  if (bestScore > 0) best = READOUT_DOCK;
  out.x = bx; out.y = by; out.side = best; out.score = bestScore;
  return out;
}

// ------------------------------------------------------------------------------ briefing map
/** Tactical map geometry (tacmap.js renders +-half m around the arena centre; walls at +-wall). */
export const MAP_GEOM = { half: 262, wall: 250, scaleM: 100 };

/**
 * Briefing tactical-map layout in rem, relative to the map image's top-left corner (map = M x M).
 * Column letters sit in a gutter ABOVE the map frame and row numbers in a gutter LEFT of it, so
 * no label ever touches a frame line; the north arrow, the AO-limit label and the scale bar each
 * own a different corner inside the AO frame. Returned rects are [x0, y0, x1, y1] (rem).
 *   lines   frame edges + AO-limit edges as thin rects (the strokes)
 *   cols    10 column-letter boxes (A..J), centred on the grid columns
 *   rows    10 row-number boxes (1..10), right-aligned in the left gutter
 *   north / aoLabel / scale   corner furniture inside the AO frame
 */
export function briefMapLayout(M = 44, opts = {}) {
  const G = opts.gutter ?? 1.8;          // label gutter outside the frame
  const lab = opts.label ?? 1.1;         // label font size (box height ~ 1.15 x font)
  const hair = 0.1;
  const ao = ((MAP_GEOM.half - MAP_GEOM.wall) / (2 * MAP_GEOM.half)) * M;
  const lh = lab * 1.15;
  const line = (x0, y0, x1, y1) => [x0 - hair, y0 - hair, x1 + hair, y1 + hair];
  const lines = [
    line(0, 0, M, 0), line(0, M, M, M), line(0, 0, 0, M), line(M, 0, M, M),
    line(ao, ao, M - ao, ao), line(ao, M - ao, M - ao, M - ao), line(ao, ao, ao, M - ao), line(M - ao, ao, M - ao, M - ao),
  ];
  const cols = [], rows = [];
  for (let i = 0; i < 10; i++) {
    const cx = ((i + 0.5) / 10) * M, cy = ((i + 0.5) / 10) * M;
    cols.push([cx - lab * 0.45, -G + (G - lh) * 0.5, cx + lab * 0.45, -G + (G - lh) * 0.5 + lh]);
    rows.push([-G + 0.15, cy - lh * 0.5, -0.45, cy + lh * 0.5]);
  }
  // corner furniture boxes INCLUDE their backing plate (css: border-box, padding = plate)
  const inset = 0.9, plate = 0.4;
  const nS = 2.8;
  const north = [ao + inset, ao + inset, ao + inset + nS, ao + inset + nS];
  const aoW = opts.aoLabelW ?? 12.8;
  const aoLabel = [M - ao - inset - aoW, ao + inset, M - ao - inset, ao + inset + lh + 2 * 0.25];
  const sW = (MAP_GEOM.scaleM / (2 * MAP_GEOM.half)) * M, sH = lh + 0.2 + 0.55;
  const scale = [M - ao - inset - sW - 2 * plate, M - ao - inset - sH - 2 * plate, M - ao - inset, M - ao - inset];
  return { M, G, ao, lab, lines, cols, rows, north, aoLabel, scale, scaleW: sW, plate };
}
