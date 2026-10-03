"""blender/arena/akit.py - arena assembly framework on top of iwkit.

Coordinates: layout code works in GAME coordinates (x, y-up, z) = three.js world. Blender
coordinates are (x, -z, y); G(x, y, z) converts. Yaw follows the engine: forward =
(sin yaw, 0, cos yaw) and equals a rotation about Blender +Z.

Materials: faces carry semantic names '<base>:<variant>' (e.g. 'steel:yellow', 'trim:hazard',
'glow:sodium'). finalize() turns them into ONE Blender material per base ('M_<base>', the
runtime maps them in src/world/materials.js) plus a per-corner colour attribute:
    COLOR_0 = (tint r, g, b [linear], a = variant parameter: wear / opacity / intensity)
and UVs for the UV-mapped bases (trim rows, decal cells, slag flow). Tiling bases (concrete,
steel, corr, heap, ground) are triplanar/world-mapped at runtime and need no UVs.

Kit pieces are built once (hidden template objects) and placed as linked duplicates
(instances); gltfpack turns repeats into EXT_mesh_gpu_instancing. Colliders are COL_ empties
(world scale = half extents), markers are SPAWN_/OBJ_ empties.
"""
import json
import math
import os
import shutil
import struct
import subprocess
import sys

import bpy  # noqa: I001  (bpy must be imported before bmesh)
import bmesh
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.abspath(os.path.join(HERE, '..'))
ROOT = os.path.abspath(os.path.join(BLENDER_DIR, '..'))
if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)

import iwkit as iw  # noqa: E402
from iwkit import prims as P  # noqa: E402,F401
from iwkit.geo import Geo  # noqa: E402

TAU = math.tau


def G(x, y=0.0, z=0.0):
    """Game (three.js) coordinates -> Blender."""
    return Vector((x, -z, y))


def srgb_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ------------------------------------------------------------------------------ material table
BASES = ['concrete', 'steel', 'corr', 'heap', 'ground', 'trim', 'decal', 'glow', 'slag', 'sea', 'belt', 'far']
PREVIEW = {'concrete': '#8a857c', 'steel': '#6f5040', 'corr': '#6c6a64', 'heap': '#504a44', 'ground': '#7d7870',
           'trim': '#b09030', 'decal': '#d8a31a', 'glow': '#ffb347', 'slag': '#ff7a1a', 'sea': '#1e2a2e',
           'belt': '#222222', 'far': '#6e6660'}

