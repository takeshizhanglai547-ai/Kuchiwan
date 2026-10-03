"""blender/enemies/ekit.py - building blocks for the Grauwerk enemy units (owner: enemy modeler).

Forked from blender/mech/mechkit.py (mech lane) so both lanes share the same manufacturing
logic (bolts, drums, rams, plates, soot, Grauwerk mark) without coupling their build scripts.

Economical hard-surface parts tuned for a ~10 m rig inside a <= 90k triangle budget:
chamfered housings (lofts of 8-point sections), joint drums, light hydraulic rams,
thruster bells, face picking / plating helpers, pose tests and original decals
(soot blotches, the Grauwerk Consolidated mark).

Coordinates: Blender world, metres, +Z up, the rig faces -Y, so its RIGHT is -X.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.path.dirname(HERE)
if BLENDER not in sys.path:
    sys.path.insert(0, BLENDER)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from bmesh.geometry import intersect_face_point  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import iwkit as iw  # noqa: E402
from iwkit import decals as D  # noqa: E402
from iwkit import prims as P  # noqa: E402
from iwkit.core import look_rotation  # noqa: E402
from iwkit.geo import Geo, merged  # noqa: E402

# Budget knobs: fasteners without washers (the baked bevel normal reads them fine at 10 m scale)
P.bolt.__defaults__ = (0.02, 'hex', 'steel', False, False)
P.bolt_row.__defaults__ = ((0, 0, 1), 0.018, 'hex', 'steel', False, 0.0)
P.bolt_circle.__defaults__ = (0.018, 'hex', 'steel', 0.0, False)

ROUGH_FLOOR = 0.22   # minimum baked roughness (HDR overflow guard, see finalize_textures)
BOLT_SPACING = 1.6   # global multiplier on armour-plate bolt spacing (triangle budget)

IRONWAKE = os.path.dirname(BLENDER)
ASSETS = os.path.join(IRONWAKE, 'assets', 'enemies')
PREVIEW = os.path.join(ASSETS, 'preview')


# ============================================================================ 2D sections
def crect(x0, x1, y0, y1, c=0.1):
    """8-point chamfered rectangle in (a, b). c = one chamfer or per corner
    (c00, c10, c11, c01) for (x0,y0), (x1,y0), (x1,y1), (x0,y1)."""
    if not isinstance(c, (tuple, list)):
        c = (c, c, c, c)
    w, h = x1 - x0, y1 - y0
    c = [min(max(1e-3, v), 0.49 * min(w, h)) for v in c]
    return [(x0 + c[0], y0), (x1 - c[1], y0), (x1, y0 + c[1]), (x1, y1 - c[2]),
            (x1 - c[2], y1), (x0 + c[3], y1), (x0, y1 - c[3]), (x0, y0 + c[0])]


def scale2(pts, s, about=None):
    if about is None:
        about = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    sx, sy = (s, s) if not isinstance(s, (tuple, list)) else s
    return [(about[0] + (p[0] - about[0]) * sx, about[1] + (p[1] - about[1]) * sy) for p in pts]


def prow(hw, yf, yb, pr, c, cx=0.0):
    """9-point chest/housing section in (a, b) = (x, y): a V 'prow' pointing to -y (front)
    by `pr`, chamfered corners c."""
    return [(cx, yf - pr), (cx + hw - c, yf), (cx + hw, yf + c), (cx + hw, yb - c), (cx + hw - c, yb),
            (cx - hw + c, yb), (cx - hw, yb - c), (cx - hw, yf + c), (cx - hw + c, yf)]


def shell(sections, axis='Z', bevel=0.022, segs=1, mat='paint_primary'):
    """Chamfered housing lofted through crect sections [(t, a0, a1, b0, b1, c), ...]."""
    secs = [(crect(a0, a1, b0, b1, c), t) for (t, a0, a1, b0, b1, c) in sections]
    g = P.loft(secs, bevel=0.0, segs=segs, mat=mat, axis=axis)
    # bevel every crease above 10 deg so shallow section changes still catch a highlight
    return g.bevel(bevel, segs, min_angle=10.0)


def loft_pts(sections, axis='Y', bevel=0.02, segs=1, mat='paint_primary'):
    """Loft through arbitrary outlines [(outline, t), ...] (equal point counts)."""
    g = P.loft(sections, bevel=0.0, segs=segs, mat=mat, axis=axis)
    return g.bevel(bevel, segs, min_angle=10.0)


# ============================================================================ face helpers
def face_at(g, point, normal, angle=25.0):
    """Planar face of g facing `normal` whose outline contains the projection of `point`
    (nearest plane wins)."""
    p = Vector(point)
    best, bd = None, 1e9
    for f in g.faces_facing(normal, angle):
        if not intersect_face_point(f, p):
            continue
        d = abs((p - f.verts[0].co).dot(f.normal))
        if d < bd:
            best, bd = f, d
    return best


def hatch_at(g, point, normal, size, u_axis=None, angle=25.0, **kw):
    f = face_at(g, point, normal, angle)
    if f is None:
        return None
    n = f.normal
    p = Vector(point)
    p = p - n * (p - f.verts[0].co).dot(n)
    return g.hatch(f, p, size, u_axis=u_axis, **kw)


def plate_at(g, point, normal, u_axis=None, angle=25.0, outline_fn=None, **kw):
    """Layered armour plate on the face of g under `point` (see prims.armor_on_face).
    outline_fn(pts2d) -> custom outline in the face frame."""
    f = face_at(g, point, normal, angle)
    if f is None:
        return None
    if outline_fn is not None:
        o, u, v, n, pts = g.face_frame(f, u_axis)
        kw['outline'] = outline_fn(pts)
    kw.setdefault('segs', 1)
    kw['bolt_spacing'] = kw.get('bolt_spacing', 0.16) * BOLT_SPACING
    n = f.normal.copy()
    pl = P.armor_on_face(g, f, u_axis=u_axis, **kw)
    mark_hidden(pl, -n)
    return pl


HIDDEN = '__hidden'


def mark_hidden(g, direction, cos=0.995):
    """Tag faces facing `direction` (the never-visible backs of plates / strips lying on a
    surface) so drop_hidden() can delete them after cull_inside(): saves atlas space."""
    d = Vector(direction).normalized()
    mi = g.mi(HIDDEN)
    g.bm.normal_update()
    for f in g.bm.faces:
        if f.normal.dot(d) > cos:
            f.material_index = mi
    return g


def drop_hidden(g):
    import bmesh
    if HIDDEN not in g.mats:
        return 0
    mi = g.mats.index(HIDDEN)
    kill = [f for f in g.bm.faces if f.material_index == mi]
    if kill:
        bmesh.ops.delete(g.bm, geom=kill, context='FACES')
    return len(kill)


def grooves(g, normals, co, no, gap=0.016, depth=0.014, angle=30.0):
    faces = []
    for n in normals:
        faces += g.faces_facing(n, angle)
    return g.groove_cut(faces, co, no, gap=gap, depth=depth)


def plate_world(corners, thickness, mat='paint_primary', ridge=0.0, ridge_axis='X', bevel=0.008, inset=None,
                bolts=0, bolt_r=0.016, bolt_spacing=0.3, chamfer=0.0, normal_hint=None, segs=1):
    """Armour plate from 3+ roughly coplanar WORLD corners (CCW seen from outside).
    Thickness grows along the outward normal."""
    C = [Vector(c) for c in corners]
    o = sum(C, Vector()) / len(C)
    n = (C[1] - C[0]).cross(C[-1] - C[0]).normalized()
    if normal_hint is not None and n.dot(Vector(normal_hint)) < 0:
        n = -n
    u = (C[1] - C[0])
    u = (u - n * u.dot(n)).normalized()
    v = n.cross(u).normalized()
    pts = [((c - o).dot(u), (c - o).dot(v)) for c in C]
    if P.poly_area(pts) < 0:
        pts = list(reversed(pts))
    if chamfer > 0:
        pts = P.fillet(pts, chamfer, 1)
    ins = thickness * 0.8 if inset is None else inset
    g = P.plate(pts, thickness, ridge=ridge, ridge_axis=ridge_axis, bevel=bevel, segs=segs, mat=mat, inset=ins)
    mark_hidden(g, (0, 0, -1))
    bolt_spacing *= BOLT_SPACING
    if bolts:
        corners2 = P.offset_poly(P.simplify(pts), ins + bolt_r * 2.4)
        for i in range(len(corners2)):
            a, b = corners2[i], corners2[(i + 1) % len(corners2)]
            L = (Vector(b) - Vector(a)).length
            if L < bolt_spacing * 1.6:
                continue
            k = max(2, int(round(L / bolt_spacing)) + 1)
            g.merge(P.bolt_row((a[0], a[1], thickness), (b[0], b[1], thickness), k, (0, 0, 1), r=bolt_r))
    M = Matrix(((u.x, v.x, n.x, o.x), (u.y, v.y, n.y, o.y), (u.z, v.z, n.z, o.z), (0, 0, 0, 1)))
    g.transform(M)
    return g


def strip(p0, p1, w, t, normal, mat='paint_accent', bevel=0.006):
    """Thin paint/trim strip (a flat bar) from p0 to p1 lying on a surface with `normal`."""
    p0, p1, n = Vector(p0), Vector(p1), Vector(normal).normalized()
    d = p1 - p0
    b = P.box((w, t, d.length), bevel=bevel, segs=1, mat=mat)
    mark_hidden(b, (0, -1, 0))
    # box local: X = width, Y = thickness (along normal), Z = length
    R = look_rotation(d, n).to_4x4()
    b.transform(Matrix.Translation((p0 + p1) * 0.5 + n * (t * 0.5)) @ R)
    return b


# ============================================================================ mechanics
def drum(center, axis, r, w, mat='paint_dark', rim='steel_dark', accent=None, segs=36, hub=True, bolts=6,
         profile='joint', step=0.0):
    """Actuator drum (joint housing) centred on `center` along `axis`: stepped bands,
    grooves, optional accent band, bolted hub bosses on both ends."""
    if profile == 'joint':
        b = [(0.08, 0.84, rim), (0.18, 1.0, None), (0.48, 0.95, accent), (0.18, 1.0, None), (0.08, 0.84, rim)]
    elif profile == 'ring':
        b = [(0.2, 0.9, rim), (0.6, 1.0, accent), (0.2, 0.9, rim)]
    else:
        b = profile
    bands = [(w * f, r * k, m) for f, k, m in b]
    g = P.banded_cylinder(bands, segs=segs, step=step, mat=mat)
    if hub:
        rr = r * (b[0][1])
        for z, nz in ((0.0, -1.0), (w, 1.0)):
            boss = P.cylinder(rr * 0.46, 0.05, 24, bevel=0.012, bsegs=1, mat='steel',
                              z0=(z if nz > 0 else z - 0.05))
            g.merge(boss)
            if bolts:
                g.merge(P.bolt_circle((0, 0, z), (0, 0, nz), rr * 0.72, bolts, r=max(0.013, r * 0.045),
                                      kind='hex', washer=False))
    d = Vector(axis).normalized()
    up = (0, 0, 1) if abs(d.z) < 0.9 else (0, 1, 0)
    g.align(d, up=up, loc=Vector(center) - d * (w / 2))
    return g


def cheek(center, axis_x, r, t, strap_to=None, strap_w=None, mat='paint_dark', bolts=6, n=20):
    """Clevis cheek plate: a disc around a joint axis (along X at `center`), thickness t
    along X, optionally strapped to a point `strap_to` (y, z) of the parent housing."""
    cx, cy, cz = center
    pts = []
    for i in range(n):
        a = math.tau * i / n
        pts.append((cy + math.cos(a) * r, cz + math.sin(a) * r))
    g = P.prism(pts, t, bevel=0.01, segs=1, mat=mat, axis='X').move(cx, 0, 0)
    if strap_to is not None:
        sy, sz = strap_to
        w = strap_w or r * 1.3
        d = Vector((0, sy - cy, sz - cz))
        L = d.length
        s = P.box((w, t, L), bevel=0.01, segs=1, mat=mat)
        R = look_rotation(d, (1, 0, 0)).to_4x4()
        s.transform(Matrix.Translation(Vector((cx, cy, cz)) + d * 0.5) @ R)
        g.merge(s)
    if bolts:
        nx = 1.0 if axis_x > 0 else -1.0
        g.merge(P.bolt_circle((cx + nx * t * 0.5, cy, cz), (nx, 0, 0), r * 0.72, bolts, r=0.016, washer=False))
        g.merge(P.cylinder(r * 0.34, 0.05, 24, bevel=0.012, bsegs=1, mat='steel', z0=0.0)
                .align((nx, 0, 0), loc=(cx + nx * t * 0.5, cy, cz)))
    return g


def ram(p0, p1, r=0.09, rod=None, frac=0.55, up=(0, 0, 1), segs=18, eyes=False, boot=True,
        sleeve_mat='steel_dark', rod_mat='chrome', eye_mat='steel_dark'):
    """Light hydraulic ram (~900 tris): stepped barrel, gland, chrome rod, boot, port,
    clevis eyes with pins at both ends. Pins lie along `up` x (p1 - p0)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    rod = rod or r * 0.5
    er = r * 0.9
    eo = er * 1.2 if eyes else 0.0
    ls = (L - 2 * eo) * frac
    za = eo
    g = Geo()
    prof = [(0.0, za), (r * 0.88, za), (r * 0.96, za + r * 0.25), (r, za + r * 0.45), (r, za + ls - r * 0.45),
            (r * 1.14, za + ls - r * 0.4), (r * 1.14, za + ls), (rod * 1.3, za + ls), (rod * 1.3, za + ls + r * 0.22),
            (0.0, za + ls + r * 0.22)]
    g.merge(P.lathe(prof, segs, sleeve_mat))
    g.merge(P.cylinder(rod, (L - eo) - (za + ls) + rod * 0.4, segs, bevel=rod * 0.25, bsegs=1, mat=rod_mat,
                       z0=za + ls))
    if boot:
        g.merge(P.ring(rod * 1.45, rod * 0.96, r * 0.22, segs, bevel=rod * 0.1, bsegs=1, mat='rubber',
                       z0=za + ls + r * 0.22))
    port = P.cylinder(r * 0.26, r * 0.5, 10, bevel=r * 0.05, bsegs=1, mat='steel', z0=0.0)
    port.rotate((90, 0, 0)).move(0, -r * 0.8, za + r * 1.0)
    g.merge(port)
    if eyes:
        for z in (0.0, L):
            e = P.cylinder(er, er * 1.15, 16, bevel=er * 0.12, bsegs=1, mat=eye_mat).rotate((0, 90, 0))
            nk = P.box((er * 1.1, er * 1.15, eo), bevel=er * 0.08, segs=1, mat=eye_mat)
            nk.move(0, 0, eo * 0.5 if z == 0.0 else -eo * 0.5)
            pin = P.cylinder(er * 0.45, er * 1.5, 10, bevel=er * 0.06, bsegs=1, mat='steel').rotate((0, 90, 0))
            g.merge(merged(e, nk, pin).move(0, 0, z))
    R = look_rotation(d, up).to_4x4()
    g.transform(Matrix.Translation(p0) @ R)
    return g


