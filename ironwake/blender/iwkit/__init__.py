"""iwkit - IRONWAKE headless Blender hard-surface toolkit.

    import sys, os; sys.path.insert(0, os.path.join(<ironwake>, 'blender'))
    import iwkit as iw
    iw.reset_scene()
    a = iw.Asset('my_part', seed=3, scheme='player')
    g = iw.prims.box((1, 1, 1), bevel=0.02)
    a.part('body_geo', g)
    a.unwrap(); a.bake(); a.export_glb('.../my_part.glb')

See docs/BLENDER_PIPELINE.md for the full API reference.
"""
from . import bake, core, decals, export, geo, materials, preview, prims, texcomp, uv  # noqa: F401
from .asset import Asset  # noqa: F401
from .core import (RNG, TIMINGS, empty, log, reset_scene, set_parent, set_props, timed,  # noqa: F401
                   tri_count, world_bbox)
from .geo import Geo, merged  # noqa: F401
from .texcomp import Weathering  # noqa: F401

# Mech node-name contract (src/mech/rig.js REQUIRED_NODES; docs/BLENDER_PIPELINE.md s2).
# Pivots use exactly these names; joints keep IDENTITY rest rotation.
MECH_NODES = ('root', 'pelvis', 'torso', 'head', 'eye',
              'arm_L', 'arm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R', 'weapon_L', 'weapon_R',
              'shoulder_L', 'shoulder_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R',
              'booster_back', 'booster_L', 'booster_R')
MECH_PARENT = {
    'pelvis': 'root', 'torso': 'pelvis', 'head': 'torso', 'eye': 'head',
    'arm_L': 'torso', 'arm_R': 'torso', 'forearm_L': 'arm_L', 'forearm_R': 'arm_R',
    'hand_L': 'forearm_L', 'hand_R': 'forearm_R', 'weapon_L': 'hand_L', 'weapon_R': 'hand_R',
    'shoulder_L': 'torso', 'shoulder_R': 'torso', 'thigh_L': 'pelvis', 'thigh_R': 'pelvis',
    'shin_L': 'thigh_L', 'shin_R': 'thigh_R', 'foot_L': 'shin_L', 'foot_R': 'shin_R',
    'booster_back': 'torso', 'booster_L': 'torso', 'booster_R': 'torso',
}
# Optional nodes: muzzle_L/R/LB/RB (fire along glTF local +Z = Blender local -Y) and any
# number of nozzle_<group>_<n> (exhaust = glTF local -Z = Blender local +Y).
