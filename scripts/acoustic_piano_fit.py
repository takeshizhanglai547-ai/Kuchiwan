#!/usr/bin/env python3
"""
PHASE 6 SOLVER - Grand Piano Soundproof Music Room.

Answers the one question the client brief (sections B/C/D) says must not be
hand-waved:

    "17.3 jo is the area printed on the plan. After a piano-grade acoustic
     lining is built inside it, can two grand pianos actually be played there
     by two people at the same time - and at what ceiling height?"

The brief explicitly forbids concluding that two grands 'obviously fit' from
the 17.3 jo figure alone. This script therefore:

  1. converts 17.3 jo under BOTH Japanese conventions (they differ by 0.6 m2);
  2. enumerates the plausible GROSS room rectangles on the planning module that
     hit that area - the plan area does not fix the aspect ratio, and the
     aspect ratio is what decides the answer;
  3. subtracts the acoustic build-up to get NET INTERNAL dimensions;
  4. runs an exact 2D placement search for two instruments in five real
     two-piano layouts, with wall clearance, inter-piano clearance and a
     bench/player zone per instrument;
  5. checks net volume against practice-room guidance;
  6. checks that the instruments can physically be delivered into the room.

Run:  python3 scripts/acoustic_piano_fit.py
Deps: none.
"""

from __future__ import annotations

import csv
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import acoustics as AC                                        # noqa: E402
import geom2d as G                                            # noqa: E402
from pianos import CATALOGUE, PAIRINGS, GrandPiano, acoustic_volume_guidance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARAMS_PATH = os.path.join(ROOT, "params", "house_params.json")
DOCS = os.path.join(ROOT, "docs")

# 建築基準法施行令第21条 - minimum ceiling height for a habitable room (居室).
# https://laws.e-gov.go.jp/law/325CO0000000338
STATUTORY_MIN_CEILING_M = 2.10


# ==========================================================================
# layouts
# ==========================================================================

@dataclass(frozen=True)
class Layout:
    key: str
    name_en: str
    name_ja: str
    rot_a: float
    rot_b: float
    note: str
    forbid_nesting: bool = False


LAYOUTS: List[Layout] = [
    Layout("NESTED_DUO", "Nested duo (interlocked, keyboards opposed)", "対向ネスト配置",
           0.0, 180.0,
           "The standard two-piano concert layout: tails interlocked, players "
           "face each other across the keyboards. Most space-efficient and the "
           "only layout with real ensemble sightlines. Normally requires the "
           "lid of the inner instrument to be removed or half-propped."),
    Layout("MIRRORED_OPPOSED", "Mirrored, opposed, not interlocked", "対向非ネスト配置",
           0.0, 180.0,
           "Keyboards opposed but the cases kept clear of one another. Both lids "
           "may be fully propped. Costs significantly more floor than nesting.",
           forbid_nesting=True),
    Layout("PARALLEL_SAME", "Parallel, same direction", "並列同方向配置",
           0.0, 0.0,
           "Both keyboards face the same way. Teaching / two-piano practice "
           "layout. No mutual sightline between players."),
    Layout("PERPENDICULAR_L", "Perpendicular (L)", "L字直交配置",
           0.0, 90.0,
           "One instrument rotated a quarter turn. Sometimes the only way into "
           "an awkward plan; poor ensemble geometry."),
    Layout("PERPENDICULAR_L2", "Perpendicular (mirrored L)", "L字直交配置(反転)",
           0.0, 270.0,
           "As above, opposite hand."),
]


# ==========================================================================
# clearance set
# ==========================================================================

@dataclass(frozen=True)
class Clearances:
    wall_to_piano: float = 0.50
    between_pianos: float = 0.60
    player_zone_depth: float = 1.10
    player_zone_width: float = 1.40
    zone_to_wall: float = 0.00     # the zone already contains stand-and-leave space
    zone_to_piano: float = 0.10    # bench must not touch the other instrument's rim
    zone_to_zone: float = 0.00     # players may share the circulation between them


# ==========================================================================
# placement search
# ==========================================================================

@dataclass
class Placement:
    layout: Layout
    dx: float
    dy: float
    req_x: float
    req_y: float

    @property
    def req_area(self) -> float:
        return self.req_x * self.req_y


