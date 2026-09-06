"""
Grand piano catalogue + parametric plan footprint.

Dimensions are manufacturer-published nominal case dimensions. `length` is the
overall case length from the front of the keyslip to the tail; `width` is the
overall case width at the keyboard end; `height` is the lid-closed height
including legs and castors.

STATUS OF THESE NUMBERS
-----------------------
CATALOGUE  - taken from manufacturer specification, accurate to ~1 cm.
DERIVED    - proportions of the plan outline (tail width, bentside start), which
             manufacturers do not publish. These are modelled proportions, good
             to a few centimetres, and are flagged as such. They affect nesting
             efficiency in the two-piano layouts, so the fit report always also
             reports the answer for a plain rectangular bounding box, which is
             a strict lower bound on available room and cannot be optimistic.

The client brief (section C) forbids toy / simplified piano models. This module
is the dimensional authority; the Blender builder consumes it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from geom2d import Polygon


@dataclass(frozen=True)
class GrandPiano:
    key: str
    maker: str
    model: str
    piano_class: str          # Concert / Semi-concert / Medium / Baby
    length_m: float           # keyslip front -> tail
    width_m: float            # overall case width at keyboard end
    height_m: float           # lid closed, on castors
    mass_kg: float
    lid_open_h_m: float       # top of lid at the full (long) prop
    rim_depth_m: float        # case thickness, lid to bottom board - the
                              # dimension that faces a doorway when the piano
                              # is carried on its side
    source: str = "manufacturer specification"

    # ---- plan-outline proportions (DERIVED, not published) ----
    tail_width_ratio: float = 0.30     # tail width / case width
    bentside_start_ratio: float = 0.32  # fraction of length held at full width
    bentside_exponent: float = 1.60     # bentside curve fullness

    @property
    def playing_width_m(self) -> float:
        """88 keys. Fixed by the keyboard, not by the model."""
        return 1.225

    @property
    def on_side_height_m(self) -> float:
        """Height presented to a doorway when moved on its bass side on a skid."""
        return self.width_m + 0.15  # + skid/board

    def footprint(self, segments: int = 28) -> Polygon:
        """Plan outline, counter-clockwise.

        Local frame:
            origin  = keyboard end, bass (straight) side corner
            +x      = keyboard end -> tail
            +y      = bass side -> treble side
        The player sits at negative x, facing +x.
        """
        L, W = self.length_m, self.width_m
        wt = W * self.tail_width_ratio
        xb = L * self.bentside_start_ratio

        pts: Polygon = [(0.0, 0.0), (L, 0.0)]          # straight (bass) side

        # tail end, treble-ward
        pts.append((L, wt))

        # bentside: tail -> keyboard end, treble side
        for i in range(1, segments):
            x = L - (L - xb) * (i / segments)
            t = (x - xb) / (L - xb)                     # 1 at tail, 0 at xb
            y = wt + (W - wt) * (1.0 - t) ** self.bentside_exponent
            pts.append((x, y))

        pts.append((xb, W))
        pts.append((0.0, W))                            # keyboard end, treble
        return pts

    def bbox_footprint(self) -> Polygon:
        """Strict rectangular envelope. Used for the conservative fit answer."""
        return [(0.0, 0.0), (self.length_m, 0.0),
                (self.length_m, self.width_m), (0.0, self.width_m)]

    def player_zone(self, depth_m: float, width_m: float) -> Polygon:
        """Bench + seated player + stand-and-leave space, in the same local
        frame as `footprint`: a rectangle immediately behind the keyboard."""
        y0 = (self.width_m - width_m) / 2.0
        return [(-depth_m, y0), (0.0, y0),
                (0.0, y0 + width_m), (-depth_m, y0 + width_m)]


CATALOGUE: Dict[str, GrandPiano] = {
    "yamaha_cfx": GrandPiano(
        key="yamaha_cfx", maker="Yamaha", model="CFX", piano_class="Concert",
        length_m=2.750, width_m=1.585, height_m=1.020, mass_kg=500.0,
        lid_open_h_m=2.00, rim_depth_m=0.375),
    "steinway_d": GrandPiano(
        key="steinway_d", maker="Steinway & Sons", model="D-274", piano_class="Concert",
        length_m=2.740, width_m=1.560, height_m=1.015, mass_kg=480.0,
        lid_open_h_m=1.98, rim_depth_m=0.370),
    "kawai_skex": GrandPiano(
        key="kawai_skex", maker="Kawai", model="Shigeru Kawai SK-EX", piano_class="Concert",
        length_m=2.780, width_m=1.560, height_m=1.020, mass_kg=465.0,
        lid_open_h_m=2.00, rim_depth_m=0.370),
    "yamaha_c7x": GrandPiano(
        key="yamaha_c7x", maker="Yamaha", model="C7X", piano_class="Semi-concert",
        length_m=2.270, width_m=1.510, height_m=1.020, mass_kg=405.0,
        lid_open_h_m=1.90, rim_depth_m=0.360),
    "steinway_b": GrandPiano(
        key="steinway_b", maker="Steinway & Sons", model="B-211", piano_class="Semi-concert",
        length_m=2.110, width_m=1.480, height_m=1.015, mass_kg=345.0,
        lid_open_h_m=1.85, rim_depth_m=0.355),
    "yamaha_c5x": GrandPiano(
        key="yamaha_c5x", maker="Yamaha", model="C5X", piano_class="Medium",
        length_m=2.000, width_m=1.490, height_m=1.010, mass_kg=350.0,
        lid_open_h_m=1.82, rim_depth_m=0.355),
    "yamaha_c3x": GrandPiano(
        key="yamaha_c3x", maker="Yamaha", model="C3X", piano_class="Medium",
        length_m=1.860, width_m=1.490, height_m=1.010, mass_kg=320.0,
        lid_open_h_m=1.80, rim_depth_m=0.355),
    "kawai_gx2": GrandPiano(
        key="kawai_gx2", maker="Kawai", model="GX-2", piano_class="Medium",
        length_m=1.800, width_m=1.500, height_m=1.010, mass_kg=326.0,
        lid_open_h_m=1.78, rim_depth_m=0.350),
}


# Instrument pairings the fit study evaluates, worst case first.
PAIRINGS: List[Tuple[str, str, str]] = [
    ("yamaha_cfx",  "yamaha_cfx",  "Two concert grands (absolute worst case)"),
    ("yamaha_cfx",  "yamaha_c7x",  "Concert + semi-concert"),
    ("yamaha_c7x",  "yamaha_c7x",  "Two semi-concert grands"),
    ("yamaha_c7x",  "yamaha_c3x",  "Semi-concert + medium (project default)"),
    ("yamaha_c3x",  "yamaha_c3x",  "Two medium grands"),
]


def acoustic_volume_guidance(n_grands: int) -> Tuple[float, str]:
    """Minimum room volume rule of thumb for grand pianos in a domestic room.

    A grand radiates 95-105 dB(A) at the player's ear. In a small hard room the
    direct+reverberant level and the modal behaviour below ~150 Hz both become
    unmanageable. Practical practice-room guidance is ~35-40 m3 per grand, with
    30 m3 an absolute floor.
    """
    return (38.0 * n_grands,
            "~38 m3 per grand (practice-room guidance; 30 m3/grand is the floor "
            "below which low-frequency modal behaviour dominates)")