# variant -> (sRGB tint, alpha param). alpha: steel/corr = wear (0 clean .. 1 all rust),
# concrete = stain amount, decal = opacity, glow = intensity/16.
VARIANTS = {
    'concrete': {'': ('#f2f0ec', 0.45), 'dark': ('#a9a59e', 0.55), 'warm': ('#fff2de', 0.35), 'soot': ('#7a7672', 0.85),
                 'pale': ('#ffffff', 0.25), 'grey': ('#d8d8d4', 0.45),
                 'shell': ('#e6e4de', 0.97)},
    'steel': {'': ('#566064', 0.35), 'grey': ('#566064', 0.35), 'dark': ('#34383a', 0.3), 'yellow': ('#c28c1e', 0.24),
              'oxide': ('#6c3528', 0.4), 'bone': ('#948d7c', 0.34), 'green': ('#4b5a4f', 0.4), 'blue': ('#3d5563', 0.4),
              'rust': ('#6f7271', 1.0), 'galv': ('#8e9296', 0.12), 'crane': ('#9a7a44', 0.36), 'railing': ('#86692f', 0.42), 'black': ('#1f2020', 0.15), 'white': ('#c9c5bb', 0.3),
              'orange': ('#b8561e', 0.35), 'red': ('#7a2a22', 0.4), 'slate': ('#3c4549', 0.3), 'rail': ('#5a5550', 0.85), 'clean': ('#6f7271', 0.08)},
    'corr': {'': ('#72797b', 0.35), 'grey': ('#72797b', 0.35), 'blue': ('#4d6470', 0.4), 'oxide': ('#6e3a2c', 0.45),
             'cream': ('#b5ab94', 0.4), 'green': ('#58685b', 0.45), 'rust': ('#8a8c88', 1.0), 'dark': ('#40423f', 0.35),
             'c_red': ('#7c3024', 0.3), 'c_blue': ('#2f4b5e', 0.3), 'c_green': ('#3f5a45', 0.3), 'c_grey': ('#7a7c78', 0.3),
             'c_cream': ('#b2a78d', 0.3), 'c_orange': ('#a4542a', 0.3)},
    'heap': {'': ('#ffffff', 0.0), 'ore': ('#a8785e', 0.0), 'slag': ('#7a7672', 0.0), 'coal': ('#5a5856', 0.0),
             'dark': ('#8c8c8a', 0.0), 'dust': ('#c9c6c0', 0.0)},
    'ground': {'': ('#ffffff', 0.0)},
    # far: alpha = surface class for materials.js SURF.far (0 concrete, 0.3 plated steel,
    # 0.6 slip-formed shell, 0.9 plain: lattice members, pipes, soot)
    'far': {'': ('#ffffff', 0.0), 'dark': ('#9a9a9a', 0.0), 'rust': ('#c09080', 0.3), 'steel': ('#8c8a86', 0.3),
            'sdark': ('#666462', 0.3), 'shell': ('#f2eee8', 0.6), 'red': ('#c0604c', 0.6), 'white': ('#ffffff', 0.6),
            'frame': ('#8a8784', 0.9), 'fdark': ('#5c5a58', 0.9), 'soot': ('#3c3a38', 0.9), 'pale': ('#d6d2ca', 0.0),
            'oxide': ('#b07a62', 0.3)},
    'trim': {},
    'decal': {'yellow': ('#c8961c', 0.8), 'white': ('#aca69a', 0.72), 'black': ('#1a1a1a', 0.7), 'stain': ('#2a2622', 0.55),
              'rust': ('#6b3a22', 0.5), 'soot': ('#141210', 0.75), 'red': ('#a8321f', 0.75)},
    'glow': {'sodium': ('#ffb347', 0.35), 'red': ('#ff3b2f', 0.6), 'furnace': ('#ff7a1a', 0.7), 'white': ('#ffe8c8', 0.4),
             'window': ('#ff9d4a', 0.12), 'hot': ('#ffb060', 1.0), 'dim': ('#ff8a3a', 0.08), 'cyan': ('#8ff0ff', 0.4),
             'ember': ('#ff5a14', 0.22), 'haze': ('#ff7a2a', 0.035)},
    'slag': {'': ('#ffffff', 1.0), 'crust': ('#ffffff', 0.35)},
    'sea': {'': ('#ffffff', 0.0)},
    'belt': {'': ('#ffffff', 0.0), 'ore': ('#b07a60', 1.0)},
}

# trim rows (v0, v1) in UV space (bottom = 0) - must match textures.TRIM_ROWS / materials.js
TRIM_ROWS = {
    'hazard': (1 - 128 / 1024, 1.0), 'hazard2': (1 - 256 / 1024, 1 - 128 / 1024),
    'window': (1 - 512 / 1024, 1 - 256 / 1024), 'louvre': (1 - 640 / 1024, 1 - 512 / 1024),
    'grating': (1 - 768 / 1024, 1 - 640 / 1024), 'stencil': (1 - 896 / 1024, 1 - 768 / 1024),
    'bolted': (0.0, 1 - 896 / 1024),
}
# u repeats per metre = 1 / (k * band height): keeps stripes at 45 deg, bays square, etc.
TRIM_K = {'hazard': 8.0, 'hazard2': 8.0, 'window': 4.0, 'louvre': 8.0, 'grating': 8.0, 'bolted': 8.0}
DECAL_CELLS = {   # must match textures.DECAL_CELLS (1024 x 2048 atlas, v = 0 at the bottom)
    'num07': (0.0, 0.75, 0.5, 1.0), 'ring': (0.5, 0.75, 1.0, 1.0), 'arrow': (0.0, 0.625, 0.25, 0.75),
    'hatch': (0.25, 0.625, 0.5, 0.75), 'line': (0.5, 0.625, 0.625, 0.75), 'dash': (0.625, 0.625, 0.75, 0.75),
    'p7': (0.75, 0.625, 1.0, 0.75), 'noentry': (0.0, 0.5, 0.5, 0.625), 'stain': (0.5, 0.5, 0.75, 0.625),
    'scorch': (0.75, 0.5, 1.0, 0.625),
    'streak': (0.0, 0.0, 0.25, 0.5), 'curtain': (0.25, 0.0, 0.5, 0.5), 'tracks': (0.5, 0.0, 0.75, 0.5),
    'd1': (0.75, 0.375, 1.0, 0.5), 'd2': (0.75, 0.25, 1.0, 0.375), 'd3': (0.75, 0.125, 1.0, 0.25), 'd4': (0.75, 0.0, 1.0, 0.125),
}
# stencil sub-rects (u0, u1, line) of the stencil strip: line 0 = top half, 1 = bottom half
STENCILS = {'pier07': (0.0, 0.2, 0), 'jp_pier': (0.215, 0.405, 0), 'max40': (0.41, 0.61, 0), 'jp_load': (0.615, 0.8, 0),
            'hdf07': (0.81, 0.99, 0), 'halvard': (0.0, 0.47, 1), 'jp_hot': (0.48, 0.67, 1), 'grauwerk': (0.68, 0.93, 1)}