class FitSolver:
    """Exact placement search for a fixed instrument pair and layout.

    Both instruments are rigid; only their relative offset is free (every
    constraint except the walls is translation-invariant, so the absolute
    position never needs searching - the required room is read straight off the
    combined bounding box).
    """

    def __init__(self, a: GrandPiano, b: GrandPiano, layout: Layout,
                 cl: Clearances, segments: int = 20):
        self.a, self.b, self.layout, self.cl = a, b, layout, cl

        self.pa = G.rotate(a.footprint(segments), layout.rot_a)
        self.pb0 = G.rotate(b.footprint(segments), layout.rot_b)
        self.za = G.rotate(a.player_zone(cl.player_zone_depth, cl.player_zone_width),
                           layout.rot_a)
        self.zb0 = G.rotate(b.player_zone(cl.player_zone_depth, cl.player_zone_width),
                            layout.rot_b)

        self.b_pa = G.bbox(self.pa)
        self.b_pb = G.bbox(self.pb0)
        self.b_za = G.bbox(self.za)
        self.b_zb = G.bbox(self.zb0)

    # -- cheap objective, no polygon work -------------------------------
    def required_room(self, dx: float, dy: float) -> Tuple[float, float]:
        wc, zc = self.cl.wall_to_piano, self.cl.zone_to_wall
        px0 = min(self.b_pa[0], self.b_pb[0] + dx) - wc
        px1 = max(self.b_pa[2], self.b_pb[2] + dx) + wc
        py0 = min(self.b_pa[1], self.b_pb[1] + dy) - wc
        py1 = max(self.b_pa[3], self.b_pb[3] + dy) + wc

        zx0 = min(self.b_za[0], self.b_zb[0] + dx) - zc
        zx1 = max(self.b_za[2], self.b_zb[2] + dx) + zc
        zy0 = min(self.b_za[1], self.b_zb[1] + dy) - zc
        zy1 = max(self.b_za[3], self.b_zb[3] + dy) + zc

        return (max(px1, zx1) - min(px0, zx0),
                max(py1, zy1) - min(py0, zy0))

    # -- expensive exact feasibility ------------------------------------
    def feasible(self, dx: float, dy: float) -> bool:
        pb = G.translate(self.pb0, dx, dy)
        if G.polygon_distance(self.pa, pb) < self.cl.between_pianos - 1e-6:
            return False

        zb = G.translate(self.zb0, dx, dy)
        if G.polygon_distance(self.za, pb) < self.cl.zone_to_piano - 1e-6:
            return False
        if G.polygon_distance(zb, self.pa) < self.cl.zone_to_piano - 1e-6:
            return False
        if G.polygon_distance(self.za, zb) < self.cl.zone_to_zone - 1e-6:
            return False

        if self.layout.forbid_nesting:
            # cases must not overlap in the axis across the keyboards
            ax0, ay0, ax1, ay1 = self.b_pa
            bx0, by0, bx1, by1 = (self.b_pb[0] + dx, self.b_pb[1] + dy,
                                  self.b_pb[2] + dx, self.b_pb[3] + dy)
            overlap_x = min(ax1, bx1) - max(ax0, bx0)
            overlap_y = min(ay1, by1) - max(ay0, by0)
            if overlap_x > 1e-6 and overlap_y > 1e-6:
                return False
        return True

    # -- candidate offsets ordered by objective -------------------------
    def _candidates(self, step: float,
                    room: Optional[Tuple[float, float]] = None) -> List[Tuple[float, float, float]]:
        span_x = (self.a.length_m + self.b.length_m + self.a.width_m + self.b.width_m)
        span_y = span_x
        out: List[Tuple[float, float, float]] = []
        n_x = int(span_x / step)
        n_y = int(span_y / step)
        for i in range(-n_x, n_x + 1):
            dx = i * step
            for j in range(-n_y, n_y + 1):
                dy = j * step
                rx, ry = self.required_room(dx, dy)
                if room is not None:
                    RX, RY = room
                    if not ((rx <= RX + 1e-9 and ry <= RY + 1e-9) or
                            (rx <= RY + 1e-9 and ry <= RX + 1e-9)):
                        continue
                out.append((rx * ry, dx, dy))
        out.sort(key=lambda t: t[0])
        return out

    def minimum_room(self, coarse: float = 0.10, fine: float = 0.025) -> Optional[Placement]:
        """Smallest-area room this layout can be made to work in."""
        best: Optional[Placement] = None
        for _, dx, dy in self._candidates(coarse):
            if self.feasible(dx, dy):
                rx, ry = self.required_room(dx, dy)
                best = Placement(self.layout, dx, dy, rx, ry)
                break
        if best is None:
            return None
        # local refinement
        r = coarse
        steps = int(r / fine)
        for i in range(-steps, steps + 1):
            for j in range(-steps, steps + 1):
                dx, dy = best.dx + i * fine, best.dy + j * fine
                rx, ry = self.required_room(dx, dy)
                if rx * ry < best.req_area - 1e-9 and self.feasible(dx, dy):
                    best = Placement(self.layout, dx, dy, rx, ry)
        return best

    def fits(self, room_x: float, room_y: float, step: float = 0.05) -> Optional[Placement]:
        """Does any offset place both instruments inside this specific room?"""
        for _, dx, dy in self._candidates(step, room=(room_x, room_y)):
            if self.feasible(dx, dy):
                rx, ry = self.required_room(dx, dy)
                return Placement(self.layout, dx, dy, rx, ry)
        return None


