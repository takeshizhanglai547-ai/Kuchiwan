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

/**
 * Directional damage arc — an angular mask for the screen-edge glow.
 * `deg` is the incoming bearing, clockwise from straight ahead (screen up),
 * matching the CSS conic origin exactly. The wedge peaks on the bearing and
 * is fully gone ±35 degrees off it, so several hits from different quarters
 * overlap as a smear of edge light instead of crossing crescents.
 */
const ARC_HALF = 35;
const ARC_STOPS =
  'rgba(0,0,0,0) 0deg,rgba(0,0,0,.05) 8deg,rgba(0,0,0,.24) 17deg,' +
  'rgba(0,0,0,.66) 27deg,#000 35deg,rgba(0,0,0,.66) 43deg,' +
  'rgba(0,0,0,.24) 53deg,rgba(0,0,0,.05) 62deg,rgba(0,0,0,0) 70deg,' +
  'rgba(0,0,0,0) 360deg)';

export function arcMask(deg) {
  return 'conic-gradient(from ' + (deg - ARC_HALF).toFixed(1) + 'deg at 50% 50%,' + ARC_STOPS;
}

// ===============================================================
//  Briefing art — vector only, scales to whatever box it is given.
// ===============================================================

/**
 * Deployment map. 200x200 viewBox = a 1000 m square centred on the basin:
 * 1 unit = 5 m, so the kill wall (500 m) lands on r=100 and everything else
 * is drawn to the same scale as CFG.ARENA.
 */
export const MAP_SVG =
  '<svg class="dmap" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" fill="none">' +
    /* graticule */
    '<g class="g-fine">' +
      '<path d="M100 6V194M6 100H194"/>' +
      '<circle cx="100" cy="100" r="29"/><circle cx="100" cy="100" r="58"/>' +
      '<path d="M40 40l6 6M160 40l-6 6M40 160l6-6M160 160l-6-6"/>' +
    '</g>' +
    /* kill wall / playable disc */
    '<circle class="g-wall" cx="100" cy="100" r="97"/>' +
    '<circle class="g-play" cx="100" cy="100" r="89"/>' +
    /* basin + crown terrace */
    '<path class="g-fill" d="M78 84 L96 72 L118 78 L128 96 L120 118 L98 126 L80 116 L74 100 Z"/>' +
    '<path class="g-hard" d="M78 84 L96 72 L118 78 L128 96 L120 118 L98 126 L80 116 L74 100 Z"/>' +
    '<path class="g-fine" d="M86 92 L104 86 L114 98 L106 112 L90 108 Z"/>' +
    /* structure blocks — container yard, gantry runs, cooling stacks */
    '<g class="g-fine">' +
      '<path d="M28 62h20v10H28zM52 58h10v14H52zM30 76h16v6H30z"/>' +
      '<path d="M150 74h18v22h-18zM154 100h10v8h-10z"/>' +
      '<path d="M44 128h26v8H44zM48 140h18v6H48z"/>' +
      '<path d="M132 136h24v6h-24zM140 146h16v6h-16z"/>' +
      '<path d="M62 46 L138 46M62 46 L62 54M138 46 L138 54"/>' +
    '</g>' +
    /* objectives */
    '<g class="g-obj">' +
      '<path d="M100 40l7 8-7 8-7-8z"/><path d="M55 118l7 8-7 8-7-8z"/><path d="M145 118l7 8-7 8-7-8z"/>' +
    '</g>' +
    '<g class="g-crown"><path d="M100 92l9 8-9 8-9-8z"/><circle cx="100" cy="100" r="14"/></g>' +
    /* insertion vector */
    '<g class="g-ins">' +
      '<path d="M22 172 L70 132"/>' +
      '<path class="g-head" d="M70 132 l-12 2 l5 -9 Z" fill="currentColor" stroke="none"/>' +
    '</g>' +
    /* labels */
    '<g class="t-lab">' +
      '<text x="100" y="30" text-anchor="middle">CROWN</text>' +
      '<text x="100" y="66" text-anchor="middle">P-01</text>' +
      '<text x="42" y="146" text-anchor="middle">P-02</text>' +
      '<text x="158" y="146" text-anchor="middle">P-03</text>' +
      '<text x="20" y="184">INSERTION 041</text>' +
      '<text x="100" y="14" text-anchor="middle" class="t-n">N</text>' +
      '<text x="180" y="196" text-anchor="end">0—500 M</text>' +
    '</g>' +
    '<path class="g-scale" d="M140 190h40M140 187v6M160 188v4M180 187v6"/>' +
  '</svg>';

/**
 * Frame elevation with slot callouts. Front view, so the frame's RIGHT
 * limbs sit on the viewer's left — the callouts are labelled accordingly.
 */
