"""iwkit.bake - Cycles CPU texture baking into the per-asset atlas.

Each pass temporarily swaps every semantic material for a pass shader (see
materials.PASS_SHADERS), bakes all asset meshes into ONE float image and returns it
as a numpy array (H, W, 4), row 0 = bottom (Blender order).

Passes (defaults):
  albedo   EMIT  4 spp   paint colour + hazard/heat patterns + variation + decals
  matid    EMIT  1 spp   palette index -> every per-material constant (metal, rough,
                         wear, grime, rust, dust, emission) is looked up in numpy
  (legacy passes 'params', 'params2', 'emit' still exist and are used if baked)
  noise    EMIT  2 spp   R grime fbm, G vertical streaks, B chip noise (3D, seamless)
  wnormal  EMIT  1 spp   world-space normal (for dust / streak direction)
  wpos     EMIT  1 spp   world position normalised to the asset bounds (macro gradients)
  masks    EMIT  N spp   R convexity (edges), G cavity, B thinness
  ao       EMIT  N spp   ambient occlusion (large radius)
  normal   NORMAL N spp  tangent-space normal with Bevel-node micro bevels
"""
import hashlib
import os

import bpy
import numpy as np

from . import materials as M
from .core import log, quiet, select_only, timed

DEFAULT_PASSES = ('albedo', 'matid', 'noise', 'wnormal', 'wpos', 'masks', 'ao', 'normal')

PASS_SAMPLES = {'albedo': 4, 'matid': 1, 'params': 1, 'params2': 1, 'emit': 2, 'noise': 1, 'wnormal': 1, 'wpos': 1,
                'masks': 6, 'ao': 4, 'normal': 6}


def _image(name, res, non_color=True):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, res, res, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    return img


def to_numpy(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def bake_pass(asset, pass_name, res, samples=None, margin_px=None, shader_kw=None):
    """Bake one pass for every mesh of `asset`. Returns np.ndarray (H, W, 4) float32."""
    sc = bpy.context.scene
    objs = asset.bake_objects()
    samples = samples or PASS_SAMPLES.get(pass_name, 4)
    margin_px = margin_px if margin_px is not None else max(4, res // 128)
    img = _image(f'__bake_{pass_name}', res)
    builder = M.PASS_SHADERS[pass_name]
    kw = dict(shader_kw or {})
    # per-pass materials, one per semantic preset (same slot order as the palette)
    pass_mats = []
    for i, pm in enumerate(asset.palette):
        preset = asset.presets.get(pm.name, M.PRESETS['paint_primary'])
        mat = bpy.data.materials.new(f'__{pass_name}_{pm.name}')
        extra = {'index': i} if pass_name == 'matid' else {}
        builder(mat, preset, img, asset.seed, asset.decal_specs(), **kw, **extra)
        pass_mats.append(mat)
    saved = {}
    for o in objs:
        saved[o.name] = [s.material for s in o.material_slots]
        for i in range(len(o.material_slots)):
            o.material_slots[i].material = pass_mats[i] if i < len(pass_mats) else pass_mats[0]
    # hide everything that is not being baked (preview floor, lights, colliders...)
    hidden = []
    for o in bpy.context.scene.objects:
        if o not in objs and not o.hide_render and o.type in ('MESH', 'CURVE', 'SURFACE', 'FONT'):
            o.hide_render = True
            hidden.append(o)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 2 if pass_name == 'normal' else 0
    bk = sc.render.bake
    bk.margin = margin_px
    bk.margin_type = 'EXTEND'
    bk.use_clear = True
    bk.target = 'IMAGE_TEXTURES'
    bk.use_selected_to_active = False
    if pass_name == 'normal':
        bk.normal_space = 'TANGENT'
        bk.normal_r, bk.normal_g, bk.normal_b = 'POS_X', 'POS_Y', 'POS_Z'
    select_only(objs)
    with timed(f'bake.{pass_name}'):
        with quiet():
            bpy.ops.object.bake(type='NORMAL' if pass_name == 'normal' else 'EMIT',
                                margin=margin_px, use_clear=True)
    arr = to_numpy(img)
    # restore
    for o in objs:
        for i, m in enumerate(saved[o.name]):
            o.material_slots[i].material = m
    for o in hidden:
        o.hide_render = False
    for m in pass_mats:
        bpy.data.materials.remove(m)
    bpy.data.images.remove(img)
    return arr


def bake_all(asset, res, passes=DEFAULT_PASSES, samples=None, shader_kw=None, cache_dir=None):
    """Bake the requested passes; returns {pass: array}. With cache_dir, raw float
    passes are stored as .npy so compositing can be re-tuned without re-baking."""
    out = {}
    for p in passes:
        kw_key = hashlib.md5(repr(sorted((shader_kw or {}).get(p, {}).items())).encode()).hexdigest()[:8]
        path = os.path.join(cache_dir, f'{p}_{res}_{kw_key}.npy') if cache_dir else None
        if path and os.path.exists(path) and os.environ.get('IWKIT_REUSE_BAKES') == '1':
            out[p] = np.load(path)
            log(f'bake.{p}: reused cache')
            continue
        kw = (shader_kw or {}).get(p, {})
        out[p] = bake_pass(asset, p, res, samples=(samples or {}).get(p), shader_kw=kw)
        if path:
            np.save(path, out[p])
    return out
