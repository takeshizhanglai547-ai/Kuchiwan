"""iwkit.uv - one shared UV atlas per asset.

Smart-UV-projects every part mesh of the asset together (multi-object edit mode),
equalises texel density (average island scale) and packs all islands into one 0..1
square with a pixel margin that matches the bake margin. Also: texel-density and
UV-overlap diagnostics.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from .core import log, select_only


def _components(me):
    """Connected face components of a mesh: list of face-index lists (deterministic)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen = [False] * len(bm.faces)
    comps = []
    for f in bm.faces:
        if seen[f.index]:
            continue
        stack = [f]
        seen[f.index] = True
        comp = []
        while stack:
            x = stack.pop()
            comp.append(x.index)
            for e in x.edges:
                for y in e.link_faces:
                    if not seen[y.index]:
                        seen[y.index] = True
                        stack.append(y)
        comps.append(sorted(comp))
    bm.free()
    return comps


def _small_islands(objs, small):
    """Find small connected components (bolts, rivets, tiny greebles). Returns
    {obj: [ {faces, verts_order, sig, ...} ]}."""
    out = {}
    for o in objs:
        me = o.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        res = []
        for comp in _components(me):
            vids = []
            for fi in comp:
                vids.extend(me.polygons[fi].vertices)
            vu = list(dict.fromkeys(vids))
            pts = co[vu]
            ext = pts.max(0) - pts.min(0)
            if float(np.linalg.norm(ext)) > small:
                continue
            res.append({'faces': comp, 'verts': vu, 'sig': (len(comp), len(vu), tuple(np.sort(np.round(ext, 3))))})
        out[o] = res
    return out


def unwrap(objs, res=2048, margin_px=6, angle=62.0, rotate=True, shape='AABB', small=0.07, small_scale=0.5,
           stack=True):
    """Unwrap + pack `objs` (mesh objects) into one atlas. Returns texel density (px/m).

    Big surfaces: Smart UV Project (angle_limit) + average island scale (uniform texel
    density across every part of the asset).
    Small parts (connected pieces smaller than `small` metres: bolts, rivets, nubs):
    one planar island each in the piece's own frame at `small_scale` x the density, and
    identical pieces are STACKED on the same UVs (stack=True) -> hundreds of bolts cost
    the atlas space of a few. Then everything is packed with a `margin_px` gutter."""
    objs = [o for o in objs if o.type == 'MESH']
    if not objs:
        return 0.0
    for o in objs:
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active_index = 0
        o.data.uv_layers[0].name = 'UVMap'
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    smalls = _small_islands(objs, small) if small > 0 else {o: [] for o in objs}
    nsmall = sum(len(v) for v in smalls.values())
    for o in objs:
        sel = np.ones(len(o.data.polygons), bool)
        for isl in smalls[o]:
            sel[isl['faces']] = False
        o.data.polygons.foreach_set('select', sel)
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), margin_method='FRACTION', island_margin=0.0,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # UV units per metre of the big islands
    k = texel_density(objs, 1.0, only_selected=True) or 1.0
    # planar UVs for the small pieces, in a frame fixed by their own shape (u points at
    # the farthest vertex), so identical pieces get identical UV islands
    placed = {}   # signature -> representative (obj, faces)
    dups = []     # (obj, faces) that will copy their representative's packing transform
    for o in objs:
        me = o.data
        uv = me.uv_layers[0].data
        for isl in smalls[o]:
            vco = [me.vertices[i].co.copy() for i in isl['verts']]
            c = sum(vco, Vector()) / len(vco)
            nrm = Vector()
            for fi in isl['faces']:
                p = me.polygons[fi]
                nrm += p.normal * p.area
            if nrm.length < 1e-9:
                nrm = Vector((0, 0, 1))
            nrm.normalize()
            best, ref = -1.0, None
            for q in vco:
                d = q - c
                d = d - nrm * d.dot(nrm)
                L = round(d.length, 5)
                if L > best + 1e-5:
                    best, ref = L, d
            u = ref.normalized() if ref is not None and ref.length > 1e-7 else nrm.orthogonal().normalized()
            v = nrm.cross(u)
            sc = k * small_scale
            for fi in isl['faces']:
                p = me.polygons[fi]
                for li in p.loop_indices:
                    q = me.vertices[me.loops[li].vertex_index].co - c
                    uv[li].uv = (q.dot(u) * sc, q.dot(v) * sc)
            key = isl['sig'] if stack else (o.name, isl['faces'][0])
            if key in placed:
                dups.append((o, isl['faces'], key))
            else:
                placed[key] = (o, isl['faces'])
    # pack everything except the duplicates
    dup_faces = {o: np.zeros(len(o.data.polygons), bool) for o in objs}
    for o, faces, _ in dups:
        dup_faces[o][faces] = True
    for o in objs:
        o.data.polygons.foreach_set('select', ~dup_faces[o])
    rep_pre = {}
    for key, (o, faces) in placed.items():
        uv = o.data.uv_layers[0].data
        lis = [li for fi in faces for li in o.data.polygons[fi].loop_indices]
        rep_pre[key] = (lis, np.array([uv[li].uv[:] for li in lis], np.float64))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=rotate, rotate_method='AXIS_ALIGNED', scale=True, margin_method='FRACTION',
                            margin=margin_px / res, shape_method=shape)
    bpy.ops.object.mode_set(mode='OBJECT')
    # affine (2x2 + offset) the packer applied to each representative -> apply to its copies
    xf = {}
    for key, (o, faces) in placed.items():
        lis, pre = rep_pre[key]
        uv = o.data.uv_layers[0].data
        post = np.array([uv[li].uv[:] for li in lis], np.float64)
        A = np.hstack([pre, np.ones((len(pre), 1))])
        sol, *_ = np.linalg.lstsq(A, post, rcond=None)
        xf[key] = sol
    for o, faces, key in dups:
        uv = o.data.uv_layers[0].data
        sol = xf[key]
        for fi in faces:
            for li in o.data.polygons[fi].loop_indices:
                x, y = uv[li].uv
                uv[li].uv = (x * sol[0, 0] + y * sol[1, 0] + sol[2, 0], x * sol[0, 1] + y * sol[1, 1] + sol[2, 1])
    for o in objs:
        o.data.polygons.foreach_set('select', np.ones(len(o.data.polygons), bool))
    td = texel_density(objs, res)
    log(f'uv: {len(objs)} meshes packed ({nsmall} small pieces, {len(placed)} unique stacks), texel density '
        f'{td:.0f} px/m at {res}px ({1000.0 / max(td, 1e-6):.1f} mm/px)')
    return td