def bell(r_t, r_e, L, segs=32, wall=None, mat='steel_dark', glow=True, collar=True, bolts=6, ribs=1,
         rib_mat='steel'):
    """Light thruster bell (~700-1100 tris) pointing down -Z (exhaust through -Z);
    collar stack above z=0 (mounting face at z=+0.12)."""
    wall = wall or max(0.014, r_e * 0.07)
    g = Geo()
    n = 4
    inner = [(r_t + (r_e - r_t) * ((i / n) ** 1.5), -L * i / n) for i in range(n + 1)]
    outer = [(r + wall * (1.0 + 0.8 * (1 - i / n)), z) for i, (r, z) in enumerate(inner)]
    lip = [(r_e + wall * 0.5, -L - wall * 0.45)]
    shell = inner + lip + list(reversed(outer))
    shell.append(inner[0])
    b = P.lathe(shell, segs, mat)
    import bmesh
    bmesh.ops.remove_doubles(b.bm, verts=list(b.bm.verts), dist=1e-6)
    b.bm.normal_update()
    for f in b.bm.faces:
        c = f.calc_center_median()
        rad = Vector((c.x, c.y, 0.0))
        if rad.length > 1e-6 and f.normal.dot(rad.normalized()) < -0.2:
            f.material_index = b.mi('nozzle_inner')
    g.merge(b)
    if glow:
        g.merge(P.cylinder(r_t * 1.02, 0.012, segs, bevel=0.0, bsegs=1, mat='glow', z0=-0.03))
        g.merge(P.cone(r_t * 0.32, r_t * 0.06, L * 0.18, 12, bevel=0.0, bsegs=1, mat='steel_dark')
                .rotate((180, 0, 0)).move(0, 0, -0.025))
    if collar:
        ro = r_t + wall * 1.8
        g.merge(P.ring(ro + 0.05, r_t * 0.7, 0.07, segs, bevel=0.0, bsegs=1, mat='steel', z0=0.0))
        if collar == 2:
            g.merge(P.ring(ro + 0.025, r_t * 0.7, 0.06, segs, bevel=0.0, bsegs=1, mat='steel_dark', z0=0.07))
        if bolts:
            g.merge(P.bolt_circle((0, 0, 0.07), (0, 0, 1), ro + 0.036, bolts, r=0.013))
    for k in range(ribs):
        t = (k + 1) / (ribs + 1) * 0.8
        r = r_t + (r_e - r_t) * (t ** 1.5) + wall * (1.0 + 0.8 * (1 - t))
        g.merge(P.ring(r + 0.016, r - 0.004, 0.024, segs, bevel=0.0, bsegs=1, mat=rib_mat, z0=-L * t - 0.012))
    return g


def lens_dome(r, h, iris=0.33, ring=0.47, segs=32, rings=7, glass='glass', iris_mat='lens', ring_mat='steel_dark',
              core=0.0, part='all', fr=None):
    """Sensor lens as ONE open dome on z = 0 (+Z = view axis): black glass with the glowing
    iris (`iris` x r, ~10 % of the lens area at 0.33) and a matte aperture ring (`ring` x r)
    painted on its own faces, so nothing sits buried inside the glass (cull_inside-safe) and
    only the iris carries the glow material (models.js gives it the flat iw_eye_color).
    core > 0 splits the iris into a hot core (q < core) and a rim annulus: part='core' keeps
    everything but the rim, part='rim' only the rim faces (put it under a child node with a
    deeper, dimmer iw_eye_color: a hot centre in a saturated red halo instead of a flat disc)."""
    if fr is None:   # ring radii (fractions of r); pass `fr` for a cheaper lens (small, distant sensors)
        fr = sorted(set([1.0, 0.86, 0.7, 0.58] + ([ring] if ring > 0 else []) + [iris, iris * 0.55] +
                        ([core, core * 0.5] if core > 0 else [])), reverse=True)
        while len(fr) < rings:
            fr.append(fr[-1] * 0.5)
    prof = [(r * f, h * math.sqrt(max(0.0, 1.0 - f * f))) for f in fr] + [(0.0, h)]
    g = P.lathe(prof, segs, glass)
    li, lr = g.mi(iris_mat), g.mi(ring_mat)
    drop = []
    for f in g.bm.faces:
        c = f.calc_center_median()
        q = math.hypot(c.x, c.y) / r
        rim = core > 0 and core <= q < iris
        if (part == 'core' and rim) or (part == 'rim' and not rim):
            drop.append(f)
            continue
        if q < iris:
            f.material_index = li
        elif ring > 0 and q < ring:
            f.material_index = lr
    if drop:
        import bmesh
        bmesh.ops.delete(g.bm, geom=drop, context='FACES')
    return g