_MATS = {}


def material(base):
    m = _MATS.get(base)
    if m is None:
        m = bpy.data.materials.new('M_' + base)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        c = srgb_lin(PREVIEW[base])
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*c, 1.0)
            bsdf.inputs['Roughness'].default_value = 0.8
        m.diffuse_color = (*c, 1.0)
        _MATS[base] = m
    return m


def resolve(sem):
    """semantic name -> (base, rgba tint, uv rule or None)."""
    if ':' in sem:
        base, var = sem.split(':', 1)
    else:
        base, var = sem, ''
    if base not in BASES:
        # iwkit prim defaults -> sensible arena materials
        base, var = {'steel': ('steel', 'grey'), 'steel_dark': ('steel', 'dark'), 'hazard': ('steel', 'yellow'),
                     'paint_secondary': ('steel', 'grey'), 'paint_primary': ('steel', 'grey'), 'rubber': ('steel', 'black'),
                     'chrome': ('steel', 'galv'), 'rust': ('steel', 'rust'), 'galvanized': ('steel', 'galv'),
                     'paint_dark': ('steel', 'dark'), 'paint_accent': ('steel', 'orange'), 'glow': ('glow', 'sodium'),
                     'lens': ('glow', 'sodium')}.get(base, ('steel', 'grey'))
    rule = None
    if base == 'trim':
        lit = var.endswith('_lit') or '_lit@' in var
        rule = ('trim', var.replace('_lit', ''))
        return base, (1.0, 1.0, 1.0, 0.5 if lit else 1.0), rule
    if base == 'decal':
        cell, _, col = var.partition('/')
        tint, a = VARIANTS['decal'].get(col or 'white', ('#ffffff', 0.8))
        return base, (*srgb_lin(tint), a), ('decal', cell)
    if base in ('slag', 'belt'):
        rule = ('flow', var)
    if base == 'glow' and var.endswith('_grad'):
        tint, a = VARIANTS['glow'].get(var[:-5], ('#ffffff', 0.1))
        return base, (*srgb_lin(tint), a), ('grad', None)
    tab = VARIANTS[base]
    tint, a = tab.get(var, tab.get('', ('#ffffff', 0.0)))
    return base, (*srgb_lin(tint), a), rule


# ------------------------------------------------------------------------------ UV rules
def _face_axes(f, first_edge=False):
    n = f.normal.normalized()
    if first_edge or abs(n.z) > 0.85:
        e = (f.loops[0].link_loop_next.vert.co - f.loops[0].vert.co)
        if not first_edge:  # horizontal face: longest edge = u
            best = None
            for lp in f.loops:
                d = lp.link_loop_next.vert.co - lp.vert.co
                if best is None or d.length > best.length:
                    best = d
            e = best
        u = (e - n * e.dot(n)).normalized()
        v = n.cross(u).normalized()
        return u, v
    up = Vector((0, 0, 1))
    v = (up - n * up.dot(n)).normalized()
    u = v.cross(n).normalized()
    return u, v


