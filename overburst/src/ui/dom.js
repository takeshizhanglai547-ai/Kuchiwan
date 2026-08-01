// ============================================================
//  ui/dom.js — micro DOM + formatting helpers for the HUD.
//  Every setter memoises the last written value on the node so the
//  per-frame update loop only touches the DOM when something changed.
//  Zero allocation in the hot path (no template literals, no arrays).
// ============================================================

const TPL = document.createElement('template');

/** Build a detached element from an HTML string. */
export function h(html) {
  TPL.innerHTML = html.trim();
  return TPL.content.firstElementChild;
}

export function q(root, sel) { return root ? root.querySelector(sel) : null; }

export function setText(n, v) {
  if (!n) return;
  if (n.__t !== v) { n.__t = v; n.textContent = v; }
}

/** Horizontal fill 0..1 driven by transform (no layout, GPU friendly). */
export function setSX(n, f) {
  if (!n) return;
  const v = f < 0 ? 0 : f > 1 ? 1 : f;
  const s = v.toFixed(4);
  if (n.__sx !== s) { n.__sx = s; n.style.transform = 'scaleX(' + s + ')'; }
}

export function setSY(n, f) {
  if (!n) return;
  const v = f < 0 ? 0 : f > 1 ? 1 : f;
  const s = v.toFixed(4);
  if (n.__sy !== s) { n.__sy = s; n.style.transform = 'scaleY(' + s + ')'; }
}

export function setOp(n, o) {
  if (!n) return;
  const s = (o < 0 ? 0 : o > 1 ? 1 : o).toFixed(3);
  if (n.__o !== s) { n.__o = s; n.style.opacity = s; }
}

export function setTF(n, t) {
  if (!n) return;
  if (n.__tf !== t) { n.__tf = t; n.style.transform = t; }
}

export function tog(n, cls, on) {
  if (!n) return;
  const k = '__c_' + cls;
  const b = !!on;
  if (n[k] !== b) { n[k] = b; n.classList.toggle(cls, b); }
}

export function show(n, on) { tog(n, 'hidden', !on); }

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---------------------------------------------------------------
//  Numeric formatting — monospace / tabular friendly.
// ---------------------------------------------------------------
const P = ['', '0', '00', '000', '0000', '00000'];
export function pad(v, w) {
  const s = String(v);
  return s.length >= w ? s : P[w - s.length] + s;
}

/** 48210 -> "48,210" */
export function group(v) {
  let n = Math.round(v);
  if (!isFinite(n)) n = 0;
  const neg = n < 0; if (neg) n = -n;
  let s = String(n);
  if (s.length > 3) {
    let out = '';
    let c = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = ',' + out;
    }
    s = out;
  }
  return neg ? '-' + s : s;
}

/** seconds -> "MM:SS" */
export function mmss(sec) {
  let s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  s -= m * 60;
  return pad(m, 2) + ':' + pad(s, 2);
}

/** seconds -> "MM:SS.d" */
export function mmssd(sec) {
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  const d = Math.floor((t - m * 60 - s) * 10);
  return pad(m, 2) + ':' + pad(s, 2) + '.' + d;
}