def shackle(r=0.06, bar=0.016, mat='steel_dark', base_mat='paint_primary'):
    """Light lifting eye / tow shackle on a welded base plate (z=0 up)."""
    g = Geo()
    base = P.box((r * 2.6, r * 1.5, 0.02), bevel=0.004, segs=1, mat=base_mat).move(0, 0, 0.01)
    lug = P.prism(P.fillet([(-r * 0.9, 0), (r * 0.9, 0), (r * 0.9, r * 1.1), (0, r * 1.9), (-r * 0.9, r * 1.1)],
                           r * 0.3, 2), 0.035, bevel=0.004, segs=1, mat=base_mat, axis='Y').move(0, 0, 0.02)
    lug.boolean(P.cylinder(r * 0.42, 0.1, 16, bevel=0.0, mat='steel_dark').rotate((90, 0, 0))
                .move(0, 0, 0.02 + r * 1.1))
    loop = P.torus(r * 0.75, bar, 18, 8, mat=mat)
    loop.rotate((0, 90, 0)).move(0, 0, 0.02 + r * 1.1 + r * 0.65)
    g.merge(base, lug, loop)
    return g


def nozzle_part(a, name, exit_loc, exhaust, parent, r_t, r_e, L, segs=32, **kw):
    """nozzle_<group>_<n> node at the exit centre + its bell geometry (child of the node).
    The node carries iw_r (exit radius) so rig.js can size the flame."""
    d = Vector(exhaust).normalized()
    node = a.nozzle(name, tuple(exit_loc), exhaust=tuple(d), parent=parent)
    node['iw_r'] = round(r_e, 3)
    node['iw_len'] = round(L, 3)
    g = bell(r_t, r_e, L, segs=segs, **kw)
    up = (0, 0, 1) if abs(d.z) < 0.9 else (0, 1, 0)
    g.align(-d, up=up, loc=Vector(exit_loc) - d * L)
    g.cull_inside()
    a.part(name + '_geo', g, parent=node)
    return node


def cell_panel(w, h, nx, ny, frame, gap, depth, t=0.06, mat='paint_primary', floor_mat='steel_dark'):
    """Flat panel (XY, face normal +Z, front at z=0, thickness t behind) with nx x ny
    square-ish recessed cells (launcher tubes, vent grids). Returns (geo, cell_centres)."""
    import bmesh
    cw = (w - 2 * frame - (nx - 1) * gap) / nx
    ch = (h - 2 * frame - (ny - 1) * gap) / ny
    xs = [-w / 2, -w / 2 + frame]
    for i in range(nx):
        x0 = -w / 2 + frame + i * (cw + gap)
        xs += [x0 + cw] + ([x0 + cw + gap] if i < nx - 1 else [])
    xs.append(w / 2)
    ys = [-h / 2, -h / 2 + frame]
    for j in range(ny):
        y0 = -h / 2 + frame + j * (ch + gap)
        ys += [y0 + ch] + ([y0 + ch + gap] if j < ny - 1 else [])
    ys.append(h / 2)
    verts, faces, cells = [], [], []
    idx = {}
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            idx[i, j] = len(verts)
            verts.append((x, y, 0.0))
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            faces.append((idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]))
            if i % 2 == 1 and j % 2 == 1:
                cells.append(len(faces) - 1)
    # slab sides + back (no front face: the cells stay visible), sharing the outer ring
    nX, nY = len(xs) - 1, len(ys) - 1
    ring = [idx[i, 0] for i in range(nX)] + [idx[nX, j] for j in range(nY)] + \
           [idx[i, nY] for i in range(nX, 0, -1)] + [idx[0, j] for j in range(nY, 0, -1)]
    back = []
    for k in ring:
        x, y, _ = verts[k]
        back.append(len(verts))
        verts.append((x, y, -t))
    n = len(ring)
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        faces.append((b, a, back[k], back[(k + 1) % n]))
    faces.append(tuple(reversed(back)))
    g = Geo.from_pydata(verts, faces, mat)
    g.fix_normals()
    mark_hidden(g, (0, 0, -1))
    g.bm.faces.ensure_lookup_table()
    cf = [g.bm.faces[k] for k in cells]
    centres = [tuple(f.calc_center_median()) for f in cf]
    floor = g._push(cf, -depth)
    fm = g.mi(floor_mat)
    for f in g.bm.faces:
        c = f.calc_center_median()
        if c.z < -1e-4 and c.z > -depth - 1e-4 and abs(c.x) < w / 2 - frame * 0.5 and abs(c.y) < h / 2 - frame * 0.5:
            f.material_index = fm
    return g, centres


def hex_bolts(p0, p1, n, normal, r=0.02, washer=True):
    return P.bolt_row(p0, p1, n, normal, r=r, washer=washer)


# ============================================================================ decals
def soot(px=256, seed=1, strength=0.85, elong=1.0):
    """Soft black soot / heat-scorch blotch (RGBA)."""
    rng = np.random.default_rng(seed)
    h = w = px
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    r = np.sqrt(((xx - cx) / (w * 0.5)) ** 2 + ((yy - cy) / (h * 0.5 * elong)) ** 2)
    base = np.clip(1.0 - r, 0, 1) ** 1.6
    n = np.zeros((h, w), np.float32)
    for k, amp in ((8, 0.5), (24, 0.3), (64, 0.2)):
        g = rng.random((k, k)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        n += amp * (np.asarray(im, np.float32) / 255.0)
    a = np.clip(base * (0.55 + 0.9 * (n - 0.5)) * 1.35, 0, 1) * strength
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., 0:3] = np.array([14, 12, 10], np.uint8)
    rgba[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA').filter(ImageFilter.GaussianBlur(1.2))


def grauwerk_mark(px=512, colors=((216, 163, 26), (26, 26, 26), (189, 179, 154)), worn=0.25, seed=9, text=True):
    """Grauwerk Consolidated corporate mark (ORIGINAL design): a bevelled hexagonal
    ingot plate split by a pour channel, with three rising 'ingot' bars and the GC
    monogram band. RGBA."""
    yel, blk, cream = colors
    W, H = px, int(px * (1.25 if text else 1.0))
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = px
    cx, cy, R = s * 0.5, s * 0.47, s * 0.44
    hexpts = [(cx + R * math.cos(math.radians(30 + 60 * i)), cy + R * math.sin(math.radians(30 + 60 * i)))
              for i in range(6)]
    d.polygon(hexpts, fill=blk + (255,))
    r2 = R * 0.84
    hex2 = [(cx + r2 * math.cos(math.radians(30 + 60 * i)), cy + r2 * math.sin(math.radians(30 + 60 * i)))
            for i in range(6)]
    d.polygon(hex2, fill=yel + (255,))
    # three ingot bars (rising left to right)
    bw = r2 * 0.28
    for i, hgt in enumerate((0.55, 0.8, 1.05)):
        x0 = cx - r2 * 0.52 + i * (bw + r2 * 0.1)
        y1 = cy + r2 * 0.5
        y0 = y1 - r2 * hgt
        d.polygon([(x0, y1), (x0 + bw, y1), (x0 + bw, y0 + bw * 0.35), (x0 + bw * 0.5, y0), (x0, y0 + bw * 0.35)],
                  fill=blk + (255,))
    # ladle lip: a black chevron over the ingots
    d.polygon([(cx - r2 * 0.62, cy - r2 * 0.48), (cx, cy - r2 * 0.78), (cx + r2 * 0.62, cy - r2 * 0.48),
               (cx + r2 * 0.62, cy - r2 * 0.36), (cx, cy - r2 * 0.64), (cx - r2 * 0.62, cy - r2 * 0.36)],
              fill=blk + (255,))
    if text:
        f = D.font('stencil', int(s * 0.17))
        t = 'GRAUWERK'
        tw = d.textlength(t, font=f)
        d.rectangle([s * 0.04, s * 0.98, s * 0.96, s * 1.22], fill=blk + (255,))
        d.text(((W - tw) / 2, s * 0.995), t, font=f, fill=cream + (255,))
    return D.weather(img, worn, seed) if worn > 0 else img


def id_bars(w=512, h=128, color=(216, 163, 26), bars=5, seed=3, worn=0.3):
    """Grauwerk unit ID bar code (a ladder of yellow bars)."""
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed)
    x = 0
    for i in range(bars):
        bw = int(w / bars * (0.35 + 0.4 * rng.random()))
        d.rectangle([x, 0, x + bw, h], fill=color + (255,))
        x += int(w / bars)
    return D.weather(img, worn, seed)