def apply_uv(f, uvl, rule):
    kind, var = rule
    if kind == 'trim':
        name, _, sub = var.partition('@')
        if name.startswith('stencil'):
            key = sub or 'pier07'
            u0, u1, line = STENCILS.get(key, STENCILS['pier07'])
            v0, v1 = TRIM_ROWS['stencil']
            vm = (v0 + v1) / 2
            v0, v1 = (vm, v1) if line == 0 else (v0, vm)
            _fit(f, uvl, (u0, v0, u1, v1), first_edge=False)
            return
        v0, v1 = TRIM_ROWS.get(name, TRIM_ROWS['hazard'])
        u, v = _face_axes(f)
        ps = [lp.vert.co for lp in f.loops]
        vs = [p.dot(v) for p in ps]
        lo, hi = min(vs), max(vs)
        h = max(hi - lo, 1e-3)
        k = TRIM_K.get(name, 8.0)
        for lp in f.loops:
            p = lp.vert.co
            lp[uvl].uv = (p.dot(u) / (k * h), v0 + (v1 - v0) * (p.dot(v) - lo) / h * 0.96 + (v1 - v0) * 0.02)
    elif kind == 'decal':
        rect = DECAL_CELLS.get(var, DECAL_CELLS['stain'])
        _fit(f, uvl, rect, first_edge=True)
    elif kind == 'flow':
        u, v = _face_axes(f, first_edge=True)
        ps = [lp.vert.co for lp in f.loops]
        vs = [p.dot(v) for p in ps]
        lo, hi = min(vs), max(vs)
        for lp in f.loops:
            p = lp.vert.co
            lp[uvl].uv = (p.dot(u) / 4.0, (p.dot(v) - lo) / max(hi - lo, 1e-3))


def _fit(f, uvl, rect, first_edge):
    u0, v0, u1, v1 = rect
    u, v = _face_axes(f, first_edge=first_edge)
    ps = [lp.vert.co for lp in f.loops]
    us = [p.dot(u) for p in ps]
    vs = [p.dot(v) for p in ps]
    ul, uh, vl, vh = min(us), max(us), min(vs), max(vs)
    for lp in f.loops:
        p = lp.vert.co
        lp[uvl].uv = (u0 + (u1 - u0) * (p.dot(u) - ul) / max(uh - ul, 1e-4),
                      v0 + (v1 - v0) * (p.dot(v) - vl) / max(vh - vl, 1e-4))


# ------------------------------------------------------------------------------ finalize
KIT_COL = None
OUT_COL = None
KIT = {}          # name -> {'mesh': bpy mesh, 'cols': [(center, size)], 'tris': n}
STATS = {'inst': 0, 'tris': 0, 'cols': 0}


def init():
    global KIT_COL, OUT_COL
    iw.reset_scene()
    KIT_COL = iw.core.collection('kit')
    OUT_COL = iw.core.collection('arena_out')
    KIT_COL.hide_render = True


CULL = {'faces': 0, 'killed': 0}