export const FRAME_SVG =
  '<svg class="fschem" viewBox="0 0 178 186" preserveAspectRatio="xMidYMid meet" fill="none">' +
    '<g class="s-hard">' +
      /* head */
      '<path d="M82 22h14v10H82z"/><path d="M84 26h10v3H84z"/>' +
      /* shoulders + back units */
      '<path d="M56 34h66v16H56z"/>' +
      '<path d="M38 30h20v22H38zM120 30h20v22h-20z"/>' +
      '<path d="M26 33h12v10H26zM140 33h12v10h-12z"/>' +
      /* core / waist */
      '<path d="M62 50h54v34H62z"/>' +
      '<path d="M74 84h30v12H74z"/>' +
      '<path d="M68 58h44v6H68zM68 70h44v8H68z"/>' +
      /* arms */
      '<path d="M40 52h18v30H40zM120 52h18v30h-18z"/>' +
      '<path d="M42 82h14v16H42zM122 82h14v16h-14z"/>' +
      '<path d="M30 86h12v9H30zM136 86h12v9h-12z"/>' +
      /* hips + legs */
      '<path d="M60 96h58v14H60z"/>' +
      '<path d="M62 110h22v28H62zM94 110h22v28H94z"/>' +
      '<path d="M64 138h18v26H64zM96 138h18v26H96z"/>' +
      '<path d="M58 164h28v10H58zM92 164h28v10H92z"/>' +
    '</g>' +
    '<g class="s-fine">' +
      '<path d="M66 114h14M66 122h14M98 114h14M98 122h14"/>' +
      '<path d="M68 144h10M100 144h10"/>' +
      '<path d="M86 50v34M62 96h56"/>' +
      '<path d="M44 56h10M124 56h10"/>' +
    '</g>' +
    /* callout leaders */
    '<g class="s-lead">' +
      '<path d="M26 26 L26 38 L26 38"/><path d="M8 26h18"/>' +
      '<path d="M152 26 L152 38"/><path d="M152 26h18"/>' +
      '<path d="M22 90 L30 90"/><path d="M8 90h14"/>' +
      '<path d="M148 90 L156 90"/><path d="M156 90h14"/>' +
      '<path d="M89 18 L89 22"/>' +
    '</g>' +
    '<g class="t-lab">' +
      '<text x="8" y="22">R-BACK</text>' +
      '<text x="170" y="22" text-anchor="end">L-BACK</text>' +
      '<text x="8" y="86">R-ARM</text>' +
      '<text x="170" y="86" text-anchor="end">L-ARM</text>' +
      '<text x="89" y="14" text-anchor="middle">OB-01</text>' +
      '<text x="89" y="182" text-anchor="middle">FRONT ELEVATION &#183; 10.4 M</text>' +
    '</g>' +
  '</svg>';

// --- threat silhouettes: solid, chunky, legible at 30 px ------------
function sil(body) {
  return '<svg class="tsil" viewBox="0 0 44 32" preserveAspectRatio="xMidYMid meet" fill="currentColor">' + body + '</svg>';
}

export const THREAT_SIL = {
  mt: sil('<path d="M19 2h6v4h-6z"/><path d="M13 6h18v11H13z"/>' +
    '<path d="M7 8h6v10H7zM31 8h6v10h-6z"/><path d="M2 10h5v5H2zM37 10h5v5h-5z"/>' +
    '<path d="M17 17h4v6l-5 9h-5l6-9z"/><path d="M23 17h4v6l5 9h-5l-4-8z"/>'),
  drone: sil('<path d="M17 11h10v8H17z"/><path d="M3 12h14v3H3zM27 12h14v3H27z"/>' +
    '<path d="M6 15h5v6H6zM33 15h5v6h-5z"/><path d="M20 19h4v6h-4z"/>' +
    '<path d="M18 6h8v3h-8z"/>'),
  heli: sil('<path d="M2 4h40v2H2z"/><path d="M21 6h2v4h-2z"/>' +
    '<path d="M12 10h17v9H12z"/><path d="M29 12h11v4H29z"/><path d="M37 7h3v9h-3z"/>' +
    '<path d="M11 19h5v4h-5zM25 19h5v4h-5z"/><path d="M8 23h26v2H8z"/>'),
  turret: sil('<path d="M8 21h26v8H8z"/><path d="M13 11h16v10H13z"/>' +
    '<path d="M29 13h14v4H29z"/><path d="M16 6h4v5h-4z"/>'),
  pylon: sil('<path d="M18 1h8v22h-8z"/><path d="M11 23h22v7H11z"/>' +
    '<path d="M8 8h10v3H8zM26 8h10v3H26z"/><path d="M9 15h9v3H9zM26 15h9v3h-9z"/>' +
    '<path d="M19 0h6v2h-6z"/>'),
  boss: sil('<path d="M18 1h8v5h-8z"/><path d="M13 6h18v13H13z"/>' +
    '<path d="M5 3h8v13H5zM31 3h8v13h-8z"/><path d="M0 5h5v8H0zM39 5h5v8h-5z"/>' +
    '<path d="M16 19h5v5l-5 8h-6l6-8z"/><path d="M23 19h5v5l6 8h-6l-5-8z"/>'),
};