# ============================================================================ previews / tests
POSES = {
    # name: {pivot: (pitch X, yaw Z, roll Y) radians in Blender local axes == rig.js local X / Y / Z}
    'rest': {},
    'crouch': {'thigh_L': (-0.45, 0, 0), 'thigh_R': (-0.45, 0, 0), 'shin_L': (0.85, 0, 0), 'shin_R': (0.85, 0, 0),
               'foot_L': (-0.4, 0, 0), 'foot_R': (-0.4, 0, 0), 'pelvis': (0.12, 0, 0)},
    'walk': {'thigh_L': (-0.55, 0, 0), 'thigh_R': (0.55, 0, 0), 'shin_L': (0.3, 0, 0), 'shin_R': (0.85, 0, 0),
             'foot_L': (0.25, 0, 0), 'foot_R': (-1.4, 0, 0)},
    'boost': {'thigh_L': (-0.35, 0, 0), 'thigh_R': (0.05, 0, 0), 'shin_L': (0.55, 0, 0), 'shin_R': (0.7, 0, 0),
              'foot_L': (-0.08, 0, 0), 'foot_R': (-0.3, 0, 0), 'pelvis': (0.2, 0, 0), 'torso': (-0.08, 0, 0)},
    'aim_up': {'arm_L': (-0.55, 0, 0), 'arm_R': (-0.55, 0, 0), 'shoulder_L': (-0.45, 0, 0),
               'shoulder_R': (-0.45, 0, 0), 'head': (-0.32, 0, 0), 'torso': (-0.18, 0, 0)},
    'aim_down': {'arm_L': (0.45, 0, 0), 'arm_R': (0.45, 0, 0), 'shoulder_L': (0.3, 0, 0), 'shoulder_R': (0.3, 0, 0),
                 'head': (0.25, 0, 0), 'torso': (0.12, 0, 0)},
    'twist': {'torso': (0, 1.1, 0)},
    'lunge': {'arm_L': (-1.2, -0.4, 0), 'forearm_L': (0.8, 0, 0), 'pelvis': (0.3, 0, 0), 'torso': (-0.1, 0, 0)},
    'ab': {'thigh_L': (0.5, 0, 0), 'thigh_R': (0.5, 0, 0), 'shin_L': (0.9, 0, 0), 'shin_R': (0.9, 0, 0),
           'foot_L': (-0.56, 0, 0), 'foot_R': (-0.56, 0, 0), 'pelvis': (0.5, 0, 0), 'torso': (-0.2, 0, 0)},
    'recoil': {'arm_R': (-0.35, 0, 0), 'forearm_R': (-0.25, 0, 0), 'shoulder_R': (-0.3, 0, 0)},
}


def set_pose(asset, pose):
    """Apply a pose (rig.js local rotations) to the pivots; {} restores the rest pose.
    rig.js composes Euler(x, y, z, 'YXZ') in three.js axes: three X = Blender X,
    three Y = Blender Z, three Z = Blender -Y."""
    from mathutils import Euler
    for name, ob in asset.pivots.items():
        if name == 'root' or name.startswith(('nozzle_', 'muzzle_')):
            continue
        rx, rz, ry = pose.get(name, (0.0, 0.0, 0.0))
        # three: q = Ry(yaw) * Rx(pitch) * Rz(roll)  (order YXZ)
        q = Euler((0, 0, rz)).to_quaternion() @ Euler((rx, 0, 0)).to_quaternion() @ Euler((0, -ry, 0)).to_quaternion()
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = q
    bpy.context.view_layer.update()


def clay_views(asset, out_prefix, views, res=(960, 540), samples=12):
    objs = asset.parts
    iw.preview.studio(objs)
    paths = []
    for name, v in views.items():
        iw.preview.camera(objs, **v)
        p = f'{out_prefix}_{name}.png'
        iw.preview.render(p, res=res, samples=samples)
        paths.append(p)
    return paths