def cull_hidden(geo, grounds=(0.0,), sea=None, eps=0.03):
    """Delete faces nobody can see (fast, numpy): faces whose sample points (centre, near-corner,
    mid and edge-midpoint samples, pushed eps along the normal) all lie inside BOX-LIKE islands
    of the same Geo (abutting / embedded kit boxes: pilasters on walls, plates on plinths, frames
    on cladding), down-facing faces lying on a ground level, and (world-space uniques) faces
    entirely under the sea. Box-like = closed island whose volume is >= 92 % of its AABB
    (cylinders, lathes, rotated beams never occlude); the AABB is shrunk by the bevel margin so
    chamfers stay safe."""
    import numpy as np
    bm = geo.bm
    bm.faces.ensure_lookup_table()
    nf = len(bm.faces)
    if nf < 8:
        return 0
    isl = geo.islands()
    owner = np.zeros(nf, np.int32)
    occ = []      # (island id, lo, hi)
    for k, fl in enumerate(isl):
        owner[fl] = k
        if len(fl) < 6:
            continue
        vs = {v.index: v.co for i in fl for v in bm.faces[i].verts}
        P_ = np.array([tuple(c) for c in vs.values()], np.float64)
        lo, hi = P_.min(0), P_.max(0)
        ext = hi - lo
        if ext.min() < 0.04:
            continue
        vol = 0.0
        for i in fl:
            f = bm.faces[i]
            c0 = f.verts[0].co
            for j in range(1, len(f.verts) - 1):
                vol += c0.dot(f.verts[j].co.cross(f.verts[j + 1].co)) / 6.0
        if abs(vol) < 0.92 * float(ext.prod()):
            continue
        m = 0.012 if len(fl) <= 6 else min(0.16, 0.3 * float(ext.min()))
        occ.append((k, lo + m, hi - m))
    rows, fid = [], []
    nrm = np.zeros((nf, 3), np.float64)
    zmax = np.zeros(nf)
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        vv = [v.co for v in f.verts]
        pick = vv if len(vv) <= 8 else [vv[(i * len(vv)) // 8] for i in range(8)]
        q = [c] + [v.lerp(c, 0.2) for v in pick] + [v.lerp(c, 0.6) for v in pick]
        if len(vv) == 4:
            q += [vv[i].lerp(vv[(i + 1) % 4], 0.5).lerp(c, 0.2) for i in range(4)]
        for x in q:
            rows.append(tuple(x + n * eps))
            fid.append(f.index)
        nrm[f.index] = tuple(n)
        zmax[f.index] = max(v.z for v in vv)
    kill = np.zeros(nf, bool)
    if occ:
        Pt = np.array(rows, np.float64)
        fid = np.array(fid, np.int64)
        own = owner[fid]
        covered = np.zeros(len(Pt), bool)
        for (k, lo, hi) in occ:
            ins = (Pt[:, 0] > lo[0]) & (Pt[:, 0] < hi[0]) & (Pt[:, 1] > lo[1]) & (Pt[:, 1] < hi[1]) & (Pt[:, 2] > lo[2]) & (Pt[:, 2] < hi[2])
            covered |= ins & (own != k)
        notcov = np.zeros(nf, bool)
        np.logical_or.at(notcov, fid, ~covered)
        kill |= ~notcov
    for gz in grounds:
        kill |= (nrm[:, 2] < -0.98) & (np.abs(zmax - gz) < 0.03)
    if sea is not None:
        kill |= zmax < sea - 1.6
    CULL['faces'] += nf
    CULL['killed'] += int(kill.sum())
    if kill.any():
        dead = [bm.faces[i] for i in np.nonzero(kill)[0]]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.normal_update()
    return int(kill.sum())


def finalize(geo, name, sharp_angle=40.0, weighted=True, cull=None):
    """Geo (Blender coords, semantic mats) -> bpy Mesh with M_<base> slots, COLOR_0, UVs."""
    bm = geo.bm
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=list(bm.edges))
    bm.normal_update()
    if cull is not None:
        cull_hidden(geo, **cull)
    info = [resolve(s) for s in geo.mats] or [resolve('steel')]
    need_uv = any(r[2] and r[2][0] != 'grad' for r in info)
    col = bm.loops.layers.float_color.new('Col')
    uvl = bm.loops.layers.uv.new('UVMap') if need_uv else None
    bases = []
    a = math.radians(sharp_angle)
    for f in bm.faces:
        base, tint, rule = info[f.material_index] if f.material_index < len(info) else info[0]
        if base not in bases:
            bases.append(base)
        f.material_index = bases.index(base)
        f.smooth = True
        if rule and rule[0] == 'grad':      # emissive fading upward within the face (door glow, haze)
            zs = [lp.vert.co.z for lp in f.loops]
            z0, z1 = min(zs), max(zs)
            for lp in f.loops:
                t = (lp.vert.co.z - z0) / max(z1 - z0, 1e-4)
                lp[col] = (tint[0], tint[1], tint[2], tint[3] * (1.0 - t) ** 1.6)
            continue
        for lp in f.loops:
            lp[col] = tint
        if rule and uvl is not None:
            apply_uv(f, uvl, rule)
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > a:
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    geo.free()
    for b in bases:
        me.materials.append(material(b))
    ca = me.color_attributes.get('Col')
    if ca is not None:
        me.color_attributes.active_color = ca
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
    ob = bpy.data.objects.new(name, me)
    KIT_COL.objects.link(ob)
    if weighted and len(me.polygons) < 60000:
        mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        mod.mode = 'FACE_AREA'
        mod.weight = 50
        mod.keep_sharp = True
        mod.thresh = 0.01
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def kit(name, geo, cols=(), **kw):
    """Register a kit piece. geo in Blender coords around its local origin; cols: list of
    (center, size) boxes in the same local Blender coords."""
    kw.setdefault('cull', {'grounds': (0.0,)})
    ob = finalize(geo, 'K_' + name, **kw)
    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    KIT[name] = {'mesh': ob.data, 'cols': list(cols), 'tris': ntri, 'n': 0}
    return KIT[name]


def xform(pos, yaw=0.0, pitch=0.0, roll=0.0, scale=1.0):
    """Matrix placing a kit piece: game position, yaw about up, pitch about local X
    (positive raises the local forward/-Y end), roll about local Y."""
    s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    return (Matrix.Translation(G(*pos)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'X') @
            Matrix.Rotation(roll, 4, 'Y') @ Matrix.Diagonal((s[0], s[1], s[2], 1.0)))


def inst(name, pos=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, scale=1.0, M=None, collide=True):
    k = KIT[name]
    M = M if M is not None else xform(pos, yaw, pitch, roll, scale)
    k['n'] += 1
    STATS['inst'] += 1
    STATS['tris'] += k['tris']
    ob = bpy.data.objects.new(f'i{STATS["inst"]}', k['mesh'])
    OUT_COL.objects.link(ob)
    ob.matrix_world = M
    if collide:
        for col in k['cols']:
            c, sz = col[0], col[1]
            R = Matrix.Rotation(col[2], 4, 'Z') if len(col) > 2 else Matrix.Identity(4)
            collider_m(M @ Matrix.Translation(Vector(c)) @ R @ Matrix.Diagonal((sz[0] / 2, sz[1] / 2, sz[2] / 2, 1.0)))
    return ob


def unique(name, geo, cols=(), noshadow=False, **kw):
    """One-off geometry already in world (Blender) coordinates."""
    kw.setdefault('cull', {'grounds': (0.0, -9.0), 'sea': -14.0})
    ob = finalize(geo, 'U_' + name, **kw)
    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    KIT_COL.objects.unlink(ob)
    OUT_COL.objects.link(ob)
    ob.name = f'u{STATS["inst"]}_{name}'
    STATS['inst'] += 1
    STATS['tris'] += ntri
    if noshadow:
        ob['iw_noshadow'] = 1
    for (c, sz) in cols:
        collider(c, sz)
    return ob


def collider_m(M):
    STATS['cols'] += 1
    e = bpy.data.objects.new(f'COL_{STATS["cols"]}', None)
    e.empty_display_type = 'CUBE'
    OUT_COL.objects.link(e)
    e.matrix_world = M
    return e


def collider(center, size, yaw=0.0, pitch=0.0, game=True):
    """World collider box. center/size in GAME coords (size = full extents x, y(up), z)."""
    if game:
        c = G(*center)
        sz = (size[0], size[2], size[1])
    else:
        c, sz = Vector(center), size
    M = Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'X') @ \
        Matrix.Diagonal((sz[0] / 2, sz[1] / 2, sz[2] / 2, 1.0))
    return collider_m(M)