def texel_density(objs, res, only_selected=False):
    """Average texel density (px per metre) = sqrt(uv area * res^2 / 3D area)."""
    area3d = 0.0
    area_uv = 0.0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers[0].data
        M = o.matrix_world
        n = len(me.loop_triangles)
        if n == 0:
            continue
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        R = np.array(M.to_3x3(), np.float32)
        co = co @ R.T
        tv = np.empty(n * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', tv)
        tl = np.empty(n * 3, np.int32)
        me.loop_triangles.foreach_get('loops', tl)
        uvs = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get('uv', uvs)
        uvs = uvs.reshape(-1, 2)
        if only_selected:
            psel = np.empty(len(me.polygons), bool)
            me.polygons.foreach_get('select', psel)
            tp = np.empty(n, np.int32)
            me.loop_triangles.foreach_get('polygon_index', tp)
            keep = psel[tp]
            tv = tv.reshape(-1, 3)[keep].ravel()
            tl = tl.reshape(-1, 3)[keep].ravel()
        a, b, c = co[tv[0::3]], co[tv[1::3]], co[tv[2::3]]
        area3d += float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() * 0.5)
        ua, ub, uc = uvs[tl[0::3]], uvs[tl[1::3]], uvs[tl[2::3]]
        e1, e2 = ub - ua, uc - ua
        area_uv += float(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum() * 0.5)
    if area3d <= 0:
        return 0.0
    return math.sqrt(area_uv * res * res / area3d)


def coverage(objs, res=512):
    """(covered_fraction, overlap_fraction) of the atlas - quick packing sanity check."""
    from PIL import Image, ImageDraw
    cov = np.zeros((res, res), np.int32)
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers[0].data
        lay = Image.new('I', (res, res), 0)
        d = ImageDraw.Draw(lay)
        for t in me.loop_triangles:
            d.polygon([(uv[l].uv.x * res, (1 - uv[l].uv.y) * res) for l in t.loops], fill=1)
        cov += np.array(lay)
    return float((cov > 0).mean()), float((cov > 1).mean())