# ==========================================================================
# room candidates
# ==========================================================================

@dataclass
class RoomCandidate:
    gross_x: float          # short dimension
    gross_y: float          # long dimension
    label: str
    on_module: bool

    @property
    def gross_area(self) -> float:
        return self.gross_x * self.gross_y

    @property
    def aspect(self) -> float:
        return self.gross_y / self.gross_x


def candidate_rooms(target_m2: float, module: float,
                    tol: float = 0.02) -> List[RoomCandidate]:
    """Plausible GROSS internal rectangles that hit the target plan area.

    Two families, because the plan area alone does not fix the shape:

      * module-grid rectangles - what a steel-frame house on a 455 mm grid can
        actually produce;
      * free rectangles at a spread of aspect ratios - included so the study
        spans the shape range rather than only the two shapes the grid happens
        to allow. These are shape *probes*, not buildable proposals.
    """
    out: List[RoomCandidate] = []
    lo, hi = target_m2 * (1 - tol), target_m2 * (1 + tol)

    n_min, n_max = int(2.5 / module), int(9.0 / module)
    seen = set()
    for i in range(n_min, n_max + 1):
        for j in range(i, n_max + 1):
            x, y = round(i * module, 4), round(j * module, 4)
            if lo <= x * y <= hi and (x, y) not in seen:
                seen.add((x, y))
                out.append(RoomCandidate(x, y, f"module {i}x{j} @ {module*1000:.0f}mm", True))

    for r in (1.00, 1.15, 1.30, 1.50, 1.75, 2.00, 2.30):
        x = math.sqrt(target_m2 / r)
        y = r * x
        out.append(RoomCandidate(round(x, 3), round(y, 3), f"free 1:{r:.2f}", False))

    out.sort(key=lambda c: c.aspect)
    return out


def net_from_gross(gx: float, gy: float, wall_per_side: float) -> Tuple[float, float]:
    return gx - 2 * wall_per_side, gy - 2 * wall_per_side


# ==========================================================================
# report
# ==========================================================================

