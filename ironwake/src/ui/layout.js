// src/ui/layout.js — pure HUD / menu layout helpers (no DOM, no three.js; owner: mission/HUD
// designer). Unit-tested in tests/mission.test.mjs.

/** Overlap area of two axis-aligned rects (x0, y0, x1, y1). */
export function overlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const h = Math.min(ay1, by1) - Math.max(ay0, by0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Candidate slots of the locked-target readout, in order of preference. */
export const READOUT_SIDES = ['right', 'left', 'above-right', 'above-left', 'below-right', 'below-left', 'above', 'below'];
/** placeReadout() result side when every candidate collides: dock in the fixed top slot. */
export const READOUT_DOCK = -2;
const NC = READOUT_SIDES.length;

/**
 * Unclamped top-left corner of readout candidate `c` around a target bracket of half size `k`
 * centred on (tx, ty). `d` = diagonal clearance, `e` = horizontal run of the leader, so every
 * slot sits clear of the bracket box and the leader is a short 45-degree dog-leg:
 *   right / left             beside the bracket, top edges aligned (leader: horizontal)
 *   above-* / below-*        off a bracket corner: diagonal d, then horizontal e
 *   above / below            centred over / under the bracket (leader: vertical d)
 */
export function readoutCandidate(c, tx, ty, w, h, k, d, e, out) {
  switch (c) {
    case 0: out.x = tx + k + d + e; out.y = ty - k; break;              // right
    case 1: out.x = tx - k - d - e - w; out.y = ty - k; break;          // left
    case 2: out.x = tx + k + d + e; out.y = ty - k - d - h; break;      // above-right
    case 3: out.x = tx - k - d - e - w; out.y = ty - k - d - h; break;  // above-left
    case 4: out.x = tx + k + d + e; out.y = ty + k + d; break;          // below-right
    case 5: out.x = tx - k - d - e - w; out.y = ty + k + d; break;      // below-left
    case 6: out.x = tx - w * 0.5; out.y = ty - k - d - h; break;        // above
    default: out.x = tx - w * 0.5; out.y = ty + k + d; break;           // below
  }
  return out;
}

/** Distance from point (px, py) to the rect (x0, y0, x1, y1); 0 inside. */
function rectDist(x0, y0, x1, y1, px, py) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.hypot(dx, dy);
}

const _c = { x: 0, y: 0 };
/**
 * Place the locked-target readout. Obstacles come in two classes:
 *   HARD rects[0 .. nHard)  the target's own bracket box (+ pad) and lock-order digit, every
 *                           other marker's box and digit, the reticle: a candidate touching one
 *                           is never chosen (the caller switches away from it at once)
 *   SOFT rects[nHard .. n)  the player's rig, fixed HUD blocks: never chosen either, but the
 *                           caller keeps a current slot that turned soft-blocked for a moment
 *                           (readoutHold) so the box does not hop
 * Clear candidates are scored by their distance to the nearest OTHER marker centre (`others`,
 * [x, y] * nOthers; capped at `far`), minus a small preference step per READOUT_SIDES index:
 * with two targets close together the readout goes to the side away from the neighbour. A
 * candidate that is nearer to another marker than to its own target is "ambiguous" and only
 * wins when nothing else is clear. Every candidate is clamped into the safe area `view`.
 * If no candidate is clear the result is READOUT_DOCK (the caller uses the fixed docked slot).
 *
 * Also written for the caller's hysteresis: `out.prevHard` / `out.prevSoft` = whether candidate
 * `prev` touches a hard / soft obstacle (or is ambiguous), `out.px` / `out.py` = its position.
 *
 * @param {object} g  geometry {k: bracket half size, d, e, far, step} (px)
 */
export function placeReadout(tx, ty, w, h, g, rects, n, nHard, others, nOthers, view, prev, out) {
  let best = READOUT_DOCK, bestScore = -Infinity, bx = 0, by = 0;
  out.prevHard = false; out.prevSoft = false; out.px = 0; out.py = 0;
  for (let c = 0; c < NC; c++) {
    readoutCandidate(c, tx, ty, w, h, g.k, g.d, g.e, _c);
    const x = Math.min(view.x1 - w, Math.max(view.x0, _c.x));
    const y = Math.min(view.y1 - h, Math.max(view.y0, _c.y));
    let hard = false, soft = false;
    for (let i = 0; i < n; i++) {
      const q = i * 4;
      if (overlap(x, y, x + w, y + h, rects[q], rects[q + 1], rects[q + 2], rects[q + 3]) > 0) {
        if (i < nHard) { hard = true; break; }
        soft = true;
      }
    }
    // nearest other marker vs own target (ambiguity), and the side-away score
    let dO = g.far;
    for (let i = 0; i < nOthers; i++) {
      const dd = rectDist(x, y, x + w, y + h, others[i * 2], others[i * 2 + 1]);
      if (dd < dO) dO = dd;
    }
    const amb = dO < rectDist(x, y, x + w, y + h, tx, ty) + g.step;
    if (c === prev) { out.prevHard = hard; out.prevSoft = soft || amb; out.px = x; out.py = y; }
    if (hard || soft) continue;
    const score = dO - c * g.step - (amb ? 1e4 : 0);
    if (score > bestScore) { best = c; bestScore = score; bx = x; by = y; }
  }
  out.x = bx; out.y = by; out.side = best; out.score = bestScore;
  return out;
}

