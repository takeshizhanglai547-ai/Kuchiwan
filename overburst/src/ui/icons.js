// ============================================================
//  ui/icons.js — inline SVG glyphs for the HUD.
//  All monochrome line art on `currentColor`, 1.6px non-scaling
//  strokes.  No external assets, no emoji, no icon font.
// ============================================================

const OPEN = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="square" stroke-linejoin="miter" vector-effect="non-scaling-stroke">';

function ico(body) { return OPEN + body + '</svg>'; }

/** Burst rifle: receiver, barrel, magazine, stock. */
export const IC_RIFLE = ico(
  '<path d="M4 13h17v6H4z"/>' +
  '<path d="M21 15h8"/>' +
  '<path d="M25 14v3"/>' +
  '<path d="M9 19l-1.5 8h4.5l1-8"/>' +
  '<path d="M4 13L1.5 15v3L4 19"/>',
);

/** Pulse blade: swept edge + emitter housing. */
export const IC_BLADE = ico(
  '<path d="M6 27L21 5l5 3.5L10.5 29z"/>' +
  '<path d="M2 30l5-3"/>' +
  '<path d="M17 11l5 3.5"/>',
);

/** Vertical missile rack: 2 x 3 cell block. */
export const IC_MISSILE = ico(
  '<path d="M3 7h26v8H3z"/>' +
  '<path d="M3 17h26v8H3z"/>' +
  '<path d="M11.7 7v18M20.3 7v18"/>',
);

/** Plasma siege cannon: breech, heavy barrel, coil rings. */
export const IC_CANNON = ico(
  '<path d="M1.5 11h6v10h-6z"/>' +
  '<path d="M7.5 13h22v6h-22z"/>' +
  '<path d="M14 11v10M19.5 11v10M25 11v10"/>',
);

export const WEAPON_ICONS = {
  rifle: IC_RIFLE, blade: IC_BLADE, missile: IC_MISSILE, cannon: IC_CANNON,
};

// Reticle geometry, drawn twice: a dark backing stroke then the cyan
// hairline on top, so a 1px HUD line still reads over a bright frame.
const RET_PATHS =
  '<path d="M-7 -13 L-13 -6.5 L-13 6.5 L-7 13"/>' +
  '<path d="M7 -13 L13 -6.5 L13 6.5 L7 13"/>' +
  '<path d="M-21 0 h6 M21 0 h-6 M0 -21 v6 M0 21 v-6"/>';

/** Centre reticle — hex bracket, outward ticks, core dot. */
export const RETICLE_SVG =
  '<svg viewBox="-50 -50 100 100">' +
  '<g id="ret-spread">' +
    '<g class="bk">' + RET_PATHS + '</g>' +
    '<g class="fg">' + RET_PATHS + '</g>' +
  '</g>' +
  '<circle class="bkc" cx="0" cy="0" r="2.6"/>' +
  '<circle class="core" cx="0" cy="0" r="1.5"/>' +
  '<path class="cnr" d="M-34 -26 h-6 v6 M34 -26 h6 v6 M-34 26 h-6 v-6 M34 26 h6 v-6"/>' +
  '</svg>';

/** Hit marker — four diagonal ticks. */
export const HITMARK_SVG =
  '<svg viewBox="-50 -50 100 100">' +
  '<path d="M-16 -16 L-8 -8 M16 -16 L8 -8 M-16 16 L-8 8 M16 16 L8 8"/>' +
  '</svg>';

const BOX_PATHS =
  '<path d="M0 26 L0 0 L26 0"/><path d="M74 0 L100 0 L100 26"/>' +
  '<path d="M100 74 L100 100 L74 100"/><path d="M26 100 L0 100 L0 74"/>';

/** Target frame — corner ticks only, stretched to the box. */
export const LOCKBOX_SVG =
  '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
  '<g class="bk">' + BOX_PATHS + '</g><g class="fg">' + BOX_PATHS + '</g>' +
  '</svg>';

/** Directional damage arc — a 64 degree cap at the top of a 200-unit circle. */
export const ARC_SVG =
  '<svg viewBox="-100 -100 200 200">' +
  '<path class="g" d="M-46.9 -82.7 A 95 95 0 0 1 46.9 -82.7"/>' +
  '<path d="M-40.5 -85.9 A 95 95 0 0 1 40.5 -85.9"/>' +
  '</svg>';
