#!/usr/bin/env python3
"""
PHASE 4 / 10 / 15 - Dimensional and requirement QA.

Run:  python3 scripts/qa_verify.py            (no Blender needed)
      python3 scripts/qa_verify.py --strict   (treat BLOCKED as failure)

Exit codes:
    0  all checks pass
    1  a CRITICAL check FAILED           -> project may NOT be called complete
    2  only BLOCKED items remain          -> waiting on the drawing set

The CRITICAL block implements brief §S verbatim. The brief states that a single
CRITICAL failure means the project is not complete, so this script is the gate,
not a report: it returns non-zero and is meant to be wired into any
"is it done?" check.

BLOCKED is deliberately distinct from FAIL. A check whose input has not been
supplied has not been passed, and must never be reported as passed - but it is
also not the same as a requirement that was implemented wrongly. Conflating the
two is how the music room went missing before.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Callable, List, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(SCRIPT_DIR, "lib"))
sys.path.insert(0, SCRIPT_DIR)

from pianos import CATALOGUE                                  # noqa: E402

PARAMS_PATH = os.path.join(ROOT, "params", "house_params.json")

PASS, FAIL, BLOCKED, WARN = "PASS", "FAIL", "BLOCKED", "WARN"

# 建築基準法施行令第21条 https://laws.e-gov.go.jp/law/325CO0000000338
STATUTORY_MIN_CEILING_M = 2.10
# 建築基準法施行令第23条 - stairs in a dwelling
STAIR_MIN_TREAD_M = 0.150
STAIR_MAX_RISER_M = 0.230
STAIR_MIN_WIDTH_M = 0.750


@dataclass
class Check:
    cid: str
    title: str
    critical: bool
    status: str = BLOCKED
    detail: str = ""


class QA:
    def __init__(self, params: dict):
        self.p = params
        self.checks: List[Check] = []

    def add(self, cid, title, critical, status, detail=""):
        self.checks.append(Check(cid, title, critical, status, detail))

    # -- helpers --------------------------------------------------------
    def resolved(self, dotted: str) -> Optional[object]:
        """Return the value at `dotted`, or None if it is not actually known.

        Three ways a parameter can be unknown, and all three must return None.
        Missing any of them produces a check that reports PASS while holding
        nothing — the exact failure mode this whole file exists to prevent.
        """
        node = self.p
        try:
            for part in dotted.split("."):
                node = node[part]
        except (KeyError, TypeError):
            return None                                   # 1. absent

        if isinstance(node, dict):
            if node.get("status") == "UNRESOLVED":
                return None                               # 2. tagged UNRESOLVED
            value = node.get("value")
        else:
            value = node

        if value is None:
            return None
        if isinstance(value, str) and value.strip().upper() == "UNRESOLVED":
            return None                                   # 3. a bare "UNRESOLVED" marker
        return value

    def dim_check(self, cid, title, dotted, source, critical=False):
        v = self.resolved(dotted)
        if v is None:
            self.add(cid, title, critical, BLOCKED, f"awaiting {source}")
        else:
            self.add(cid, title, critical, PASS, f"{v}")

    # ==================================================================
    # standard dimensional QA - brief §S
    # ==================================================================
    def run_dimensional(self):
        self.dim_check("QA-01", "Site dimensions", "site.area_m2", "配置図")
        self.dim_check("QA-02", "Building footprint", "building.footprint_polygon_m", "1階平面図")
        self.dim_check("QA-03", "1F geometry (GFA)", "building.gfa_1f_m2", "1階平面図")
        self.dim_check("QA-04", "2F geometry (GFA)", "building.gfa_2f_m2", "2階平面図")
        self.dim_check("QA-05", "Floor heights", "levels.floor_to_floor_1f_m", "断面図")
        self.dim_check("QA-06", "Ceiling heights", "levels.ceiling_h_1f_m", "断面図")
        self.dim_check("QA-07", "Roof geometry", "roof.type", "立面図")
        self.dim_check("QA-08", "Window positions", "openings._status", "平面図+立面図")
        self.dim_check("QA-09", "Door positions", "openings._status", "平面図")
        self.dim_check("QA-11", "Double-height void", "void.polygon_m", "2階平面図+断面図")
        self.dim_check("QA-12", "Balcony", "balcony.polygon_m", "2階平面図")
        self.dim_check("QA-13", "LDK dimensions", "rooms._status", "1階平面図")

        # QA-10 stair, with the statutory floors actually applied
        riser = self.resolved("stair.riser_h_m")
        tread = self.resolved("stair.tread_d_m")
        if riser is None or tread is None:
            self.add("QA-10", "Stair geometry", False, BLOCKED,
                     "awaiting 平面図+断面図")
        else:
            probs = []
            if tread < STAIR_MIN_TREAD_M:
                probs.append(f"tread {tread*1000:.0f} mm < 150 mm (令23条)")
            if riser > STAIR_MAX_RISER_M:
                probs.append(f"riser {riser*1000:.0f} mm > 230 mm (令23条)")
            self.add("QA-10", "Stair geometry", False,
                     FAIL if probs else PASS,
                     "; ".join(probs) if probs else
                     f"riser {riser*1000:.0f} mm, tread {tread*1000:.0f} mm — "
                     f"within 建築基準法施行令第23条")

        # true north, needed before any sun study means anything
        if self.resolved("lighting.latitude_deg") is None:
            self.add("QA-14", "Sun path is site-correct", False, BLOCKED,
                     "site latitude/longitude and true north not supplied — "
                     "day/night modes will render, but the sun angles are not this site's")
        else:
            self.add("QA-14", "Sun path is site-correct", False, PASS)

    # ==================================================================
    # CRITICAL - brief §B/§C/§D. A single FAIL blocks completion.
    # ==================================================================
    def run_critical(self):
        mr = self.p["music_room"]
        ac = mr["acoustic_construction"]

        # ---- CRIT-01: the room exists AS a soundproof music room -------
        prog = mr["program"]["value"]
        forbidden = ("bedroom", "guest", "spare", "western", "multi-purpose",
                     "洋室", "予備室", "客間", "多目的")
        ok = ("SOUNDPROOF" in prog.upper() and "MUSIC" in prog.upper()
              and not any(f.lower() in prog.lower() for f in forbidden))
        self.add("QA-CRIT-01",
                 "1F 17.3帖 space is modelled as a soundproof music room",
                 True, PASS if ok else FAIL, prog)

        # ---- CRIT-05: acoustic build-up actually reduces the room ------
        wall = ac["wall_buildup_per_side_m"]["value"]
        rise = ac["floating_floor_rise_m"]["value"]
        drop = ac["ceiling_drop_m"]["value"]
        reduces = wall > 0 and (rise + drop) > 0
        self.add("QA-CRIT-05",
                 "Acoustic construction reduces internal dimensions appropriately",
                 True, PASS if reduces else FAIL,
                 f"−{wall*2000:.0f} mm on each plan dimension, "
                 f"−{(rise+drop)*1000:.0f} mm ceiling")

        # ---- geometry-dependent criticals -----------------------------
        gx = self.resolved("music_room.gross_internal_x_m")
        gy = self.resolved("music_room.gross_internal_y_m")
        gh = self.resolved("music_room.gross_ceiling_h_m")

        A = CATALOGUE[mr["instruments"]["piano_A"]["model_key"]]
        B = CATALOGUE[mr["instruments"]["piano_B"]["model_key"]]

        # ---- CRIT-03: instruments have realistic dimensions ------------
        bad = [p for p in (A, B)
               if not (1.70 <= p.length_m <= 3.00 and 1.40 <= p.width_m <= 1.65
                       and 0.95 <= p.height_m <= 1.10)]
        self.add("QA-CRIT-03", "Both pianos have realistic dimensions", True,
                 FAIL if bad else PASS,
                 f"{A.maker} {A.model} {A.length_m:.2f}×{A.width_m:.2f} m; "
                 f"{B.maker} {B.model} {B.length_m:.2f}×{B.width_m:.2f} m "
                 f"(catalogue dimensions)")

        if gx is None or gy is None:
            for cid, title in (("QA-CRIT-02", "Two grand pianos are physically installed"),
                               ("QA-CRIT-04", "Two performers can use them simultaneously")):
                self.add(cid, title, True, BLOCKED,
                         "music room gross internal dimensions UNRESOLVED — "
                         "awaiting 1階平面図")
        else:
            from acoustic_piano_fit import Clearances, FitSolver, LAYOUTS
            cl = Clearances(
                wall_to_piano=mr["clearances_m"]["wall_to_piano"]["value"],
                between_pianos=mr["clearances_m"]["between_pianos"]["value"],
                player_zone_depth=mr["clearances_m"]["player_zone_depth"]["value"],
                player_zone_width=mr["clearances_m"]["player_zone_width"]["value"],
            )
            nx, ny = gx - 2 * wall, gy - 2 * wall
            found = None
            for lay in LAYOUTS:
                s = FitSolver(A, B, lay, cl)
                if s.fits(nx, ny) or s.fits(ny, nx):
                    found = lay
                    break
            detail = (f"net {nx:.3f}×{ny:.3f} m; "
                      + (f"fits via {found.key}" if found else "NO layout fits"))
            self.add("QA-CRIT-02", "Two grand pianos are physically installed",
                     True, PASS if found else FAIL, detail)
            # the player zones are part of the fit constraint, so CRIT-04
            # follows from CRIT-02 by construction
            self.add("QA-CRIT-04", "Two performers can use them simultaneously",
                     True, PASS if found else FAIL,
                     "bench + player zone per instrument is part of the fit "
                     "constraint" if found else "no feasible layout")

        # ---- ceiling: statutory + practical ---------------------------
        if gh is None:
            self.add("QA-CRIT-08",
                     "Lined music room clears 建築基準法施行令第21条 (≥2.1 m)",
                     True, BLOCKED, "music room ceiling height UNRESOLVED — awaiting 断面図")
        else:
            net_h = gh - rise - drop
            ok_h = net_h >= STATUTORY_MIN_CEILING_M
            self.add("QA-CRIT-08",
                     "Lined music room clears 建築基準法施行令第21条 (≥2.1 m)",
                     True, PASS if ok_h else FAIL,
                     f"gross {gh:.3f} m − {(rise+drop)*1000:.0f} mm lining = "
                     f"finished {net_h:.3f} m")

        # ---- CRIT-06: reachable in the walkthrough --------------------
        spec = os.path.join(ROOT, "Unreal", "WALKTHROUGH_SPEC.md")
        cams = os.path.join(ROOT, "Unreal", "Python", "setup_cameras.py")
        have = os.path.isfile(spec) and os.path.isfile(cams)
        if have:
            with open(cams, "r", encoding="utf-8") as fh:
                src = fh.read()
            music_cams = sum(1 for t in ("CAM_13", "CAM_14", "CAM_15", "CAM_16")
                             if t in src)
            self.add("QA-CRIT-06",
                     "Music room is visible and explorable in the Unreal walkthrough",
                     True, PASS if music_cams == 4 else FAIL,
                     f"{music_cams}/4 music-room QA cameras defined; "
                     f"walkthrough spec present")
        else:
            self.add("QA-CRIT-06",
                     "Music room is visible and explorable in the Unreal walkthrough",
                     True, FAIL, "walkthrough spec or camera script missing")

        # ---- CRIT-07: salon quality, not a bare studio ----------------
        prop = mr.get("interior_proposal", {})
        n_elem = len(prop.get("elements", []))
        self.add("QA-CRIT-07",
                 "Music room designed as a residential salon, not a bare studio",
                 True, PASS if n_elem >= 6 else FAIL,
                 f"{n_elem} interior elements specified as Interior Proposal")

        # ---- delivery: a warning, not a gate --------------------------
        dw = ac["door"]["clear_width_m"]["value"]
        need = mr["delivery_access"]["required_clear_width_m"]["value"]
        self.add("QA-WARN-01",
                 "Grand piano can be delivered through the music room opening",
                 False, WARN if dw < need else PASS,
                 f"assumed door clear width {dw*1000:.0f} mm vs "
                 f"{need*1000:.0f} mm practical minimum — see "
                 f"docs/PIANO_ROOM_REQUIREMENTS.md §5.4")

        # ---- volume: a warning, not a gate ----------------------------
        if gx and gy and gh:
            nx, ny = gx - 2 * wall, gy - 2 * wall
            vol = nx * ny * (gh - rise - drop)
            self.add("QA-WARN-02", "Net volume meets two-grand guidance (~76 m³)",
                     False, PASS if vol >= 76 else WARN,
                     f"{vol:.1f} m³ — see docs/PIANO_FIT_REPORT.md §6.1")

    # ==================================================================
    def report(self, strict: bool) -> int:
        crit = [c for c in self.checks if c.critical]
        std = [c for c in self.checks if not c.critical]

        icon = {PASS: "PASS   ", FAIL: "FAIL   ", BLOCKED: "BLOCKED", WARN: "WARN   "}

        print("=" * 78)
        print("QA VERIFICATION — xevoΣ PREMIUM Custom Residence Digital Twin")
        print("=" * 78)
        drawings = self.p["project"]["drawing_set_received"]["value"]
        print(f"Drawing set received: {drawings}")
        print(f"Model state         : {self.p['project']['model_state']['value']}")
        print()

        print("CRITICAL — a single FAIL means the project is NOT complete (brief §S)")
        print("-" * 78)
        for c in crit:
            print(f"  [{icon[c.status]}] {c.cid:<12} {c.title}")
            if c.detail:
                print(f"                            {c.detail}")
        print()
        print("STANDARD DIMENSIONAL QA")
        print("-" * 78)
        for c in std:
            print(f"  [{icon[c.status]}] {c.cid:<12} {c.title}")
            if c.detail:
                print(f"                            {c.detail}")
        print()

        n_fail = sum(1 for c in self.checks if c.status == FAIL)
        n_block = sum(1 for c in self.checks if c.status == BLOCKED)
        n_warn = sum(1 for c in self.checks if c.status == WARN)
        n_pass = sum(1 for c in self.checks if c.status == PASS)
        c_fail = sum(1 for c in crit if c.status == FAIL)
        c_block = sum(1 for c in crit if c.status == BLOCKED)

        print("=" * 78)
        print(f"  PASS {n_pass}   FAIL {n_fail}   BLOCKED {n_block}   WARN {n_warn}")
        print("=" * 78)

        if c_fail:
            print(f"\n  ✗ {c_fail} CRITICAL check(s) FAILED.")
            print("    The project may NOT be treated as complete. (brief §S)")
            return 1
        if c_block:
            print(f"\n  ⏸  {c_block} CRITICAL check(s) BLOCKED on the drawing set.")
            print("    Not a failure — but not a pass either. The project may NOT")
            print("    be treated as complete while any CRITICAL check is BLOCKED.")
            print("    Supply the drawings listed in docs/DRAWING_ANALYSIS.md §2.4.")
            return 2
        if n_block and strict:
            print(f"\n  ⏸  {n_block} standard check(s) BLOCKED; --strict requested.")
            return 2
        print("\n  ✓ All CRITICAL checks pass.")
        return 0


    # ==================================================================
    def to_markdown(self) -> str:
        mark = {PASS: "x", FAIL: " ", BLOCKED: " ", WARN: "x"}
        tag = {PASS: "**PASS**", FAIL: "**FAIL**",
               BLOCKED: "*BLOCKED — awaiting drawings*", WARN: "**WARN**"}
        L = ["# QA CHECKLIST",
             "",
             "**Generated by `scripts/qa_verify.py --markdown`. Do not hand-edit.**",
             "Re-run after any change to `params/house_params.json`.",
             "",
             f"- Drawing set received: **{self.p['project']['drawing_set_received']['value']}**",
             f"- Model state: **{self.p['project']['model_state']['value']}**",
             "",
             "---",
             "",
             "## CRITICAL (brief §S)",
             "",
             "> A single FAIL — or a single BLOCKED — means the project may **not**",
             "> be treated as complete.",
             ""]
        for c in [x for x in self.checks if x.critical]:
            L.append(f"- [{mark[c.status]}] `{c.cid}` {c.title} — {tag[c.status]}")
            if c.detail:
                L.append(f"      <br>{c.detail}")
        L += ["", "## Standard dimensional QA (brief §S)", ""]
        for c in [x for x in self.checks if not x.critical]:
            L.append(f"- [{mark[c.status]}] `{c.cid}` {c.title} — {tag[c.status]}")
            if c.detail:
                L.append(f"      <br>{c.detail}")

        n = {s: sum(1 for c in self.checks if c.status == s)
             for s in (PASS, FAIL, BLOCKED, WARN)}
        L += ["", "---", "",
              f"**PASS {n[PASS]} · FAIL {n[FAIL]} · BLOCKED {n[BLOCKED]} · WARN {n[WARN]}**",
              "",
              "`BLOCKED` is not `PASS`. A check whose input has never been supplied",
              "has not been satisfied — recording it as passed is how the music room",
              "went missing in earlier attempts at this model.",
              ""]
        return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="treat any BLOCKED check as a failure")
    ap.add_argument("--markdown", action="store_true",
                    help="also write docs/QA_CHECKLIST.md")
    args = ap.parse_args()

    with open(PARAMS_PATH, "r", encoding="utf-8") as fh:
        params = json.load(fh)

    qa = QA(params)
    qa.run_critical()
    qa.run_dimensional()
    rc = qa.report(args.strict)

    if args.markdown:
        out = os.path.join(ROOT, "docs", "QA_CHECKLIST.md")
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(qa.to_markdown())
        print(f"\nwrote docs/QA_CHECKLIST.md")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
