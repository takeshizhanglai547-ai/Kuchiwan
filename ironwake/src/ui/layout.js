// src/ui/layout.js — pure HUD layout helpers (no DOM, no three.js; owner: mission/HUD designer).
// Unit-tested in tests/mission.test.mjs.

/** Overlap area of two axis-aligned rects (x0, y0, x1, y1). */
export function overlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const h = Math.min(ay1, by1) - Math.max(ay0, by0);
  return w > 0 && h > 0 ? w * h : 0;
}

export const READOUT_SIDES = ['right', 'left', 'above', 'below'];

/**
 * Place the locked-target readout so it never covers another marker, the reticle or a fixed
 * HUD block. Candidates, in order of preference: right of the lock brackets, left, above, below
 * (below last: it would sit on the player's own rig).
 * Each candidate is clamped into the safe area `view`; the first one with zero overlap wins
 * (the previous choice is kept while it stays clear, so the box does not flip-flop); if all
 * collide, the least-overlapping one is used.
 *
 * @param {number} tx, ty       target centre (px)
 * @param {number} w, h         readout size (px)
 * @param {number} gap          min distance from the target centre to the readout (px)
 * @param {number} keep         half size of the target's own bracket box (px)
 * @param {Float32Array} rects  obstacle rects [x0, y0, x1, y1] * n (px)
 * @param {number} n            obstacle count
 * @param {{x0,y0,x1,y1}} view  safe area (px)
 * @param {number} prev         previous candidate index (-1 = none)
 * @param {{x,y,side,score}} out  written: top-left corner, chosen index, its overlap
 */
export function placeReadout(tx, ty, w, h, gap, keep, rects, n, view, prev, out) {
  let best = -1, bestScore = Infinity, bx = 0, by = 0;
  for (let c = 0; c < 4; c++) {
    let x, y;
    if (c === 0) { x = tx + gap; y = ty - keep; }
    else if (c === 1) { x = tx - gap - w; y = ty - keep; }
    else if (c === 2) { x = tx - keep; y = ty - gap - h; }
    else { x = tx - keep; y = ty + gap; }
    x = Math.min(view.x1 - w, Math.max(view.x0, x));
    y = Math.min(view.y1 - h, Math.max(view.y0, y));
    // the target's own brackets are an obstacle too (a clamped candidate may slide over them)
    let s = overlap(x, y, x + w, y + h, tx - keep, ty - keep, tx + keep, ty + keep);
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      s += overlap(x, y, x + w, y + h, rects[k], rects[k + 1], rects[k + 2], rects[k + 3]);
    }
    // the previous side wins while it stays clear; otherwise the earliest clear (or least bad)
    if (c === prev && s === 0) { best = c; bestScore = 0; bx = x; by = y; break; }
    if (s < bestScore) { best = c; bestScore = s; bx = x; by = y; }
  }
  out.x = bx; out.y = by; out.side = best; out.score = bestScore;
  return out;
}