/**
 * Slot hysteresis for the target readout (pure; `st` = {side, t}). The current slot is kept
 * while it is clear; when it touches a SOFT obstacle (or turns ambiguous) it is kept until that
 * has lasted `hold` s of sim time; a HARD collision (own bracket / digit, another marker, the
 * reticle) or a new target (st.side < 0) switches at once. Returns the side to show.
 */
export function readoutHold(st, res, dt, hold) {
  if (st.side < 0 && st.side !== READOUT_DOCK) { st.side = res.side; st.t = 0; return st.side; }
  if (st.side === READOUT_DOCK) {                       // docked: leave as soon as a slot is clear
    if (res.side !== READOUT_DOCK) { st.side = res.side; st.t = 0; }
    return st.side;
  }
  if (res.prevHard) { st.side = res.side; st.t = 0; return st.side; }
  if (res.prevSoft) {
    st.t += dt;
    if (st.t >= hold && res.side !== st.side) { st.side = res.side; st.t = 0; }
    return st.side;
  }
  st.t = 0;
  return st.side;
}

/**
 * Leader line from the readout to its bracket (px): from the bracket corner nearest the slot,
 * 45 degrees toward the readout's nearest corner, then straight (horizontal or vertical) into
 * it. Writes out.{x0,y0,x1,y1,x2,y2,len}; len = 0 when the side has no leader (dock).
 */
export function readoutLeader(side, tx, ty, k, x, y, w, h, out) {
  let bx = tx, by = ty, rx = x, ry = y;
  switch (side) {
    case 0: bx = tx + k; by = ty - k; rx = x; ry = y; break;
    case 1: bx = tx - k; by = ty - k; rx = x + w; ry = y; break;
    case 2: bx = tx + k; by = ty - k; rx = x; ry = y + h; break;
    case 3: bx = tx - k; by = ty - k; rx = x + w; ry = y + h; break;
    case 4: bx = tx + k; by = ty + k; rx = x; ry = y; break;
    case 5: bx = tx - k; by = ty + k; rx = x + w; ry = y; break;
    case 6: bx = tx; by = ty - k; rx = x + w * 0.5; ry = y + h; break;
    case 7: bx = tx; by = ty + k; rx = x + w * 0.5; ry = y; break;
    default: out.len = 0; return out;
  }
  const dx = rx - bx, dy = ry - by, ax = Math.abs(dx), ay = Math.abs(dy), m = Math.min(ax, ay);
  out.x0 = bx; out.y0 = by;
  out.x1 = bx + Math.sign(dx) * m; out.y1 = by + Math.sign(dy) * m;
  out.x2 = rx; out.y2 = ry;
  out.len = m * Math.SQRT2 + Math.max(ax, ay) - m;
  return out;
}

// ------------------------------------------------------------------------------ Japanese wrap
const JP_HIRA = /[\u3041-\u309F]/;
const JP_ALNUM = /[A-Za-z0-9]/;
const JP_CLOSE = /[、。・」』）！？：]/;          // break AFTER these
const JP_OPEN = /[「『（]/;                     // break BEFORE these
const JP_NOSTART = /[、。」』）！？ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ：・]/; // never start a line
/**
 * Phrase-level line-break opportunities for Japanese (a light budoux-style rule set): inserts a
 * zero-width space where a hiragana run (particle / okurigana) ends before kanji, katakana or
 * Latin, after closing punctuation and before opening brackets. CSS on JP blocks sets
 * `word-break: keep-all`, so lines only break at these points: katakana words (ミサイル,
 * ポーズ) and kanji compounds are never split.
 */
export function jpWrap(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i], n = str[i + 1];
    out += c;
    // designations such as PK-2 / RF-24 never break at the hyphen (U+2060 word joiner)
    if (c === '-' && n !== undefined && JP_ALNUM.test(n) && i > 0 && JP_ALNUM.test(str[i - 1])) { out += '\u2060'; continue; }
    if (n === undefined || n === '\u200B' || c === '\u200B' || JP_NOSTART.test(n)) continue;
    if ((JP_HIRA.test(c) && !JP_HIRA.test(n)) || JP_CLOSE.test(c) || (JP_OPEN.test(n) && !JP_OPEN.test(c))) out += '\u200B';
  }
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