def contact(paths, out, cols=3, tile=(640, 360)):
    ims = [Image.open(p).convert('RGB').resize(tile, Image.LANCZOS) for p in paths]
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (tile[0] * cols, tile[1] * rows), (16, 16, 16))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * tile[0], (i // cols) * tile[1]))
    sheet.save(out)
    return out


def finalize_textures(a, sizes=None, quality=None):
    """Re-save the baked maps with per-map sizes (e.g. ORM 1024) and point the EXISTING atlas
    materials' images at them (apply_atlas() must not run twice: after the first call the
    faces no longer carry palette indices, so a second call would drop the glow material)."""
    from iwkit import texcomp as T
    out = os.path.join(a.work, 'final')
    old = {k: os.path.abspath(v) for k, v in a.map_paths.items()}
    # roughness floor: near-mirror chrome/lens pixels (rough < ~0.2) make GGX sun glints that
    # overflow the half-float HDR target (Inf -> NaN through bloom = a black frame)
    orm = a.maps['orm']
    np.maximum(orm[..., 1], np.uint8(round(ROUGH_FLOOR * 255)), out=orm[..., 1])
    paths = T.save_maps(a.maps, out, a.name + '_f', sizes=sizes or {})
    for img in list(bpy.data.images):
        fp = os.path.abspath(bpy.path.abspath(img.filepath)) if img.filepath else ''
        for k, p in old.items():
            if fp == p:
                img.filepath = paths[k]
                img.reload()
    a.map_paths = paths
    return paths


# ============================================================================ weighted atlas
UP_WEIGHT = 1.0    # texel weight of up-facing faces (an asset seen mostly from the side can lower it)
MAT_WEIGHT = {'steel': 0.7, 'steel_dark': 0.7, 'chrome': 0.6, 'rubber': 0.6, 'nozzle_inner': 0.5, 'glow': 0.4,
              'lens': 0.5, 'paint_dark': 0.85}


def _uv_islands(me):
    """Union-find UV islands of a mesh -> (poly -> island root array, loop -> poly array)."""
    npoly, nl = len(me.polygons), len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    le = np.empty(nl, np.int32)
    me.loops.foreach_get('edge_index', le)
    uv = np.empty(nl * 2, np.float32)
    me.uv_layers[0].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    ls = np.empty(npoly, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get('loop_total', lt)
    lp = np.repeat(np.arange(npoly, dtype=np.int32), lt)
    nxt = np.arange(nl, dtype=np.int64) + 1
    nxt[ls + lt - 1] = ls
    parent = np.arange(npoly)

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r
    seen = {}
    for li in range(nl):
        e = int(le[li])
        va, vb = int(lv[li]), int(lv[nxt[li]])
        ua, ub = uv[li], uv[nxt[li]]
        p = int(lp[li])
        if e in seen:
            p2, va2, ua2, ub2 = seen[e]
            if va2 == va:
                ok = abs(ua2[0] - ua[0]) + abs(ua2[1] - ua[1]) < 1e-5 and abs(ub2[0] - ub[0]) + abs(ub2[1] - ub[1]) < 1e-5
            else:
                ok = abs(ua2[0] - ub[0]) + abs(ua2[1] - ub[1]) < 1e-5 and abs(ub2[0] - ua[0]) + abs(ub2[1] - ua[1]) < 1e-5
            if ok:
                ra, rb = find(p), find(p2)
                if ra != rb:
                    parent[ra] = rb
        else:
            seen[e] = (p, va, ua.copy(), ub.copy())
    roots = np.array([find(i) for i in range(npoly)])
    return roots, lp, uv


def weight_islands(objs, obj_weight=None, down=0.55):
    """Scale every (selected) UV island by a visibility/importance weight before packing:
    bare metal / rubber / glow get less texel density, down-facing faces less, and
    per-object multipliers (head, chest ...) more. Pack afterwards (relative scale kept)."""
    obj_weight = obj_weight or {}
    for o in objs:
        me = o.data
        npoly = len(me.polygons)
        if npoly == 0:
            continue
        sel = np.empty(npoly, bool)
        me.polygons.foreach_get('select', sel)
        mi = np.empty(npoly, np.int32)
        me.polygons.foreach_get('material_index', mi)
        nrm = np.empty(npoly * 3, np.float32)
        me.polygons.foreach_get('normal', nrm)
        nrm = nrm.reshape(-1, 3) @ np.array(o.matrix_world.to_3x3(), np.float32).T
        nrm /= np.maximum(1e-9, np.linalg.norm(nrm, axis=1))[:, None]
        mw = np.array([MAT_WEIGHT.get(me.materials[i].name if i < len(me.materials) else '', 1.0) for i in mi],
                      np.float32)
        w = mw * np.where(nrm[:, 2] < -0.5, down, np.where(nrm[:, 2] > 0.9, UP_WEIGHT, 1.0)) * obj_weight.get(o.name, 1.0)
        roots, lp, uv = _uv_islands(me)
        uv2 = uv.copy()
        for r in np.unique(roots[sel]):
            pf = roots == r
            loops = pf[lp]
            k = float(w[pf].max())
            if abs(k - 1.0) < 1e-3:
                continue
            c = uv[loops].mean(0)
            uv2[loops] = c + (uv[loops] - c) * k
        me.uv_layers[0].data.foreach_set('uv', uv2.ravel())


def unwrap(a, angle=66.0, margin_px=None, obj_weight=None, small=0.07, small_scale=0.5, shape='CONCAVE'):
    """iwkit.uv.unwrap + (1) importance-weighted island scales and (2) concave packing
    (much denser atlas for a full rig: ~55% fill instead of ~28% with AABB)."""
    a.triangulate()
    td = _unwrap_weighted(a.bake_objects(), a.res, margin_px or max(4, a.res // 512), angle, shape=shape,
                          small=small, small_scale=small_scale, obj_weight=obj_weight)
    a.texel_density = td
    a.root['iw_texel_density_px_per_m'] = round(td, 1)
    return td


import iwkit.uv as U  # noqa: E402

RING_FILL = 0.42   # islands filling less than this share of their UV bounding box may be straightened


def _poly_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def straighten_rings(objs, fill=RING_FILL, min_faces=8):
    """Annular / arc-shaped UV islands (lathe caps, flanges, slewing rings, duct lips) waste
    most of their bounding box in the atlas. Re-map each one to polar coordinates around a
    least-squares circle fit (u = angle x mean radius, v = radius: area-preserving for thin
    rings), cutting the seam in the widest angular gap -> a straight strip that packs densely.
    Only the selected (big, non-stacked) faces are touched. Returns the number of islands."""
    done = 0
    for o in objs:
        me = o.data
        npoly = len(me.polygons)
        if npoly < min_faces:
            continue
        sel = np.empty(npoly, bool)
        me.polygons.foreach_get('select', sel)
        roots, lp, uv = _uv_islands(me)
        ls = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        lt = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_total', lt)
        uv2 = uv.copy()
        changed = False
        for r in np.unique(roots[sel]):
            faces = np.nonzero((roots == r) & sel)[0]
            if len(faces) < min_faces:
                continue
            loops = np.concatenate([np.arange(ls[f], ls[f] + lt[f]) for f in faces])
            P2 = uv[loops].astype(np.float64)
            lo, hi = P2.min(0), P2.max(0)
            box = float(np.prod(np.maximum(hi - lo, 1e-9)))
            area = sum(_poly_area(uv[ls[f]:ls[f] + lt[f]].astype(np.float64)) for f in faces)
            if area <= 0 or area / box >= fill:
                continue
            # algebraic circle fit: x^2 + y^2 = a x + b y + c
            A = np.column_stack([P2[:, 0], P2[:, 1], np.ones(len(P2))])
            sol, *_ = np.linalg.lstsq(A, (P2 ** 2).sum(1), rcond=None)
            c = np.array([sol[0] * 0.5, sol[1] * 0.5])
            R0 = math.sqrt(max(1e-12, sol[2] + c @ c))
            rho = np.linalg.norm(P2 - c, axis=1)
            rmin, rmax = float(rho.min()), float(rho.max())
            if rmin < 0.3 * R0 or rmax > 1.6 * R0 or (rmax - rmin) > 0.7 * rmax:
                continue     # not ring-like (a disc or an irregular blob): leave it
            # face centroid angles -> seam in the widest gap
            fa = np.array([math.atan2(*(uv[ls[f]:ls[f] + lt[f]].mean(0) - c)[::-1]) for f in faces])
            srt = np.sort(fa)
            gaps = np.diff(np.concatenate([srt, srt[:1] + 2 * math.pi]))
            k = int(np.argmax(gaps))
            seam = srt[k] + gaps[k] * 0.5
            rmean = float(rho.mean())
            for f, af in zip(faces, fa):
                af0 = (af - seam) % (2 * math.pi)
                for li in range(ls[f], ls[f] + lt[f]):
                    d = uv[li] - c
                    a = math.atan2(d[1], d[0]) - seam
                    a = af0 + math.atan2(math.sin(a - af0), math.cos(a - af0))
                    uv2[li] = (a * rmean, math.hypot(d[0], d[1]))
            changed = True
            done += 1
        if changed:
            me.uv_layers[0].data.foreach_set('uv', uv2.ravel())
    return done


def split_long_islands(objs, frac=0.3, fill=0.6, gap=0.02):
    """Islands much longer than the atlas side (unrolled octagon bands, straightened rings,
    long rails) force the packer to shrink everything to fit them. Cut every island longer than
    `frac` x the expected atlas side (sqrt(total area / fill)) into chunks along its principal
    axis (whole faces per chunk, chunks offset apart so they become separate islands)."""
    data, tot = [], 0.0
    for o in objs:
        me = o.data
        npoly = len(me.polygons)
        if npoly == 0:
            continue
        sel = np.empty(npoly, bool)
        me.polygons.foreach_get('select', sel)
        roots, lp, uv = _uv_islands(me)
        ls = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        lt = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_total', lt)
        fa = np.array([_poly_area(uv[ls[f]:ls[f] + lt[f]].astype(np.float64)) for f in range(npoly)])
        tot += float(fa[sel].sum())
        data.append((o, sel, roots, uv, ls, lt))
    if tot <= 0:
        return 0
    Lmax = frac * math.sqrt(tot / fill)
    done = 0
    for o, sel, roots, uv, ls, lt in data:
        uv2 = uv.copy()
        changed = False
        for r in np.unique(roots[sel]):
            faces = np.nonzero((roots == r) & sel)[0]
            loops = np.concatenate([np.arange(ls[f], ls[f] + lt[f]) for f in faces])
            P2 = uv[loops].astype(np.float64)
            c = P2.mean(0)
            w, V = np.linalg.eigh(np.cov((P2 - c).T) + np.eye(2) * 1e-12)
            ax, pe = V[:, 1], V[:, 0]               # principal / perpendicular axes
            t = (P2 - c) @ ax
            ext = float(t.max() - t.min())
            if ext <= Lmax * 1.15:
                continue
            n = int(math.ceil(ext / Lmax))
            L = ext / n
            wid = float(((P2 - c) @ pe).max() - ((P2 - c) @ pe).min())
            t0 = float(t.min())
            for f in faces:
                fl = np.arange(ls[f], ls[f] + lt[f])
                tc = float(((uv[fl].mean(0) - c) @ ax))
                k = min(n - 1, int((tc - t0) / L))
                if k:
                    uv2[fl] = uv[fl] - ax * (k * L) + pe * (k * (wid + gap))
            changed = True
            done += 1
        if changed:
            o.data.uv_layers[0].data.foreach_set('uv', uv2.ravel())
    return done


def _unwrap_weighted(objs, res=2048, margin_px=6, angle=62.0, rotate=True, shape='AABB', small=0.07, small_scale=0.5,
                     stack=True, obj_weight=None):
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
    smalls = U._small_islands(objs, small) if small > 0 else {o: [] for o in objs}
    nsmall = sum(len(v) for v in smalls.values())
    for o in objs:
        sel = np.ones(len(o.data.polygons), bool)
        for isl in smalls[o]:
            sel[isl['faces']] = False
        o.data.polygons.foreach_set('select', sel)
    U.select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), margin_method='FRACTION', island_margin=0.0,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    weight_islands(objs, obj_weight)
    nr = straighten_rings(objs)
    nl = split_long_islands(objs)
    if nr or nl:
        iw.log(f'uv: {nr} ring/arc islands straightened into strips, {nl} long islands cut into chunks')
    # UV units per metre of the big islands
    k = U.texel_density(objs, 1.0, only_selected=True) or 1.0
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
    td = U.texel_density(objs, res)
    iw.log(f'uv: {len(objs)} meshes packed ({nsmall} small pieces, {len(placed)} unique stacks), texel density '
        f'{td:.0f} px/m at {res}px ({1000.0 / max(td, 1e-6):.1f} mm/px)')
    return td




# ============================================================================ generic housings
def frame_along(p0, p1, side=(1, 0, 0)):
    """4x4 frame at p0 whose +Z runs to p1 and +X follows `side` (projected)."""
    p0, p1 = Vector(p0), Vector(p1)
    z = (p1 - p0).normalized()
    x = Vector(side)
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x, p0.x), (x.y, y.y, z.y, p0.y), (x.z, y.z, z.z, p0.z), (0, 0, 0, 1))), (p1 - p0).length


def limb(p0, p1, sections, mat='paint_primary', bevel=0.022, side=(1, 0, 0)):
    """Chamfered housing lofted along the segment p0 -> p1. sections: [(t, a0, a1, b0, b1, c)] with t in
    0..1 along the segment, a along `side` (world X by default) and b along (dir x side)."""
    M, L = frame_along(p0, p1, side)
    g = shell([(t * L, a0, a1, b0, b1, c) for (t, a0, a1, b0, b1, c) in sections], 'Z', bevel=bevel, mat=mat)
    return g.transform(M)


def sec_interp(secs, z):
    """Linear interpolation of prow sections [(z, hw, yf, yb, pr, c), ...] at height z."""
    if z <= secs[0][0]:
        return secs[0][1:]
    for i in range(len(secs) - 1):
        a, b = secs[i], secs[i + 1]
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, 6))
    return secs[-1][1:]


def prow_facet(secs, z, t, s=1, lift=0.012):
    """Point on the front V facet of a prow loft (side s) at height z; t = 0 crease .. 1 corner."""
    hw, yf, yb, pr, c = sec_interp(secs, z)
    p0 = Vector((0.0, yf - pr, z))
    p1 = Vector((s * (hw - c), yf, z))
    d = p1 - p0
    n = Vector((-d.y, d.x, 0.0)).normalized() * s
    if n.y > 0:
        n = -n
    return p0 + d * t + n * lift, n


def prow_plate(secs, z0, z1, t0, t1, s, thick, mat, **kw):
    a, n = prow_facet(secs, z0, t0, s)
    b, _ = prow_facet(secs, z0, t1, s)
    c, _ = prow_facet(secs, z1, t1, s)
    d, _ = prow_facet(secs, z1, t0, s)
    nz = (c - b).cross(a - b).normalized()
    if nz.dot(n) < 0:
        nz = -nz
    return plate_world([a, b, c, d], thick, mat=mat, normal_hint=nz, **kw)