def marker(name, pos, yaw=0.0):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'SINGLE_ARROW'
    OUT_COL.objects.link(e)
    e.matrix_world = Matrix.Translation(G(*pos)) @ Matrix.Rotation(yaw, 4, 'Z')
    return e


# ------------------------------------------------------------------------------ export
GLTFPACK = os.path.join(BLENDER_DIR, 'tools', 'node_modules', 'gltfpack', 'cli.js')
KEEP = ('COL_', 'SPAWN_', 'OBJ_', 'FX_')
FOOTPRINTS = []   # [x, z, half x, half z, yaw, base y] (game coords) of out-of-bounds structures (runtime terrain)


def compute_footprints(skip=(), inner=258.0, min_size=5.0, min_y=-12.5):
    """World AABB footprints of every placed object outside the pier deck that stands on land
    (base above min_y); src/world/terrain.js flattens the outer terrain under them and lays a
    concrete apron + soot band around each one."""
    import numpy as np
    out = []
    for ob in OUT_COL.objects:
        if ob.type != 'MESH' or any(s in ob.name for s in skip):
            continue
        mw = ob.matrix_world
        bb = np.array([tuple(mw @ Vector(c)) for c in ob.bound_box])
        lo = bb.min(0)
        loc_lo = np.array([min(c[i] for c in ob.bound_box) for i in range(3)])
        loc_hi = np.array([max(c[i] for c in ob.bound_box) for i in range(3)])
        _, rot, sca = mw.decompose()
        cw = mw @ Vector(tuple((loc_lo + loc_hi) / 2))
        cx, cz = cw.x, -cw.y
        if max(abs(cx), abs(cz)) < inner or lo[2] < min_y:
            continue
        hx = abs(sca.x) * (loc_hi[0] - loc_lo[0]) / 2
        hz = abs(sca.y) * (loc_hi[1] - loc_lo[1]) / 2
        if max(hx, hz) * 2 < min_size:
            continue
        yaw = rot.to_euler('XYZ').z
        out.append([float(cx), float(cz), float(hx), float(hz), float(yaw), float(lo[2])])
    FOOTPRINTS[:] = out
    return out


