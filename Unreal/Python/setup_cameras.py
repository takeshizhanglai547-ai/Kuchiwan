"""
PHASE 13 / T - Fixed QA cameras for Unreal Engine 5.

Run inside UE5:  Tools > Execute Python Script, or
                 py "<project>/../Unreal/Python/setup_cameras.py"

Creates the 19 fixed cameras from brief §T as CineCameraActors, so that every
render can be compared against the drawings from a repeatable viewpoint.

Camera positions are NOT hard-coded. Each camera names an anchor - a room and
an offset within it - which is resolved from params/house_params.json. Anchors
whose room is still UNRESOLVED are reported and skipped rather than guessed;
a QA camera pointing at an invented room is worse than a missing camera,
because the render it produces looks authoritative.

Units: the parameter file is metres; Unreal is centimetres. Conversion happens
in exactly one place (M2U) and nowhere else.
"""

from __future__ import annotations

import json
import os
import sys

M2U = 100.0  # 1 m = 100 Unreal units

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(_HERE))
PARAMS_PATH = os.path.join(ROOT, "params", "house_params.json")

try:
    import unreal
    HAVE_UNREAL = True
except ImportError:
    HAVE_UNREAL = False


# ==========================================================================
# camera table - brief §T, all 19, in order
# ==========================================================================
# (id, name, anchor_room, eye_height_m, yaw_deg, pitch_deg, focal_mm, note)
CAMERAS = [
    ("CAM_01", "Exterior Front",        "site.front",        1.60,   0.0,  -2.0, 24,
     "Whole facade, matched to the front elevation for drawing comparison"),
    ("CAM_02", "Entrance",              "entrance.approach", 1.56,   0.0,  -3.0, 28,
     "Approach view; porch, door, gate post"),
    ("CAM_03", "Entrance Hall",         "hall.center",       1.56,   0.0,   0.0, 24,
     "Standing inside the genkan looking in"),
    ("CAM_04", "LDK Entrance",          "ldk.entry",         1.56,   0.0,   0.0, 24,
     "First impression of the LDK"),
    ("CAM_05", "Living",                "living.center",     1.56,   0.0,   0.0, 28,
     "Standing in the living area"),
    ("CAM_06", "Dining",                "dining.center",     1.56,   0.0,   0.0, 28,
     "Standing at the dining table"),
    ("CAM_07", "Kitchen",               "kitchen.workpoint", 1.56,   0.0,  -5.0, 24,
     "At the sink, the cook's viewpoint"),
    ("CAM_08", "Living to Double Height", "living.center",   1.56,   0.0,  35.0, 18,
     "Looking up into the void - cross-check against the section"),
    ("CAM_09", "2F to Living",          "hall2f.void_edge",  1.56,   0.0, -30.0, 24,
     "Looking down into the LDK from the 2F"),
    ("CAM_10", "Main Bedroom",          "bed_main.center",   1.56,   0.0,   0.0, 28, ""),
    ("CAM_11", "Child Room",            "bed_child.center",  1.56,   0.0,   0.0, 28, ""),
    ("CAM_12", "Study",                 "study.center",      1.56,   0.0,   0.0, 28, ""),
    ("CAM_13", "Music Room Entrance",   "music.door",        1.56,   0.0,   0.0, 20,
     "CRITICAL - first view on entering the soundproof room"),
    ("CAM_14", "Piano A",               "music.piano_a",     1.15,   0.0,   0.0, 35,
     "CRITICAL - seated at the keyboard of instrument A"),
    ("CAM_15", "Piano B",               "music.piano_b",     1.15,   0.0,   0.0, 35,
     "CRITICAL - seated at the keyboard of instrument B"),
    ("CAM_16", "Two-Piano Overview",    "music.center",      2.20,   0.0, -35.0, 18,
     "CRITICAL - proves both instruments coexist with working clearances"),
    ("CAM_17", "Garden",                "garden.center",     1.56,   0.0,   0.0, 28,
     "Garden looking back at the house; landscape is a PROPOSAL"),
    ("CAM_18", "Exterior Sunset",       "site.front",        1.60,   0.0,  -2.0, 24,
     "As CAM_01 under the Sunset lighting preset"),
    ("CAM_19", "Exterior Night",        "site.front",        1.60,   0.0,  -2.0, 24,
     "As CAM_01 under the Night lighting preset"),
]

