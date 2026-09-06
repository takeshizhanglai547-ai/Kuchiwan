#!/usr/bin/env python3
"""
PHASE 3/5 - Parametric architectural builder for Blender.

Run:
    blender --background --python scripts/build_house.py -- --out Blender/house_master.blend
    blender --background --python scripts/build_house.py -- --dry-run     (no Blender needed)

Design contract
---------------
* Blender is the MASTER for architectural geometry (brief §G).
* Metric units, 1 Blender Unit = 1 metre. Enforced, not assumed.
* NOTHING is hard-coded. Every dimension is read from params/house_params.json.
* If a required value is UNRESOLVED, the builder does not invent it: it either
  refuses to build (default) or, with --placeholder, builds an explicitly
  labelled placeholder massing whose objects are named `PLACEHOLDER_*` and
  whose collection is `00_PLACEHOLDER_DO_NOT_PRESENT`.

That last rule is the whole point. A pretty model of the wrong house is the
worst outcome available to this project, so the failure mode is a hard stop,
not a plausible guess.

Naming convention (kept stable so Unreal re-import does not break):
    <LEVEL>_<CATEGORY>_<NAME>       e.g. 1F_WALL_EXT_NORTH
    MUSIC_<NAME>                    music room, always its own prefix
    PIANO_A_<PART> / PIANO_B_<PART>
Material slots are assigned by category so Unreal material overrides survive
a re-import (brief §N).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(SCRIPT_DIR, "lib"))

import geom2d as G                                   # noqa: E402
from pianos import CATALOGUE                         # noqa: E402

PARAMS_PATH = os.path.join(ROOT, "params", "house_params.json")

try:
    import bpy
    import bmesh
    HAVE_BPY = True
except ImportError:                                  # dry-run / lint outside Blender
    HAVE_BPY = False


# ==========================================================================
# parameter access with provenance enforcement
# ==========================================================================

class UnresolvedParameter(Exception):
    pass


class Params:
    """Reads params/house_params.json and refuses to hand out invented values."""

    def __init__(self, path: str = PARAMS_PATH, allow_placeholder: bool = False):
        with open(path, "r", encoding="utf-8") as fh:
            self.d = json.load(fh)
        self.allow_placeholder = allow_placeholder
        self.used_placeholders: list[str] = []
        self.unresolved_hits: list[str] = []

    def get(self, dotted: str):
        """Fetch `a.b.c`. Raises if the entry is UNRESOLVED and placeholders are
        not permitted; records the substitution if they are."""
        node = self.d
        for part in dotted.split("."):
            node = node[part]

        if not isinstance(node, dict) or "status" not in node:
            return node

        if node["status"] != "UNRESOLVED":
            return node["value"]

        self.unresolved_hits.append(dotted)
        if not self.allow_placeholder:
            raise UnresolvedParameter(
                f"{dotted} is UNRESOLVED. Required source: "
                f"{node.get('source_required', 'drawing set')}. "
                f"Supply it in params/house_params.json, or re-run with "
                f"--placeholder to build a labelled placeholder massing."
            )

        section = dotted.split(".")[0]
        leaf = dotted.split(".")[-1]
        ph = self.d.get(section, {}).get("placeholder", {})
        if leaf not in ph:
            raise UnresolvedParameter(
                f"{dotted} is UNRESOLVED and has no placeholder either. "
                f"It cannot be built at all until the drawing is supplied."
            )
        self.used_placeholders.append(dotted)
        return ph[leaf]

    def report(self) -> str:
        lines = []
        if self.unresolved_hits:
            lines.append(f"UNRESOLVED parameters touched: {len(self.unresolved_hits)}")
            for h in sorted(set(self.unresolved_hits)):
                mark = "PLACEHOLDER" if h in self.used_placeholders else "BLOCKED"
                lines.append(f"  [{mark}] {h}")
        else:
            lines.append("All parameters resolved from the drawing set.")
        return "\n".join(lines)


# ==========================================================================
# Blender helpers
# ==========================================================================

def require_bpy():
    if not HAVE_BPY:
        raise RuntimeError(
            "This step needs Blender. Run:\n"
            "  blender --background --python scripts/build_house.py -- [args]\n"
            "or use --dry-run to validate parameters without Blender."
        )


def setup_scene():
    require_bpy()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    # start clean so re-runs are deterministic
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.length_unit = "METERS"


def get_collection(name: str):
    require_bpy()
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link(obj, collection_name: str):
    require_bpy()
    col = get_collection(collection_name)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def mesh_from_polygon(name: str, poly, z_base: float, height: float,
                      collection: str):
    """Extrude a closed 2D polygon into a solid. Used for slabs and masses."""
    require_bpy()
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z_base)) for x, y in poly]
    face = bm.faces.new(verts)
    if height:
        bmesh.ops.extrude_face_region(bm, geom=[face])
        # move only the newly extruded verts
        new_verts = [v for v in bm.verts if abs(v.co.z - z_base) < 1e-9 and v.is_valid]
        bmesh.ops.translate(bm, vec=(0, 0, height),
                            verts=[v for v in bm.verts if v not in verts])
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    return link(obj, collection)


def wall_from_segment(name: str, p0, p1, thickness: float,
                      z_base: float, height: float, collection: str):
    """A straight wall centred on the segment p0->p1."""
    require_bpy()
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        raise ValueError(f"{name}: zero-length wall segment")
    nx, ny = -dy / length, dx / length
    h = thickness / 2.0
    poly = [
        (p0[0] + nx * h, p0[1] + ny * h),
        (p1[0] + nx * h, p1[1] + ny * h),
        (p1[0] - nx * h, p1[1] - ny * h),
        (p0[0] - nx * h, p0[1] - ny * h),
    ]
    return mesh_from_polygon(name, poly, z_base, height, collection)


def box(name: str, sx: float, sy: float, sz: float,
        loc, collection: str, rot_z_deg: float = 0.0):
    require_bpy()
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    obj.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return link(obj, collection)


# ==========================================================================
# music room - the CRITICAL build (brief §B/§C/§D)
# ==========================================================================

def build_music_room(P: Params, placeholder: bool):
    """Builds the soundproof music room as a LINED box, plus two grand pianos.

    The lining is modelled as real geometry, not as a note: the walls the player
    sees are the acoustic inner leaf, offset inward from the structural shell.
    That is the whole point of brief §D - the visitor in the walkthrough must
    stand in the room they will actually get, not in the room the plan shows.
    """
    COL = "06_MUSIC_ROOM"
    mr = P.d["music_room"]
    ac = mr["acoustic_construction"]

    # Raises in strict mode; substitutes the labelled probe with --placeholder.
    gx = P.get("music_room.gross_internal_x_m")
    gy = P.get("music_room.gross_internal_y_m")
    gh = P.get("music_room.gross_ceiling_h_m")
    from_drawing = mr["gross_internal_x_m"]["status"] != "UNRESOLVED"

    wall = ac["wall_buildup_per_side_m"]["value"]
    rise = ac["floating_floor_rise_m"]["value"]
    drop = ac["ceiling_drop_m"]["value"]

    nx, ny = gx - 2 * wall, gy - 2 * wall
    nh = gh - rise - drop
    pfx = "" if from_drawing else "PLACEHOLDER_"

    if not HAVE_BPY:
        return {"gross": (gx, gy, gh), "net": (nx, ny, nh),
                "from_drawing": from_drawing}

    # structural shell (reference only, thin)
    mesh_from_polygon(f"{pfx}MUSIC_SHELL_FLOOR", G.rect(gx, gy), 0.0, 0.02, COL)

    # floating floor
    mesh_from_polygon(f"{pfx}MUSIC_FLOATING_FLOOR",
                      G.rect(nx, ny, wall, wall), 0.0, rise, COL)

    # acoustic inner leaf - four walls, full height of the lined cavity
    z0, zh = rise, nh
    corners = [(wall, wall), (wall + nx, wall), (wall + nx, wall + ny), (wall, wall + ny)]
    for i, tag in enumerate(("S", "E", "N", "W")):
        p0, p1 = corners[i], corners[(i + 1) % 4]
        wall_from_segment(f"{pfx}MUSIC_ACOUSTIC_WALL_{tag}", p0, p1,
                          wall, z0, zh, COL)

    # isolated ceiling
    mesh_from_polygon(f"{pfx}MUSIC_ACOUSTIC_CEILING",
                      G.rect(nx, ny, wall, wall), rise + nh, drop, COL)

    place_pianos(P, nx, ny, rise, wall, COL, pfx)

    return {"gross": (gx, gy, gh), "net": (nx, ny, nh), "from_drawing": from_drawing}


def place_pianos(P: Params, nx: float, ny: float, floor_z: float,
                 wall_off: float, collection: str, pfx: str):
    """Two grand pianos in the nested duo layout, at catalogue dimensions.

    Placement is not eyeballed: it re-runs the same solver used for the report,
    so the model and the analysis can never disagree.
    """
    sys.path.insert(0, SCRIPT_DIR)
    from acoustic_piano_fit import Clearances, FitSolver, LAYOUTS  # noqa: E402

    mr = P.d["music_room"]
    A = CATALOGUE[mr["instruments"]["piano_A"]["model_key"]]
    B = CATALOGUE[mr["instruments"]["piano_B"]["model_key"]]
    cl = Clearances(
        wall_to_piano=mr["clearances_m"]["wall_to_piano"]["value"],
        between_pianos=mr["clearances_m"]["between_pianos"]["value"],
        player_zone_depth=mr["clearances_m"]["player_zone_depth"]["value"],
        player_zone_width=mr["clearances_m"]["player_zone_width"]["value"],
    )

    chosen = None
    for lay in LAYOUTS:
        solver = FitSolver(A, B, lay, cl)
        for room in ((nx, ny), (ny, nx)):
            p = solver.fits(room[0], room[1])
            if p:
                chosen = (lay, p, solver, room)
                break
        if chosen:
            break

    if chosen is None:
        raise RuntimeError(
            "CRITICAL: no layout places two grand pianos in the music room at "
            f"{nx:.3f} x {ny:.3f} m net. QA-CRIT-02 cannot pass. Either the room "
            "is too small, the instruments are too large, or the acoustic "
            "build-up is too thick. This is a design problem, not a bug - see "
            "docs/PIANO_FIT_REPORT.md."
        )

    lay, plc, solver, room = chosen
    swapped = room != (nx, ny)

    pa = solver.pa
    pb = G.translate(solver.pb0, plc.dx, plc.dy)
    x0, y0, _, _ = G.bbox_of_many([pa, pb, solver.za,
                                   G.translate(solver.zb0, plc.dx, plc.dy)])
    # centre the pair in the room
    bw, bh = G.bbox_size([pa, pb, solver.za,
                          G.translate(solver.zb0, plc.dx, plc.dy)])
    ox = wall_off + (nx - (bh if swapped else bw)) / 2.0 - x0
    oy = wall_off + (ny - (bw if swapped else bh)) / 2.0 - y0

    for tag, piano, rot, off in (("A", A, lay.rot_a, (0.0, 0.0)),
                                 ("B", B, lay.rot_b, (plc.dx, plc.dy))):
        build_grand_piano(piano, f"{pfx}PIANO_{tag}", rot,
                          ox + off[0], oy + off[1], floor_z, collection)

    return {"layout": lay.key, "dx": plc.dx, "dy": plc.dy,
            "piano_a": A.key, "piano_b": B.key}


def build_grand_piano(piano, name: str, rot_deg: float,
                      x: float, y: float, z: float, collection: str):
    """A dimensionally honest grand piano.

    Deliberately built from the catalogue outline rather than dropped in as a
    stock asset, so that QA can verify the case dimensions against
    scripts/lib/pianos.py. Brief §C forbids toy geometry; the parts list below
    is the minimum that satisfies QA-CRIT-03.
    """
    require_bpy()
    outline = G.place(piano.footprint(segments=48), rot_deg, x, y)

    rim_top = z + piano.height_m
    rim_bot = rim_top - piano.rim_depth_m

    # case
    mesh_from_polygon(f"{name}_CASE", outline, rim_bot, piano.rim_depth_m, collection)
    # lid, closed position - a prop-open variant is driven in Unreal
    mesh_from_polygon(f"{name}_LID", outline, rim_top, 0.02, collection)

    # keyboard: 88 keys at true playing width
    kb_w = piano.playing_width_m
    key_w = kb_w / 52.0                      # 52 white keys
    for i in range(52):
        local = (0.12, (piano.width_m - kb_w) / 2.0 + i * key_w + key_w / 2.0)
        wx, wy = G.place([local], rot_deg, x, y)[0]
        box(f"{name}_KEY_W_{i:02d}", key_w * 0.92, 0.145, 0.022,
            (wx, wy, rim_bot + 0.01), collection, rot_deg)
    # 36 black keys, in the 5-per-octave pattern
    pattern = [0, 1, 3, 4, 5]
    idx = 0
    for octave in range(-1, 8):
        for p in pattern:
            pos = octave * 7 + p + 5
            if 0 <= pos < 51:
                local = (0.06, (piano.width_m - kb_w) / 2.0 + (pos + 1) * key_w)
                wx, wy = G.place([local], rot_deg, x, y)[0]
                box(f"{name}_KEY_B_{idx:02d}", key_w * 0.55, 0.095, 0.014,
                    (wx, wy, rim_bot + 0.03), collection, rot_deg)
                idx += 1

    # three legs
    for local in ((0.28, 0.18), (0.28, piano.width_m - 0.18),
                  (piano.length_m - 0.35, piano.width_m * 0.30)):
        wx, wy = G.place([local], rot_deg, x, y)[0]
        box(f"{name}_LEG", 0.11, 0.11, rim_bot - z, (wx, wy, z + (rim_bot - z) / 2.0),
            collection, rot_deg)

    # pedal lyre + three pedals
    lx, ly = G.place([(0.34, piano.width_m / 2.0)], rot_deg, x, y)[0]
    box(f"{name}_LYRE", 0.05, 0.30, 0.42, (lx, ly, z + 0.21), collection, rot_deg)
    for i, dy in enumerate((-0.075, 0.0, 0.075)):
        px, py = G.place([(0.30, piano.width_m / 2.0 + dy)], rot_deg, x, y)[0]
        box(f"{name}_PEDAL_{i}", 0.10, 0.035, 0.012, (px, py, z + 0.09),
            collection, rot_deg)

    # music desk
    mx, my = G.place([(0.62, piano.width_m / 2.0)], rot_deg, x, y)[0]
    box(f"{name}_MUSIC_DESK", 0.03, 0.60, 0.30, (mx, my, rim_top + 0.12),
        collection, rot_deg)

    # bench, at the player position
    bx, by = G.place([(-0.55, piano.width_m / 2.0)], rot_deg, x, y)[0]
    box(f"{name}_BENCH", 0.36, 0.66, 0.06, (bx, by, z + 0.50), collection, rot_deg)
    for sx_, sy_ in ((-0.70, 0.22), (-0.70, -0.22), (-0.40, 0.22), (-0.40, -0.22)):
        lx2, ly2 = G.place([(sx_, piano.width_m / 2.0 + sy_)], rot_deg, x, y)[0]
        box(f"{name}_BENCH_LEG", 0.04, 0.04, 0.50, (lx2, ly2, z + 0.25),
            collection, rot_deg)

    # seated performer - human scale reference (brief §C)
    hx, hy = G.place([(-0.55, piano.width_m / 2.0)], rot_deg, x, y)[0]
    box(f"{name}_PERFORMER_REF", 0.34, 0.46, 0.62, (hx, hy, z + 0.87),
        collection, rot_deg)


# ==========================================================================
# placeholder massing (only with --placeholder)
# ==========================================================================

def build_placeholder_massing(P: Params):
    COL = "00_PLACEHOLDER_DO_NOT_PRESENT"
    fp = P.get("building.footprint_polygon_m")
    t = P.get("building.exterior_wall_thickness_m")
    h1 = P.get("levels.ceiling_h_1f_m")
    ff = P.get("levels.floor_to_floor_1f_m")
    h2 = P.get("levels.ceiling_h_2f_m")

    if not HAVE_BPY:
        return {"footprint": fp, "h1": h1, "h2": h2}

    mesh_from_polygon("PLACEHOLDER_1F_SLAB", fp, 0.0, 0.15, COL)
    for i in range(len(fp)):
        wall_from_segment(f"PLACEHOLDER_1F_WALL_EXT_{i}", fp[i], fp[(i + 1) % len(fp)],
                          t, 0.15, h1, COL)
    mesh_from_polygon("PLACEHOLDER_2F_SLAB", fp, ff, 0.15, COL)
    for i in range(len(fp)):
        wall_from_segment(f"PLACEHOLDER_2F_WALL_EXT_{i}", fp[i], fp[(i + 1) % len(fp)],
                          t, ff + 0.15, h2, COL)
    return {"footprint": fp, "h1": h1, "h2": h2}


# ==========================================================================
# main
# ==========================================================================

def main(argv):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "Blender", "house_master.blend"))
    ap.add_argument("--placeholder", action="store_true",
                    help="build a labelled placeholder massing where the drawing "
                         "set is missing, instead of refusing")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate parameters and report; no Blender required")
    args = ap.parse_args(argv)

    P = Params(allow_placeholder=args.placeholder)

    print("=" * 70)
    print("xevoSigma PREMIUM - Blender architectural builder")
    print("=" * 70)

    drawings = P.d["project"]["drawing_set_received"]["value"]
    print(f"Drawing set received : {drawings}")
    print(f"Mode                 : "
          f"{'PLACEHOLDER MASSING' if args.placeholder else 'STRICT (drawing-driven)'}")
    print("-" * 70)

    if args.dry_run or not HAVE_BPY:
        if not args.dry_run:
            print("NOTE: Blender not available; running as a dry run.\n")
        try:
            mrinfo = build_music_room(P, args.placeholder)
            gx, gy, gh = mrinfo["gross"]
            nx, ny, nh = mrinfo["net"]
            print("MUSIC ROOM (CRITICAL)")
            print(f"  source              : "
                  f"{'drawing' if mrinfo['from_drawing'] else 'PLACEHOLDER PROBE'}")
            print(f"  gross internal      : {gx:.3f} x {gy:.3f} x {gh:.3f} m")
            print(f"  net after lining    : {nx:.3f} x {ny:.3f} x {nh:.3f} m")
            print(f"  net floor / volume  : {nx*ny:.2f} m2 / {nx*ny*nh:.1f} m3")
            if nh < 2.10:
                print(f"  ** WARNING: finished ceiling {nh:.3f} m is below the "
                      f"2.1 m minimum in 建築基準法施行令第21条 **")
        except UnresolvedParameter as e:
            print(f"MUSIC ROOM: BLOCKED\n  {e}")
        print("-" * 70)
        print(P.report())
        return 0

    setup_scene()
    if args.placeholder:
        build_placeholder_massing(P)
    build_music_room(P, args.placeholder)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.out)
    print(f"\nSaved {args.out}")
    print(P.report())
    return 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    raise SystemExit(main(argv))