def _read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    clen, _ = struct.unpack_from('<II', data, 12)
    js = json.loads(data[20:20 + clen].decode('utf-8'))
    rest = data[20 + clen:]
    return js, rest


def _write_glb(path, js, rest):
    j = json.dumps(js, separators=(',', ':')).encode('utf-8')
    j += b' ' * ((4 - len(j) % 4) % 4)
    total = 12 + 8 + len(j) + len(rest)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A))
        f.write(j)
        f.write(rest)


def _round_nodes(path):
    """Shrink the packed GLB's JSON: node transforms / extras printed with 9 significant digits
    (0.800000012) -> 0.1 mm / 1e-6 precision. Binary chunk untouched."""
    js, rest = _read_glb(path)
    before = len(json.dumps(js, separators=(',', ':')))

    def rd(v, nd):
        if isinstance(v, float):
            r = round(v, nd)
            return int(r) if r == int(r) and abs(r) < 1e9 else r
        if isinstance(v, list):
            return [rd(x, nd) for x in v]
        if isinstance(v, dict):
            return {k: rd(x, nd) for k, x in v.items()}
        return v
    # accessors: drop default byteOffset 0, bounds rounded OUTWARD to 1 mm (still valid bounds);
    # min/max are only required on POSITION accessors -> dropped elsewhere (r4)
    pos_acc = {p['attributes']['POSITION'] for m in js.get('meshes', []) for p in m.get('primitives', []) if 'POSITION' in p.get('attributes', {})}
    for i, acc in enumerate(js.get('accessors', [])):
        if i not in pos_acc:
            acc.pop('min', None)
            acc.pop('max', None)
    for acc in js.get('accessors', []):
        if acc.get('byteOffset', None) == 0:
            acc.pop('byteOffset')
        if 'min' in acc and acc.get('componentType') == 5126:
            acc['min'] = [int(v) if math.floor(v * 1000) / 1000 == int(v) else math.floor(v * 1000) / 1000 for v in acc['min']]
            acc['max'] = [int(v) if math.ceil(v * 1000) / 1000 == int(v) else math.ceil(v * 1000) / 1000 for v in acc['max']]
    for n in js.get('nodes', []):
        for k, nd in (('translation', 4), ('scale', 5), ('rotation', 6), ('extras', 4)):
            if k in n:
                n[k] = rd(n[k], nd)
        if n.get('rotation') == [0, 0, 0, 1]:
            n.pop('rotation')
        if n.get('scale') == [1, 1, 1]:
            n.pop('scale')
    for sc in js.get('scenes', []):     # marker table: positions 1 mm, quaternions / scales 1e-5
        iw = sc.get('extras', {}).get('iw')
        if iw:
            iw['col'] = [rd(c[:3], 3) + rd(c[3:7], 5) + rd(c[7:], 3) for c in iw['col']]
            iw['mark'] = [[m[0]] + rd(m[1:4], 3) + rd(m[4:], 5) for m in iw['mark']]
            iw['fx'] = [[f[0]] + rd(f[1:4], 2) + [rd(f[4], 3)] for f in iw['fx']]
            iw['foot'] = [rd(f[:4], 1) + [rd(f[4], 3), rd(f[5], 1)] for f in iw['foot']]
    _write_glb(path, js, rest)
    print(f'[arena] JSON {before / 1024:.0f} -> {len(json.dumps(js, separators=(",", ":"))) / 1024:.0f} KiB')


