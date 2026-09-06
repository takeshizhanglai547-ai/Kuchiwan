"""
Room acoustics helpers for the music-room study. Dependency-free.

Scope note: this is *screening* analysis - the kind used to decide whether a
room proportion is worth pursuing before an acoustic consultant is engaged. It
is not a substitute for a measured or modelled design. Every function here is
documented with the assumption it rests on.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple

C_AIR = 343.0  # m/s at 20 degC


@dataclass
class Mode:
    f: float
    kind: str          # axial / tangential / oblique
    order: Tuple[int, int, int]


def room_modes(lx: float, ly: float, lz: float,
               f_max: float = 300.0, n_max: int = 8) -> List[Mode]:
    """Rayleigh mode frequencies for a rigid-walled rectangular room.

    f(nx,ny,nz) = c/2 * sqrt((nx/Lx)^2 + (ny/Ly)^2 + (nz/Lz)^2)

    Assumes a rectangular room with acoustically hard boundaries. A real lined
    room has finite-impedance surfaces, so measured modes are damped and shifted
    slightly - but the *distribution* this predicts is what decides whether a
    proportion is workable, and that is robust.
    """
    out: List[Mode] = []
    for nx in range(n_max + 1):
        for ny in range(n_max + 1):
            for nz in range(n_max + 1):
                if nx == ny == nz == 0:
                    continue
                f = (C_AIR / 2.0) * math.sqrt((nx / lx) ** 2 + (ny / ly) ** 2 + (nz / lz) ** 2)
                if f > f_max:
                    continue
                zeros = (nx == 0) + (ny == 0) + (nz == 0)
                kind = {2: "axial", 1: "tangential", 0: "oblique"}[zeros]
                out.append(Mode(f, kind, (nx, ny, nz)))
    out.sort(key=lambda m: m.f)
    return out


def schroeder_frequency(volume_m3: float, rt60_s: float) -> float:
    """Above this frequency the room behaves statistically; below it, individual
    modes dominate and the proportion matters. f_s = 2000 * sqrt(RT60 / V)."""
    return 2000.0 * math.sqrt(rt60_s / volume_m3)


def modal_spacing_report(lx: float, ly: float, lz: float,
                         f_max: float = 200.0) -> dict:
    """Screening metrics for a rectangular proportion.

    - `degeneracies`: pairs of modes within 5 % of one another. Coincident modes
      pile energy onto one frequency and are heard as boominess on a specific
      note.
    - `max_gap_ratio`: the largest ratio between consecutive axial modes. A
      large gap is a hole in the low-frequency response.
    """
    modes = room_modes(lx, ly, lz, f_max=f_max)
    axial = [m for m in modes if m.kind == "axial"]

    degeneracies = 0
    for i in range(len(axial) - 1):
        if axial[i].f > 0 and axial[i + 1].f / axial[i].f < 1.05:
            degeneracies += 1

    max_gap = 1.0
    gap_at = 0.0
    for i in range(len(axial) - 1):
        if axial[i].f <= 0:
            continue
        r = axial[i + 1].f / axial[i].f
        if r > max_gap:
            max_gap, gap_at = r, axial[i].f

    return {
        "f1_length": C_AIR / (2 * max(lx, ly)),
        "f1_width": C_AIR / (2 * min(lx, ly)),
        "f1_height": C_AIR / (2 * lz),
        "n_axial_below_200": len(axial),
        "degenerate_pairs": degeneracies,
        "max_axial_gap_ratio": max_gap,
        "max_gap_at_hz": gap_at,
    }


# Louden's ranked room ratios (height : width : length), best first. Widely used
# as a first-pass proportion screen for critical-listening and music rooms.
LOUDEN_BEST: Tuple[float, float, float] = (1.00, 1.40, 1.90)


def proportion_score(lx: float, ly: float, lz: float) -> Tuple[float, float, float, float]:
    """Return (w_ratio, l_ratio, deviation_from_Louden, verdict_scalar).

    Ratios are normalised to height. Deviation is the RMS difference from
    Louden's top-ranked 1 : 1.40 : 1.90.
    """
    short, long = min(lx, ly), max(lx, ly)
    w, l = short / lz, long / lz
    dev = math.sqrt(((w - LOUDEN_BEST[1]) ** 2 + (l - LOUDEN_BEST[2]) ** 2) / 2.0)
    return w, l, dev, dev


def sabine_rt60(volume_m3: float, total_absorption_m2sabin: float) -> float:
    """RT60 = 0.161 * V / A. Classic Sabine; valid for reasonably diffuse rooms
    with average absorption coefficient below about 0.3."""
    if total_absorption_m2sabin <= 0:
        return float("inf")
    return 0.161 * volume_m3 / total_absorption_m2sabin


def target_rt60_music_room(volume_m3: float) -> Tuple[float, float]:
    """Reasonable mid-frequency RT60 window for a domestic two-piano room.

    Small music/practice rooms are normally aimed at 0.35-0.55 s: long enough
    that the instrument is not deadened, short enough that two grands do not
    smear. Concert halls (1.8-2.2 s) are not the reference here.
    """
    return 0.35, 0.55