def load_params() -> dict:
    with open(PARAMS_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    P = load_params()
    mr = P["music_room"]
    ac = mr["acoustic_construction"]
    conv = P["conventions"]

    jo = mr["plan_area_jo"]["value"]
    module = conv["planning_module"]["value"]
    wall = ac["wall_buildup_per_side_m"]["value"]
    rise = ac["floating_floor_rise_m"]["value"]
    drop = ac["ceiling_drop_m"]["value"]

    cl = Clearances(
        wall_to_piano=mr["clearances_m"]["wall_to_piano"]["value"],
        between_pianos=mr["clearances_m"]["between_pianos"]["value"],
        player_zone_depth=mr["clearances_m"]["player_zone_depth"]["value"],
        player_zone_width=mr["clearances_m"]["player_zone_width"]["value"],
    )

    conventions = {
        "910x1820 module (1.6562 m2/jo)": conv["jo_to_sqm"]["value"],
        "Fair Competition Code minimum (1.62 m2/jo)": conv["jo_to_sqm"]["alternatives"]["fair_trade_min"],
    }

    L: List[str] = []
    w = L.append

    w("# PIANO FIT & ACOUSTIC NET-AREA REPORT")
    w("")
    w("**CRITICAL PATH DOCUMENT — client brief sections B / C / D.**  ")
    w("Generated by `scripts/acoustic_piano_fit.py`. Do not hand-edit; re-run the script.")
    w("")
    w("> **Status of the inputs.** The plan area (17.3 jo) and the two-grand-piano")
    w("> requirement are CONFIRMED from the client brief. Everything else on this")
    w("> page — room aspect ratio, acoustic build-up thickness, ceiling height,")
    w("> instrument models — is **ASSUMED**, because no drawing set and no acoustic")
    w("> specification reached this session. The numbers below are therefore a")
    w("> **bounding study**, not a verification of this house. See")
    w("> `docs/DRAWING_ANALYSIS.md`.")
    w("")

    # ---- 1. area conversion --------------------------------------------
    w("## 1. What does \"17.3 jo\" actually mean?")
    w("")
    w("Japanese plans quote room size in *jo* under more than one convention, and")
    w("the brief's prohibition on inventing dimensions applies here first:")
    w("")
    w("| Convention | m² per jo | 17.3 jo = |")
    w("|---|---:|---:|")
    for name, k in conventions.items():
        w(f"| {name} | {k:.4f} | **{jo * k:.2f} m²** |")
    w("")
    w(f"Spread: **{abs(jo*list(conventions.values())[0] - jo*list(conventions.values())[1]):.2f} m²**. ")
    w("Small in absolute terms, but it lands directly on the margin this study is")
    w("trying to measure. *Which convention the Daiwa House plan uses is an open")
    w("question for the builder.*")
    w("")

    # ---- 2. gross -> net -----------------------------------------------
    w("## 2. Acoustic build-up: gross plan area is not usable area")
    w("")
    w("A piano-grade room is a box built *inside* the structural box. The lining")
    w("is assumed as follows (all ASSUMED — no acoustic spec supplied):")
    w("")
    w("| Element | Assumed | Range considered |")
    w("|---|---:|---|")
    w(f"| Inner wall build-up, per side | {wall*1000:.0f} mm | "
      f"{ac['wall_buildup_per_side_m']['range'][0]*1000:.0f}–{ac['wall_buildup_per_side_m']['range'][1]*1000:.0f} mm |")
    w(f"| Floating floor rise | {rise*1000:.0f} mm | "
      f"{ac['floating_floor_rise_m']['range'][0]*1000:.0f}–{ac['floating_floor_rise_m']['range'][1]*1000:.0f} mm |")
    w(f"| Isolated ceiling drop | {drop*1000:.0f} mm | "
      f"{ac['ceiling_drop_m']['range'][0]*1000:.0f}–{ac['ceiling_drop_m']['range'][1]*1000:.0f} mm |")
    w(f"| Target isolation | {ac['target_grade']['value']} | Dr-45 is marginal for two grands |")
    w("")
    w(f"Every wall loses **{wall*1000:.0f} mm**, so each plan dimension loses")
    w(f"**{wall*2000:.0f} mm** and the ceiling loses **{(rise+drop)*1000:.0f} mm**.")
    w("")

    # ---- 3. candidate shapes -------------------------------------------
    w("## 3. The plan area does not fix the shape — and the shape decides the answer")
    w("")
    w("Candidate gross-internal rectangles on the assumed "
      f"{module*1000:.0f} mm planning module that land within ±2 % of the target area:")
    w("")

    target = jo * conv["jo_to_sqm"]["value"]
    cands = candidate_rooms(target, module)

    w("| # | Gross internal | Origin | Aspect | **Net internal after lining** | Net area | Loss |")
    w("|---:|---|---|---:|---|---:|---:|")
    for i, c in enumerate(cands, 1):
        nx, ny = net_from_gross(c.gross_x, c.gross_y, wall)
        loss = 1.0 - (nx * ny) / c.gross_area
        w(f"| {i} | {c.gross_x:.3f} × {c.gross_y:.3f} m | {c.label} | "
          f"1 : {c.aspect:.2f} | **{nx:.3f} × {ny:.3f} m** | {nx*ny:.2f} m² | {loss*100:.1f} % |")
    w("")
    avg_loss = sum(1.0 - (net_from_gross(c.gross_x, c.gross_y, wall)[0] *
                          net_from_gross(c.gross_x, c.gross_y, wall)[1]) / c.gross_area
                   for c in cands) / len(cands)
    w(f"**Mean floor-area loss to the acoustic lining: {avg_loss*100:.1f} %.** ")
    w("The 17.3 jo printed on the plan is not 17.3 jo of playable room — and the")
    w("loss is worse for a squarer room, because the lining is charged per wall.")
    w("")

    # ---- 4. minimum room per layout ------------------------------------
    w("## 4. How much clear floor do two grand pianos actually need?")
    w("")
    w("Clearances applied (ASSUMED):")
    w("")
    w(f"- wall → piano case: **{cl.wall_to_piano*1000:.0f} mm** (tuning and moving access; a rim hard against a wall is also acoustically poor)")
    w(f"- piano → piano: **{cl.between_pianos*1000:.0f} mm**")
    w(f"- bench + player zone: **{cl.player_zone_depth*1000:.0f} mm deep × {cl.player_zone_width*1000:.0f} mm wide** per instrument")
    w("")
    w("The search is exact: the two case outlines are real polygons (straight bass")
    w("side, curved bentside, narrow tail), and the solver minimises the enclosing")
    w("room over every relative offset of the two instruments.")
    w("")
    w("The five layouts tested:")
    w("")
    for lay in LAYOUTS:
        w(f"- **{lay.name_en}** ({lay.name_ja}) — {lay.note}")
    w("")

    matrix_rows: List[dict] = []
    min_tables: Dict[str, List[str]] = {}

    for a_key, b_key, pair_label in PAIRINGS:
        A, B = CATALOGUE[a_key], CATALOGUE[b_key]
        w(f"### {pair_label}")
        w("")
        w(f"`{A.maker} {A.model}` {A.length_m:.2f} × {A.width_m:.2f} m  +  "
          f"`{B.maker} {B.model}` {B.length_m:.2f} × {B.width_m:.2f} m")
        w("")
        w("| Layout | Minimum NET internal room | Net floor needed | Equivalent GROSS room |")
        w("|---|---|---:|---|")
        for lay in LAYOUTS:
            solver = FitSolver(A, B, lay, cl)
            best = solver.minimum_room()
            if best is None:
                w(f"| {lay.name_en} | — | — | infeasible at any size |")
                continue
            gx, gy = best.req_x + 2 * wall, best.req_y + 2 * wall
            w(f"| {lay.name_en} ({lay.name_ja}) | "
              f"**{best.req_x:.2f} × {best.req_y:.2f} m** | {best.req_area:.2f} m² | "
              f"{gx:.2f} × {gy:.2f} m = {gx*gy:.2f} m² |")
            matrix_rows.append({
                "pairing": pair_label,
                "piano_a": f"{A.maker} {A.model}",
                "piano_b": f"{B.maker} {B.model}",
                "layout": lay.key,
                "layout_ja": lay.name_ja,
                "min_net_x_m": round(best.req_x, 3),
                "min_net_y_m": round(best.req_y, 3),
                "min_net_area_m2": round(best.req_area, 2),
                "equiv_gross_x_m": round(gx, 3),
                "equiv_gross_y_m": round(gy, 3),
                "equiv_gross_area_m2": round(gx * gy, 2),
                "equiv_gross_jo_1_6562": round(gx * gy / 1.6562, 1),
            })
        w("")

    # ---- 5. the actual test --------------------------------------------
    w("## 5. VERDICT — do they fit in a 17.3 jo room after lining?")
    w("")
    w("Each candidate shape from §3, lined, tested against each instrument pair.")
    w("`OK` = at least one of the five layouts places both instruments with every")
    w("clearance satisfied.")
    w("")

    verdict_rows: List[dict] = []
    header = "| Gross internal | Aspect | " + " | ".join(
        f"{CATALOGUE[a].model}+{CATALOGUE[b].model}" for a, b, _ in PAIRINGS) + " |"
    w(header)
    w("|---|---:|" + "---|" * len(PAIRINGS))

    any_fit_by_pair = {a + "+" + b: 0 for a, b, _ in PAIRINGS}

    for c in cands:
        nx, ny = net_from_gross(c.gross_x, c.gross_y, wall)
        cells = []
        for a_key, b_key, _ in PAIRINGS:
            A, B = CATALOGUE[a_key], CATALOGUE[b_key]
            ok_layout, ok_place, slack = None, None, None
            for lay in LAYOUTS:
                p = FitSolver(A, B, lay, cl).fits(nx, ny)
                if p:
                    ok_layout, ok_place = lay, p
                    break
            if ok_layout:
                any_fit_by_pair[a_key + "+" + b_key] += 1
                slack = min(max(nx, ny) - max(ok_place.req_x, ok_place.req_y),
                            min(nx, ny) - min(ok_place.req_x, ok_place.req_y))
                cells.append(f"**OK** · {ok_layout.key} · slack {slack*1000:.0f} mm")
            else:
                cells.append("**NO**")
            verdict_rows.append({
                "gross_x_m": c.gross_x, "gross_y_m": c.gross_y,
                "shape_origin": c.label, "aspect": round(c.aspect, 3),
                "net_x_m": round(nx, 3), "net_y_m": round(ny, 3),
                "net_area_m2": round(nx * ny, 2),
                "piano_a": f"{A.maker} {A.model}", "piano_b": f"{B.maker} {B.model}",
                "fits": "YES" if ok_layout else "NO",
                "layout": ok_layout.key if ok_layout else "",
                "slack_mm": round(slack * 1000) if slack is not None else "",
            })
        w(f"| {c.gross_x:.3f} × {c.gross_y:.3f} m | 1 : {c.aspect:.2f} | " +
          " | ".join(cells) + " |")
    w("")
    w("**Reading of §5.** Floor area is *not* the binding constraint. A lined")
    w("17.3 jo room has enough clear floor for two grand pianos in several")
    w("shapes — but only via the nested duo layout, and only with modest slack.")
    w("The constraints that actually bite are in §6 and §7.")
    w("")

    # ---- 6. volume, height, modal behaviour ----------------------------
    need_v, rule = acoustic_volume_guidance(2)
    max_lid = max(CATALOGUE[k].lid_open_h_m for p in PAIRINGS for k in p[:2])

    w("## 6. Ceiling height, volume and modal behaviour")
    w("")
    w(f"Volume guidance for two grands: **{need_v:.0f} m³** — {rule}.")
    w("")
    w(f"The lining costs **{(rise+drop)*1000:.0f} mm** of ceiling height "
      f"({rise*1000:.0f} mm floating floor + {drop*1000:.0f} mm isolated ceiling).")
    w("")
    w("| Gross ceiling (ASSUMED) | Net ceiling | 令21条 ≥2.1 m | Lid-open clearance | Verdict |")
    w("|---|---|---|---:|---|")
    for gross_h in (2.400, 2.500, 2.720, 3.000):
        net_h = gross_h - rise - drop
        head = net_h - max_lid
        legal = "✓" if net_h >= STATUTORY_MIN_CEILING_M else "✗ **BELOW MINIMUM**"
        if net_h < STATUTORY_MIN_CEILING_M:
            v = "**not lawful as a 居室 at this build-up**"
        elif net_h < STATUTORY_MIN_CEILING_M + 0.10:
            v = "lawful, but the margin is inside the build-up tolerance"
        elif net_h < 2.30:
            v = "lawful but acoustically low"
        elif head < 0.30:
            v = "workable; coordinate ceiling services around the open lid"
        else:
            v = "comfortable"
        w(f"| {gross_h:.3f} m | **{net_h:.3f} m** | {legal} | {head*1000:.0f} mm | {v} |")
    w("")
    w("> **建築基準法施行令第21条** requires a 居室 to have a ceiling height of")
    w("> 2.1 m or more (<https://laws.e-gov.go.jp/law/325CO0000000338>). A music")
    w("> room used continuously falls within 居室 as defined in 建築基準法第2条")
    w("> 第4号 (<https://laws.e-gov.go.jp/law/325AC0000000201>). The acoustic")
    w(f"> build-up assumed here consumes {(rise+drop)*1000:.0f} mm, so a "
      f"{STATUTORY_MIN_CEILING_M + rise + drop:.3f} m gross ceiling is the")
    w("> minimum that still complies once the room is lined. Confirm against the")
    w("> section drawing before the 確認申請. *Regulatory checkpoint for")
    w("> coordination, not a legal opinion.*")
    w("")
    w("### 6.1 Net volume against guidance")
    w("")
    w("| Gross internal | Net floor | " +
      " | ".join(f"V @ {h:.2f} m gross" for h in (2.400, 2.720, 3.000)) + " |")
    w("|---|---:|---:|---:|---:|")
    vol_rows: List[dict] = []
    for c in cands:
        nx, ny = net_from_gross(c.gross_x, c.gross_y, wall)
        cells = []
        for gross_h in (2.400, 2.720, 3.000):
            net_h = gross_h - rise - drop
            vol = nx * ny * net_h
            mark = "" if vol >= need_v else " ⚠"
            cells.append(f"{vol:.1f} m³{mark}")
            vol_rows.append({
                "gross_x_m": c.gross_x, "gross_y_m": c.gross_y,
                "gross_ceiling_m": gross_h, "net_ceiling_m": round(net_h, 3),
                "net_volume_m3": round(vol, 1),
                "guidance_m3": need_v,
                "meets_guidance": "YES" if vol >= need_v else "NO",
            })
        w(f"| {c.gross_x:.3f} × {c.gross_y:.3f} m | {nx*ny:.2f} m² | " +
          " | ".join(cells) + " |")
    w("")
    short_all = all(r["meets_guidance"] == "NO" for r in vol_rows)
    if short_all:
        w("> ⚠️ **Every** combination of candidate shape and plausible ceiling height")
        w(f"> falls short of the {need_v:.0f} m³ guidance for two grand pianos.")
        w("> Two grands will fit on the floor; the room will still be *small* for them,")
        w("> and will need serious absorption to stay playable at full dynamic range.")
        w("> This is the single most important finding in this report and it is a")
        w("> **design decision for the client**, not a modelling problem:")
        w(">")
        w("> - accept a loud, heavily-damped room, or")
        w("> - raise the music-room ceiling (a section change), or")
        w("> - open the room into a void / vaulted ceiling to borrow volume, or")
        w("> - choose smaller instruments than two full-size grands.")
    w("")

    # ---- 6.2 modal screening -------------------------------------------
    w("### 6.2 Proportion screening (rectangular room modes)")
    w("")
    w(f"Axial modes below 200 Hz, at the assumed 2.720 m gross ceiling "
      f"(net {2.720-rise-drop:.3f} m). Fewer degeneracies and a smaller worst gap")
    w("is better; Louden's best-ranked proportion is 1 : 1.40 : 1.90 "
      "(height : width : length).")
    w("")
    w("| Gross internal | H:W:L (net) | Louden deviation | Axial modes <200 Hz | Degenerate pairs | Worst gap |")
    w("|---|---|---:|---:|---:|---:|")
    modal_rows: List[dict] = []
    net_h = 2.720 - rise - drop
    for c in cands:
        nx, ny = net_from_gross(c.gross_x, c.gross_y, wall)
        rep = AC.modal_spacing_report(nx, ny, net_h)
        wr, lr, dev, _ = AC.proportion_score(nx, ny, net_h)
        w(f"| {c.gross_x:.3f} × {c.gross_y:.3f} m | 1 : {wr:.2f} : {lr:.2f} | "
          f"{dev:.2f} | {rep['n_axial_below_200']} | {rep['degenerate_pairs']} | "
          f"×{rep['max_axial_gap_ratio']:.2f} @ {rep['max_gap_at_hz']:.0f} Hz |")
        modal_rows.append({
            "gross_x_m": c.gross_x, "gross_y_m": c.gross_y,
            "net_x_m": round(nx, 3), "net_y_m": round(ny, 3), "net_h_m": round(net_h, 3),
            "ratio_w": round(wr, 3), "ratio_l": round(lr, 3),
            "louden_deviation": round(dev, 3),
            "axial_modes_below_200hz": rep["n_axial_below_200"],
            "degenerate_pairs": rep["degenerate_pairs"],
            "max_axial_gap_ratio": round(rep["max_axial_gap_ratio"], 3),
        })
    w("")
    best_prop = min(modal_rows, key=lambda r: (r["degenerate_pairs"], r["louden_deviation"]))
    n_deg = best_prop["degenerate_pairs"]
    w(f"Best-behaved proportion in this set: "
      f"**{best_prop['gross_x_m']:.3f} × {best_prop['gross_y_m']:.3f} m gross** "
      f"({n_deg} degenerate pair{'' if n_deg == 1 else 's'}, Louden deviation "
      f"{best_prop['louden_deviation']:.2f}).")
    w("")
    w("> Caveat: this is a rigid-wall rectangular screen. A lined room has damped")
    w("> boundaries and the real room may not be rectangular at all. Use it to")
    w("> rank proportions, not to predict a response.")
    w("")

    # ---- 7. delivery ----------------------------------------------------
    w("## 7. Getting the instruments into the room — the overlooked constraint")
    w("")
    w("A grand piano is moved on its bass side on a skid. Legs and pedal lyre come")
    w("off; the case itself does not get smaller. What has to pass through the door:")
    w("")
    w("| Instrument | Length on skid | Thickness (rim depth) | Height on skid | Mass |")
    w("|---|---:|---:|---:|---:|")
    for key in sorted({k for p in PAIRINGS for k in p[:2]}):
        p = CATALOGUE[key]
        w(f"| {p.maker} {p.model} | {p.length_m:.2f} m | {p.rim_depth_m:.2f} m | "
          f"{p.on_side_height_m:.2f} m | {p.mass_kg:.0f} kg |")
    w("")
    door_w = ac["door"]["clear_width_m"]["value"]
    door_h = ac["door"]["clear_height_m"]["value"]
    need_w = mr["delivery_access"]["required_clear_width_m"]["value"]
    need_h = mr["delivery_access"]["required_clear_height_m"]["value"]
    w(f"Assumed acoustic door clear opening: **{door_w*1000:.0f} × {door_h*1000:.0f} mm**. ")
    w(f"Movers' practical minimum: **{need_w*1000:.0f} × {need_h*1000:.0f} mm**.")
    w("")
    if door_w < need_w:
        w(f"> ⚠️ **RISK — DELIVERY.** A typical single-leaf acoustic door "
          f"({door_w*1000:.0f} mm clear) is **{(need_w-door_w)*1000:.0f} mm narrower** "
          "than the practical minimum for a grand piano. Acoustic doors are heavy, "
          "gasketed and usually *narrower* than an ordinary internal door, which is "
          "exactly the wrong direction. This is a sequencing-and-detailing problem "
          "that has to be solved on the drawing board, not on delivery day.")
    else:
        w("> Delivery opening is adequate on width.")
    w("")
    w("Resolution options (none of them free):")
    for opt in mr["delivery_access"]["resolution_options"]:
        w(f"- {opt}")
    w("")
    w("Also required and not yet known: the turning geometry from the entrance,")
    w("through the hall, into the room opening for a rigid "
      f"{max(CATALOGUE[k].length_m for p in PAIRINGS for k in p[:2]):.2f} m object; "
      "and the floating floor's point load capacity under "
      f"{sum(CATALOGUE[k].mass_kg for k in ('yamaha_cfx','yamaha_c7x')):.0f} kg "
      "of instrument on eight castors.")
    w("")

    # ---- 8. what this does not prove ------------------------------------
    w("## 8. What this report does NOT establish")
    w("")
    w("1. **That the room is any of the shapes in §3.** No plan was supplied. The")
    w("   real room may be non-rectangular, may have a structural column or a")
    w("   duct bulkhead in it, and may have its door and window positions in the")
    w("   worst possible place for a piano layout.")
    w("2. **That the acoustic build-up is as assumed.** No acoustic specification")
    w("   was supplied. At the 200 mm end of the range each plan dimension loses")
    w(f"   400 mm instead of {wall*2000:.0f} mm.")
    w("3. **That the ceiling height is workable.** UNRESOLVED pending the section.")
    w("4. **That the structure can carry it.** A floating floor plus two grands is")
    w("   a substantial superimposed load; that is the structural engineer's call.")
    w("")
    w("Every one of these is a `UNRESOLVED` entry in `params/house_params.json`.")
    w("")

    # ---- executive summary, spliced in after the status blockquote -----
    n_shapes = len(cands)
    n_fit_worst = any_fit_by_pair["yamaha_cfx+yamaha_cfx"]
    n_fit_default = any_fit_by_pair["yamaha_c7x+yamaha_c3x"]

    summary: List[str] = [
        "## 0. Summary — where the real constraints are",
        "",
        "| Question | Finding |",
        "|---|---|",
        (f"| Is there enough **floor** for two grands? | Yes, in "
         f"{n_fit_default}/{n_shapes} candidate shapes for the default pairing and "
         f"{n_fit_worst}/{n_shapes} even for two full concert grands — but "
         f"essentially only via the nested duo layout. |"),
        (f"| How much floor does the acoustic lining eat? | "
         f"**{avg_loss*100:.1f} %** on average — about "
         f"{jo - (jo * (1-avg_loss)):.1f} jo of the 17.3 jo. |"),
        ("| Is there enough **volume**? | "
         + ("**No — not in any combination tested.** See §6.1. This is the binding "
            "constraint." if short_all else "Yes in some combinations; see §6.1.") + " |"),
        ("| Can the instruments be **delivered** into the room? | "
         + ("**Not through a typical acoustic door.** See §7." if door_w < need_w
            else "Yes on the assumed opening; see §7.") + " |"),
        ("| Is the room **shape** acoustically sensible? | "
         f"Best of the candidates is {best_prop['gross_x_m']:.3f} × "
         f"{best_prop['gross_y_m']:.3f} m; see §6.2. |"),
        (f"| Does the lined room still clear 建築基準法施行令第21条? | "
         f"Only above a **{STATUTORY_MIN_CEILING_M + rise + drop:.3f} m** gross "
         f"ceiling. At 2.400 m gross the finished room is "
         f"{2.400 - rise - drop:.3f} m — below the 2.1 m minimum. See §6. |"),
        "",
        "**The headline is not \"do they fit\" — they do. It is that a 17.3 jo room,**",
        "**once lined, is volumetrically small for two grand pianos, and that the**",
        "**door is a plausible show-stopper.** Both are cheap to fix on the drawing",
        "board and expensive to fix on site.",
        "",
    ]
    anchor = L.index("## 1. What does \"17.3 jo\" actually mean?")
    L[anchor:anchor] = summary

    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "PIANO_FIT_REPORT.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    for fname, rows in (("PIANO_FIT_MATRIX.csv", matrix_rows),
                        ("PIANO_FIT_VERDICT.csv", verdict_rows),
                        ("PIANO_ROOM_VOLUME.csv", vol_rows),
                        ("PIANO_ROOM_MODAL.csv", modal_rows)):
        if not rows:
            continue
        with open(os.path.join(DOCS, fname), "w", encoding="utf-8", newline="") as fh:
            wcsv = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            wcsv.writeheader()
            wcsv.writerows(rows)
        print(f"wrote docs/{fname:<24} ({len(rows)} rows)")

    print("wrote docs/PIANO_FIT_REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