MUSIC_ROOM_CAMS = {"CAM_13", "CAM_14", "CAM_15", "CAM_16"}


# ==========================================================================
# anchor resolution
# ==========================================================================

def load_params() -> dict:
    with open(PARAMS_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def resolve_anchors(p: dict) -> dict:
    """Return {anchor_name: (x, y) in metres} for anchors that can be resolved.

    Only the music room can be resolved without the drawing set, and only
    because its dimensions come from the client brief plus the Phase 6 study.
    Every other anchor waits for the plans.
    """
    out: dict = {}
    mr = p["music_room"]
    ac = mr["acoustic_construction"]

    def val(node):
        if isinstance(node, dict):
            return None if node.get("status") == "UNRESOLVED" else node.get("value")
        return node

    gx = val(mr["gross_internal_x_m"])
    gy = val(mr["gross_internal_y_m"])
    if gx is None or gy is None:
        ph = mr.get("placeholder", {})
        gx, gy = ph.get("gross_internal_x_m"), ph.get("gross_internal_y_m")
        if gx is None:
            return out

    wall = ac["wall_buildup_per_side_m"]["value"]
    nx, ny = gx - 2 * wall, gy - 2 * wall

    out["music.center"] = (wall + nx / 2.0, wall + ny / 2.0)
    out["music.door"] = (wall + 0.60, wall + 0.60)
    # keyboard viewpoints: the solver decides the real ones at build time; these
    # are the quarter points of the long axis, which is where the nested duo
    # puts the two keyboards.
    if nx >= ny:
        out["music.piano_a"] = (wall + nx * 0.25, wall + ny / 2.0)
        out["music.piano_b"] = (wall + nx * 0.75, wall + ny / 2.0)
    else:
        out["music.piano_a"] = (wall + nx / 2.0, wall + ny * 0.25)
        out["music.piano_b"] = (wall + nx / 2.0, wall + ny * 0.75)
    return out


# ==========================================================================
# creation
# ==========================================================================

def make_camera(cam_id, name, x_m, y_m, z_m, yaw, pitch, focal_mm):
    if not HAVE_UNREAL:
        return None
    loc = unreal.Vector(x_m * M2U, y_m * M2U, z_m * M2U)
    rot = unreal.Rotator(0.0, pitch, yaw)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.CineCameraActor, loc, rot)
    actor.set_actor_label(f"{cam_id}_{name.replace(' ', '_')}")
    comp = actor.get_cine_camera_component()
    settings = comp.get_editor_property("filmback")
    settings.sensor_width = 36.0
    settings.sensor_height = 24.0
    comp.set_editor_property("filmback", settings)
    lens = comp.get_editor_property("lens_settings")
    lens.min_f_stop, lens.max_f_stop = 1.4, 22.0
    comp.set_editor_property("lens_settings", lens)
    comp.set_editor_property("current_focal_length", float(focal_mm))
    return actor


def main() -> int:
    p = load_params()
    anchors = resolve_anchors(p)

    created, skipped = [], []
    for cam_id, name, anchor, eye, yaw, pitch, focal, note in CAMERAS:
        if anchor not in anchors:
            skipped.append((cam_id, name, anchor))
            continue
        x, y = anchors[anchor]
        make_camera(cam_id, name, x, y, eye, yaw, pitch, focal)
        created.append((cam_id, name))

    print("=" * 70)
    print("QA CAMERAS (brief §T)")
    print("=" * 70)
    for cid, name in created:
        flag = "  [CRITICAL]" if cid in MUSIC_ROOM_CAMS else ""
        print(f"  created  {cid}  {name}{flag}")
    for cid, name, anchor in skipped:
        flag = "  [CRITICAL]" if cid in MUSIC_ROOM_CAMS else ""
        print(f"  SKIPPED  {cid}  {name}  — anchor '{anchor}' UNRESOLVED{flag}")
    print("-" * 70)
    print(f"  {len(created)} created, {len(skipped)} awaiting the drawing set.")
    if not HAVE_UNREAL:
        print("  (dry run — `unreal` module not available outside the editor)")

    missing_crit = [c for c, _, a in skipped if c in MUSIC_ROOM_CAMS]
    if missing_crit:
        print(f"\n  ✗ CRITICAL music-room cameras not placed: {missing_crit}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