# ============================================================================ pipeline driver
def run(name, build_fn, decal_fn, need_nodes, scheme='grauwerk', colors=None, seed=7, obj_weight=None,
        weathering=None, views=None, clay=None, bake_kw=None, res=1024, sizes=None, quality=82, small=0.07,
        webp=True, tex_quality=None, card_atlas=1024, post_bake=None):
    """Shared CLI for the enemy builds:
        --blockout [--views a,b]   geometry + clay renders only (fast)
        --quick                    512 bake, GLB, 2 previews at 24 spp
        (default)                  `res` bake, GLB + FBX, all previews
    """
    import argparse
    import json
    import time
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=res)
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--blockout', action='store_true')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--no-fbx', action='store_true')
    ap.add_argument('--reuse-bakes', action='store_true')
    ap.add_argument('--views', default='')
    ap.add_argument('--seg-scale', type=float, default=0.66)
    ap.add_argument('--out', default=os.path.join(ASSETS, name + '.glb'))
    args = ap.parse_args([x for x in sys.argv[1:] if x != '--'])
    if args.quick:
        args.res, args.samples = max(512, args.res // 2), 24
    P.SEG_SCALE = args.seg_scale
    t0 = time.time()
    os.makedirs(PREVIEW, exist_ok=True)
    iw.reset_scene()
    a = iw.Asset(name, seed=seed, scheme=scheme, res=args.res, kind='enemy', colors=colors)
    tris = build_fn(a)
    st = a.stats()
    iw.log('model:', st['tris'], 'tris in', st['parts'], 'parts')
    iw.log('parts:', json.dumps(dict(sorted(tris.items(), key=lambda kv: -kv[1]))))
    work = os.path.join(a.work, 'clay')
    if args.blockout:
        sel = args.views.split(',') if args.views else list(clay)
        paths = clay_views(a, os.path.join(work, 'clay'), {k: clay[k] for k in sel})
        contact(paths, os.path.join(work, 'clay_sheet.png'))
        iw.log('clay ->', work)
        return
    decal_fn(a)
    unwrap(a, angle=66.0, obj_weight=obj_weight, small=small)
    cov, ovl = iw.uv.coverage(a.bake_objects(), 512)
    iw.log(f'uv coverage {cov:.1%}, overlap {ovl:.2%}, texel {a.texel_density:.0f} px/m')
    kw = dict(edge=0.03, cavity=0.07, ao_dist=0.8, bevel_radius=0.012)
    kw.update(bake_kw or {})
    a.bake(weathering=weathering, reuse=args.reuse_bakes, **kw)
    sz = {'orm': args.res // 2, 'emissive': args.res // 2}
    sz.update({k: (max(256, v // 2) if args.quick else v) for k, v in (sizes or {}).items()})
    if post_bake:
        post_bake(a)
    a.maps['normal'] = clean_normal(a.maps['normal'])
    finalize_textures(a, sizes=sz)
    bd = None
    if webp:
        build_cards(a, W=card_atlas, max_h=card_atlas)
        a.cleanup_decals()
        a.root['iw_tris'] = iw.tri_count(a.parts)
        a.root['iw_texture_res'] = args.res
        export_glb_lean(a.root, args.out)
        sources = {os.path.splitext(os.path.basename(p))[0]: p for p in a.map_paths.values()}
        if getattr(a, 'decal_atlas', None):
            sources[f'{name}_decals'] = a.decal_atlas
        q = dict(DEFAULT_QUALITY)
        q.update(tex_quality or {})
        size = repack_glb_webp(args.out, sources, q, decal_mat=f'M_{name}_decal')
        bd = glb_breakdown(args.out)
        iw.log('GLB breakdown', _json.dumps(bd))
    else:
        size = a.export_glb(args.out, image_format='JPEG', quality=quality, compress=True)
    rep = iw.export.glb_report(args.out)
    missing = [n for n in need_nodes if n not in rep['nodes']]
    iw.log('GLB contract nodes:', 'OK' if not missing else f'MISSING {missing}', f'{size / 1e6:.2f} MB')
    fbx = None
    if not args.no_fbx and not args.quick:
        fbx = a.export_fbx()
    previews = []
    if not args.no_render:
        iw.preview.studio(a.parts)
        names = args.views.split(',') if args.views else (list(views)[:2] if args.quick else list(views))
        for n in names:
            iw.preview.camera(a.parts, **views[n])
            p = os.path.join(PREVIEW, f'{name}_{n}.png')
            iw.preview.render(p, res=(1600, 900) if not args.quick else (1280, 720), samples=args.samples)
            previews.append(p)
    r = a.report({'glb_bytes': size, 'glb_breakdown': bd, 'missing_nodes': missing, 'fbx': fbx, 'previews': previews,
                  'parts_tris': tris, 'uv_coverage': round(cov, 3), 'cards': len(getattr(a, 'cards', [])),
                  'total_s': round(time.time() - t0, 1)})
    with open(os.path.join(ASSETS, name + '_report.json'), 'w') as f:
        json.dump(r, f, indent=1, ensure_ascii=False)
    iw.log('REPORT', json.dumps({k: r[k] for k in ('tris', 'texel_density_px_per_m', 'glb_bytes', 'total_s')}))


def finish():
    """End of a build script: bpy 4.2 can segfault while tearing down in background mode."""
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


# ============================================================================ budget helpers
def tris(g):
    """Triangle count of a Geo (n-gons count as n - 2)."""
    return sum(len(f.verts) - 2 for f in g.bm.faces)


class Budget:
    """Per-component triangle log: b.add('lamp', geo) -> geo (merge it as usual)."""

    def __init__(self, label):
        self.label = label
        self.items = {}

    def add(self, key, g):
        self.items[key] = self.items.get(key, 0) + tris(g)
        return g

    def report(self):
        tot = sum(self.items.values())
        top = sorted(self.items.items(), key=lambda kv: -kv[1])[:12]
        iw.log(f'budget {self.label}: {tot} tris | ' + ', '.join(f'{k} {v}' for k, v in top))


# ============================================================================ cheap greebles
def lug(r=0.07, t=0.035, mat='paint_primary', pin_mat='steel'):
    """Cheap lifting eye (~110 tris): welded lug plate (normal +Y) with a pin boss, on z=0."""
    g = P.prism(P.fillet([(-r, 0), (r, 0), (r * 0.8, r * 1.2), (0, r * 1.7), (-r * 0.8, r * 1.2)], r * 0.3, 1), t,
                bevel=0.004, segs=1, mat=mat, axis='Y')
    g.merge(P.cylinder(r * 0.42, t * 1.6, 12, bevel=0.003, bsegs=1, mat=pin_mat).rotate((90, 0, 0))
            .move(0, 0, r * 1.05))
    return g


def whip(length=1.2, r=0.01, base_r=0.04, mat='steel_dark', tip_mat='paint_accent'):
    """Cheap whip antenna (~140 tris) on +Z."""
    g = Geo()
    g.merge(P.cylinder(base_r, base_r * 1.6, 12, bevel=base_r * 0.15, bsegs=1, mat=mat, z0=0.0))
    g.merge(P.cylinder(r * 2.0, 0.06, 8, bevel=0.0, mat='rubber', z0=base_r * 1.6))
    g.merge(P.cylinder(r, length, 6, bevel=0.0, mat=mat, z0=base_r * 1.6 + 0.06))
    g.merge(P.cylinder(r * 2.2, r * 3, 8, bevel=r * 0.5, bsegs=1, mat=tip_mat, z0=base_r * 1.6 + 0.06 + length))
    return g


def rung(p0, p1, standoff, normal, r=0.02, mat='steel'):
    """U-shaped step rung / grab handle from boxes (~40 tris): p0 -> p1 along the surface,
    standing `standoff` off it along `normal`."""
    p0, p1, n = Vector(p0), Vector(p1), Vector(normal).normalized()
    g = Geo()
    for a, b in ((p0, p0 + n * standoff), (p0 + n * standoff, p1 + n * standoff), (p1 + n * standoff, p1)):
        d = b - a
        bx = P.box((r * 2, r * 2, d.length + r * 2), bevel=r * 0.3, segs=1, mat=mat)
        R = look_rotation(d, n if abs(d.normalized().dot(n)) < 0.9 else (p1 - p0)).to_4x4()
        bx.transform(Matrix.Translation((a + b) * 0.5) @ R)
        g.merge(bx)
    return g


def tube(points, r, segs=10, mat='rubber', collar_mat='steel', collars=True, rib_amp=0.0, rib_freq=0.0, subdiv=4):
    """Light hose / conduit (~segs x 4 x points tris): a swept tube with plain collar
    fittings at both ends (cheaper than prims.hose)."""
    g = P.sweep(points, r, segs, mat=mat, rib_amp=rib_amp, rib_freq=rib_freq, subdiv=subdiv)
    if collars:
        pts = [Vector(p) for p in points]
        for a, b in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            d = (b - a).normalized()
            g.merge(P.cylinder(r * 1.35, r * 2.2, max(8, segs), bevel=r * 0.15, bsegs=1, mat=collar_mat, z0=0.0)
                    .align(d, loc=a))
    return g


# ============================================================================ v2 texture pipeline
# Forked from blender/mech/rigpipe.py (mech lane) so the Grauwerk units ship with the same
# discipline as the player rig: DECAL CARDS (stencils / labels / emblems as alpha-blended quads
# a few mm over their plate, 450-600 px/m, crisp at 200%), WebP GLB images (EXT_texture_webp,
# ~35% smaller than JPEG at the same quality -> 2048 atlases inside the 0.8 MB budget), clean
# normal maps and tangent-free meshes (three.js builds the frame per pixel).
import io  # noqa: E402
import json as _json  # noqa: E402
import struct  # noqa: E402

from iwkit import materials as _M  # noqa: E402
from iwkit.core import link as _link  # noqa: E402


def card(a, image, loc, normal, up=(0, 0, 1), size=(0.3, None), parent='turret', density=520, offset=0.004):
    """Register a decal card: `image` (PIL RGBA) on a quad centred at `loc` (world) facing
    `normal`, image-up along `up`, `size` (w, h|None) m, parented to pivot `parent`."""
    if not hasattr(a, 'cards'):
        a.cards = []
    if size[1] is None:
        size = (size[0], size[0] * image.height / image.width)
    a.cards.append(dict(img=image.convert('RGBA'), loc=Vector(loc), n=Vector(normal).normalized(), up=Vector(up),
                        size=tuple(size), parent=parent, density=density, offset=offset))


def _pack_rects(specs, W, pad):
    order = sorted(range(len(specs)), key=lambda i: (-specs[i]['px'][1], -specs[i]['px'][0], i))
    x = y = sh = 0
    pos = {}
    for i in order:
        w, h = specs[i]['px']
        if x + w + 2 * pad > W:
            y += sh
            x, sh = 0, 0
        pos[i] = (x + pad, y + pad)
        x += w + 2 * pad
        sh = max(sh, h + 2 * pad)
    return pos, y + sh


def _dilate_rgb(img, steps=6):
    """Bleed opaque colours into transparent texels (no dark fringes under mipmapping)."""
    arr = np.asarray(img, np.float32)
    rgb = arr[..., :3]
    w = (arr[..., 3:] > 5).astype(np.float32)
    acc, wt = rgb * w, w.copy()
    for _ in range(steps):
        pa = np.pad(acc, ((1, 1), (1, 1), (0, 0)), mode='edge')
        pw = np.pad(wt, ((1, 1), (1, 1), (0, 0)), mode='edge')
        acc2 = pa[:-2, 1:-1] + pa[2:, 1:-1] + pa[1:-1, :-2] + pa[1:-1, 2:] + pa[1:-1, 1:-1]
        wt2 = pw[:-2, 1:-1] + pw[2:, 1:-1] + pw[1:-1, :-2] + pw[1:-1, 2:] + pw[1:-1, 1:-1]
        fill = (wt < 0.5) & (wt2 > 0)
        acc = np.where(fill, acc2 / np.maximum(wt2, 1e-6), acc)
        wt = np.where(fill, 1.0, wt)
    out = np.where(wt > 0, acc, rgb)
    return Image.fromarray(np.clip(np.concatenate([out, arr[..., 3:]], -1) + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def snap_cards(a, reach=0.45, offset=0.004):
    """Seat every card on the actual surface (highest hit of 7 rays along -normal)."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    verts, polys = [], []
    for o in a.bake_objects():
        M = o.matrix_world
        base = len(verts)
        verts.extend(M @ v.co for v in o.data.vertices)
        polys.extend(tuple(base + i for i in p.vertices) for p in o.data.polygons)
    bvh = BVHTree.FromPolygons(verts, polys)
    moved = 0
    for s in getattr(a, 'cards', []):
        n, u = s['n'], s['up']
        x = u.cross(n).normalized()
        y = n.cross(x).normalized()
        hw, hh = s['size'][0] * 0.5, s['size'][1] * 0.5
        best = None
        for sx, sy in ((0, 0), (-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9), (0, -0.9), (0, 0.9)):
            o = s['loc'] + x * (sx * hw) + y * (sy * hh) + n * reach
            hit, hn, fi, d = bvh.ray_cast(o, -n, reach * 2.0)
            if hit is None:
                continue
            h = (hit - s['loc']).dot(n)
            if abs(h) > 0.2:
                continue
            best = h if best is None else max(best, h)
        if best is not None:
            s['loc'] = s['loc'] + n * best
            s['offset'] = offset
            moved += 1
    iw.log(f'decal cards: {moved}/{len(getattr(a, "cards", []))} seated on the surface')


def decal_material(name, img, rough=0.62):
    m = bpy.data.materials.new(name)
    b = _M.NB(m)
    t = b.n('ShaderNodeTexImage', image=img)
    t.interpolation = 'Linear'
    bsdf = b.n('ShaderNodeBsdfPrincipled')
    b.link(t.outputs['Color'], bsdf.inputs['Base Color'])
    b.link(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    out = b.n('ShaderNodeOutputMaterial')
    b.link(bsdf.outputs[0], out.inputs['Surface'])
    for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    return m


def build_cards(a, W=1024, max_h=1024, pad=4, density_scale=1.0):
    """Pack the registered cards into one decal atlas and build one '<pivot>_decals' mesh per
    pivot (material M_<asset>_decal). Call after baking."""
    specs = getattr(a, 'cards', [])
    if not specs:
        return None
    snap_cards(a)
    scale = density_scale
    for _ in range(14):
        for s in specs:
            d = s['density'] * scale
            s['px'] = (max(12, int(round(s['size'][0] * d))), max(12, int(round(s['size'][1] * d))))
        pos, H = _pack_rects(specs, W, pad)
        if H <= max_h:
            break
        scale *= 0.92
    Hp = max(128, int(math.ceil(H / 64.0)) * 64)
    atlas = Image.new('RGBA', (W, Hp), (0, 0, 0, 0))
    for i, s in enumerate(specs):
        atlas.alpha_composite(s['img'].resize(s['px'], Image.LANCZOS), pos[i])
    al = np.asarray(atlas.getchannel('A').filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255.0
    al = np.round(al * 15.0) / 15.0
    atlas.putalpha(Image.fromarray((al * 255.0 + 0.5).astype(np.uint8)))
    atlas = _dilate_rgb(atlas)
    path = os.path.join(a.work, f'{a.name}_decals.png')
    atlas.save(path)
    img = bpy.data.images.load(path, check_existing=False)
    img.name = f'{a.name}_decals'
    img.colorspace_settings.name = 'sRGB'
    mat = decal_material(f'M_{a.name}_decal', img)
    by_parent = {}
    for i, s in enumerate(specs):
        by_parent.setdefault(s['parent'], []).append(i)
    obs = []
    bpy.context.view_layer.update()
    for parent, idx in sorted(by_parent.items()):
        par = a.pivots[parent]
        inv = par.matrix_world.inverted()
        verts, faces, uvs = [], [], []
        for i in idx:
            s = specs[i]
            n, u = s['n'], s['up']
            x = u.cross(n).normalized()
            y = n.cross(x).normalized()
            c = s['loc'] + n * s['offset']
            hw, hh = s['size'][0] * 0.5, s['size'][1] * 0.5
            px, py = pos[i]
            w, h = s['px']
            u0, u1 = px / W, (px + w) / W
            v1, v0 = 1.0 - py / Hp, 1.0 - (py + h) / Hp
            k = len(verts)
            for (sx, sy, uu, vv) in ((-1, -1, u0, v0), (1, -1, u1, v0), (1, 1, u1, v1), (-1, 1, u0, v1)):
                verts.append(tuple(inv @ (c + x * (sx * hw) + y * (sy * hh))))
                uvs.append((uu, vv))
            faces.append((k, k + 1, k + 2, k + 3))
        me = bpy.data.meshes.new(f'{parent}_decals')
        me.from_pydata(verts, [], faces)
        me.uv_layers.new(name='UVMap')
        for li, lp in enumerate(me.loops):
            me.uv_layers[0].data[li].uv = uvs[lp.vertex_index]
        me.materials.append(mat)
        me.update()
        ob = bpy.data.objects.new(f'{parent}_decals', me)
        _link(ob, a.col)
        ob.parent = par
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob['iw_decal'] = 1
        ob['iw_noshadow'] = 1
        obs.append(ob)
    a.card_objects = obs
    a.decal_atlas = path
    iw.log(f'decal cards: {len(specs)} cards in {len(obs)} meshes, atlas {W}x{Hp} (scale {scale:.2f})')
    return path


def clean_normal(nrm, flat=0.012):
    """Snap near-flat texels of an OpenGL normal map to exactly flat (cleaner, smaller)."""
    n = nrm.astype(np.float32) / 127.5 - 1.0
    out = nrm.copy()
    out[np.hypot(n[..., 0], n[..., 1]) < flat] = (128, 128, 255)
    return out


def _glb_read(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, total = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67
    off, js, bn = 12, None, b''
    while off < total:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = _json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bn = chunk
        off += 8 + clen
    return js, bn


def _glb_write(path, js, bn):
    jb = _json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bn += b'\0' * ((4 - len(bn) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bn)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(bn), 0x004E4942))
        f.write(bn)


def webp_bytes(src, kind, size=None, quality=85):
    im = Image.open(src)
    im = im.convert('RGBA' if kind == 'decals' else 'RGB')
    if size and size != im.width:
        im = im.resize((size, int(round(im.height * size / im.width))), Image.LANCZOS)
    b = io.BytesIO()
    if kind == 'decals':
        im.save(b, 'WEBP', quality=int(quality), method=6, alpha_quality=60)
    else:
        im.save(b, 'WEBP', quality=int(quality), method=6)
    return b.getvalue()


def repack_glb_webp(path, sources, quality, sizes=None, decal_mat=None):
    """Replace every GLB image by a WebP encoded from its lossless PNG source (EXT_texture_webp,
    required), rebuild the BIN chunk, make the decal material alpha-blended."""
    js, bn = _glb_read(path)
    views = js['bufferViews']
    new_img = {}
    for im in js.get('images', []):
        nm = im.get('name', '')
        kind = nm.rsplit('_', 1)[-1]
        src = sources.get(nm)
        if src is None:
            iw.log('webp: no source for image', nm, '(kept)')
            continue
        new_img[im['bufferView']] = webp_bytes(src, kind, (sizes or {}).get(kind), quality.get(kind, 85))
        im['mimeType'] = 'image/webp'
    refs = []
    for vi, v in enumerate(views):
        ext = v.get('extensions', {}).get('EXT_meshopt_compression')
        if ext is not None and ext.get('buffer', 0) == 0:
            refs.append((ext.get('byteOffset', 0), ext['byteLength'], vi, ext))
        elif v.get('buffer', 0) == 0:
            refs.append((v.get('byteOffset', 0), v['byteLength'], vi, v))
    refs.sort(key=lambda r: (r[0], r[2]))
    out = bytearray()
    for off, ln, vi, holder in refs:
        data = new_img.get(vi) if holder is views[vi] else None
        if data is None:
            data = bn[off:off + ln]
        out += b'\0' * ((4 - len(out) % 4) % 4)
        holder['byteOffset'] = len(out)
        holder['byteLength'] = len(data)
        out += data
    js['buffers'][0]['byteLength'] = len(out)
    for t in js.get('textures', []):
        if 'source' in t:
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': t.pop('source')}
    for key in ('extensionsUsed', 'extensionsRequired'):
        lst = js.setdefault(key, [])
        if 'EXT_texture_webp' not in lst:
            lst.append('EXT_texture_webp')
    for m in js.get('materials', []):
        m['doubleSided'] = False
        if decal_mat and m.get('name') == decal_mat:
            m['alphaMode'] = 'BLEND'
            for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
                m.pop(k, None)
            pbr = m.setdefault('pbrMetallicRoughness', {})
            pbr.pop('metallicRoughnessTexture', None)
            pbr['metallicFactor'] = 0.0
            pbr['roughnessFactor'] = 0.62
    _glb_write(path, js, bytes(out))
    return os.path.getsize(path)


def glb_breakdown(path):
    js, bn = _glb_read(path)
    imgs = {im.get('name'): js['bufferViews'][im['bufferView']]['byteLength'] for im in js.get('images', [])}
    return {'bytes': os.path.getsize(path), 'images': imgs, 'image_bytes': sum(imgs.values()),
            'geometry_bytes': os.path.getsize(path) - sum(imgs.values())}


# r4b: 12-bit positions / UVs (<= 3 mm on a 12 m relay, half a texel at 2048): ~5-8% smaller GLBs, the
# single-file build must shrink
GLTFPACK_EXTRA = ['-vp', '12', '-vt', '12']


def export_glb_lean(root, path, strip_tangents=True, vn=8):
    """Blender glTF export (placeholder JPEGs, replaced by WebP later) without tangents ->
    gltfpack meshopt + quantisation."""
    import shutil
    import subprocess
    from iwkit import export as X
    from iwkit.core import descendants, select_only
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = descendants(root)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    select_only(objs, root)
    raw = path[:-4] + '.raw.glb'
    with iw.timed('export.glb'):
        with iw.core.quiet():
            bpy.ops.export_scene.gltf(
                filepath=raw, export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
                export_apply=True, export_tangents=not strip_tangents, export_normals=True, export_texcoords=True,
                export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=60,
                export_image_quality=60, export_cameras=False, export_lights=False, export_animations=False,
                export_skins=False, export_morph=False, export_vertex_color='NONE', export_attributes=False,
                check_existing=False)
    if X.gltfpack_available():
        args = [X._node(), X.GLTFPACK, '-i', raw, '-o', path, '-cc', '-ce', 'ext', '-kn', '-km', '-ke',
                '-vn', str(vn), '-vt', '14'] + list(GLTFPACK_EXTRA)
        with iw.timed('export.gltfpack'):
            r = subprocess.run(args, capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(path):
            iw.log('gltfpack failed, keeping uncompressed GLB:', r.stderr.strip()[:400])
            shutil.move(raw, path)
        else:
            os.remove(raw)
    else:
        shutil.move(raw, path)
    return os.path.getsize(path)


DEFAULT_QUALITY = {'basecolor': 80, 'orm': 72, 'normal': 82, 'emissive': 88, 'decals': 82}


# ============================================================================ r4: secondary frequency
def _pip(pt, poly):
    """2D point-in-polygon (even-odd)."""
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0:
            inside = not inside
    return inside


def bolt_at(p, n, r, mat='steel'):
    """One cheap hex bolt standing on surface point p with normal n (identical copies UV-stack)."""
    b = P.bolt(r, 'hex', mat)
    n = Vector(n).normalized()
    b.align(n, up=(0, 0, 1) if abs(n.z) < 0.9 else (0, 1, 0), loc=p)
    return b



def _slope_walls(faces, ctr, u, v, w, h, s):
    """r4: pull the boundary verts of a raised cap / recess floor `s` toward the centre so the panel walls
    slope 45 deg: they stay in the same UV island as the face (90 deg walls became hundreds of thin
    islands and halved the atlas coverage)."""
    vs = {vv for f in faces if f.is_valid for vv in f.verts}
    for vv in vs:
        d = vv.co - ctr
        du, dv = d.dot(u), d.dot(v)
        if abs(du) > w * 0.5 - 2e-3:
            vv.co -= u * (s if du > 0 else -s)
        if abs(dv) > h * 0.5 - 2e-3:
            vv.co -= v * (s if dv > 0 else -s)

def panelize(g, seed, min_area=0.02, frac=0.66, max_side=0.4, min_side=0.06, skip=None,
             mats=('paint_primary', 'paint_dark', 'paint_secondary'), weights=(0.4, 0.38, 0.22), bolt_r=0.01,
             down_ok=False, gap=0.008, raise_h=0.012, recess=0.015, groove=0.01, keep=(), stats=None):
    """r4 (critic r3: flat body planes): break every big planar paint face of a shell into an inset
    panel - a seam-loop panel, a raised plate with corner bolts or a recessed panel - centred in the
    face and kept inside its outline. skip(centre, normal) -> True leaves a face alone; faces that
    contain a `keep` point (decal cards) stay flat. Returns the bolt geometry to merge with the part."""
    import random
    rng = random.Random(seed)
    g.bm.normal_update()
    mids = [g.mats.index(m) for m in mats if m in g.mats]
    keep = [Vector(p) for p in keep]
    cands = []
    for f in g.bm.faces:
        if f.material_index not in mids or len(f.verts) < 3:
            continue
        if not down_ok and f.normal.z < -0.55:
            continue
        a_ = f.calc_area()
        if a_ < min_area:
            continue
        c = f.calc_center_median()
        if skip is not None and skip(c, f.normal):
            continue
        cands.append((round(-a_, 6), round(c.x, 4), round(c.y, 4), round(c.z, 4), f))
    cands.sort(key=lambda t: t[:4])
    bolts = Geo()
    st = stats if stats is not None else {}
    for _, cx, cy, cz, f in cands:
        if not f.is_valid:
            continue
        o, u, v, n, pts = g.face_frame(f)
        if any(abs((p - o).dot(n)) < 0.1 and _pip(((p - o).dot(u), (p - o).dot(v)), pts) for p in keep):
            continue
        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        ccu, ccv = sum(us) / len(us), sum(vs) / len(vs)
        w = min(max_side, (max(us) - min(us)) * frac)
        h = min(max_side, (max(vs) - min(vs)) * frac)
        ok = False
        for _k in range(5):
            corners = [(ccu + sx * w * 0.5, ccv + sy * h * 0.5) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            if all(_pip(q, pts) for q in corners):
                ok = True
                break
            w *= 0.82
            h *= 0.82
        if not ok or w < min_side or h < min_side:
            continue
        ctr = o + u * ccu + v * ccv
        r_ = rng.random()
        mode = 0 if r_ < weights[0] else (1 if r_ < weights[0] + weights[1] else 2)
        fm = g.mats[f.material_index]
        if mode == 0:     # low seam plate: reads as a panel outline in the bevel-baked normal
            res, sl = g.hatch(f, ctr, (w, h), gap=gap, raised=groove, u_axis=u), groove
        elif mode == 1:
            res, sl = g.hatch(f, ctr, (w, h), gap=gap, raised=raise_h, u_axis=u), raise_h
        else:             # recessed panels floor in a darker paint (a value step that reads at range)
            res, sl = g.hatch(f, ctr, (w, h), gap=gap, recess=recess, u_axis=u,
                              mat='paint_dark' if fm != 'paint_dark' else 'steel_dark'), recess
        if res is None:
            continue
        _slope_walls(res, ctr, u, v, w - 2 * gap, h - 2 * gap, sl)
        st['panels'] = st.get('panels', 0) + 1
        if mode == 1 and bolt_r > 0 and min(w, h) > bolt_r * 8:
            ins = bolt_r * 3.2 + raise_h
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = ctr + u * su * (w * 0.5 - ins) + v * sv * (h * 0.5 - ins) + n * raise_h
                bolts.merge(bolt_at(p, n, bolt_r, fm))
                st['bolts'] = st.get('bolts', 0) + 1
    return bolts