def export(path, pack=True):
    """Positions stay FLOAT (-vpf): gltfpack's integer quantization shares ONE grid across the whole
    scene (7 km sea -> 10.7 cm steps), which collapsed thin parts and made overlays z-fight."""
    objs = list(OUT_COL.objects)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    raw = path[:-4] + '.raw.glb'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=raw, export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
              export_apply=False, export_tangents=False, export_normals=True, export_texcoords=True,
              export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False,
              export_skins=False, export_morph=False, check_existing=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    js, rest = _read_glb(raw)
    stripped = 0
    # r4: the named markers (COL_ / SPAWN_ / OBJ_ / FX_ empties) move into ONE compact table in the
    # scene extras ('iw', read by src/world/arena.js). With no named nodes left, gltfpack can drop
    # -kn and emit EXT_mesh_gpu_instancing: ~2.5k mesh nodes collapse into ~200 instanced meshes
    # (JSON ~390 -> ~200 KiB). Root-level nodes only, so node TRS = world TRS.
    meta = {'col': [], 'mark': [], 'fx': [], 'foot': FOOTPRINTS}
    keep_nodes = set()
    for i, n in enumerate(js.get('nodes', [])):
        nm = n.get('name', '')
        if not nm.startswith(KEEP):
            n.pop('name', None)
            stripped += 1
            continue
        keep_nodes.add(i)
        t = n.get('translation', [0, 0, 0])
        q = n.get('rotation', [0, 0, 0, 1])
        s = n.get('scale', [1, 1, 1])
        if nm.startswith('COL_'):
            meta['col'].append(list(t) + list(q) + list(s))
        elif nm.startswith('FX_'):
            meta['fx'].append([nm] + list(t) + [n.get('extras', {})])
        else:
            meta['mark'].append([nm] + list(t) + list(q))
    for sc in js.get('scenes', []):
        sc['nodes'] = [k for k in sc.get('nodes', []) if k not in keep_nodes]
        sc['extras'] = {'iw': meta}
    for m in js.get('meshes', []):
        m.pop('name', None)
    _write_glb(raw, js, rest)
    print(f'[arena] raw GLB {os.path.getsize(raw) / 1024:.0f} KiB, {len(js.get("nodes", []))} nodes ({stripped} unnamed), '
          f'meta: {len(meta["col"])} colliders, {len(meta["mark"])} markers, {len(meta["fx"])} fx, {len(meta["foot"])} footprints')
    if pack and os.path.exists(GLTFPACK):
        args = ['/opt/node22/bin/node', GLTFPACK, '-i', raw, '-o', path, '-cc', '-ce', 'ext', '-km', '-ke',
                '-mi', '-kv', '-vpf', '-vn', '8', '-vtf', '-vc', '8']
        r = subprocess.run(args, capture_output=True, text=True)
        if r.returncode != 0:
            print('[arena] gltfpack failed:', r.stderr[:600])
            shutil.copy(raw, path)
        else:
            os.remove(raw)
            _round_nodes(path)
    else:
        shutil.move(raw, path)
    print(f'[arena] GLB -> {path} ({os.path.getsize(path) / 1024:.0f} KiB)')
    return os.path.getsize(path)
