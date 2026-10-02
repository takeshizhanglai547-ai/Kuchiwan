"""blender/mech/mechkit.py - shared building blocks for the IRONWAKE rigs (owner: mech modeler).

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


def _cheap_bolt(r=0.02, kind='hex', mat='steel', washer=False, nub=False):
    """Budget fastener: un-bevelled 6-sided head (hex) or 8-sided dome; bottom face tagged
    hidden (it lies on the plate). ~14-20 tris instead of ~40-60."""
    h = r * 0.7
    if kind == 'dome':
        g = P.dome(r, r * 0.55, 8, 2, mat=mat)
    else:
        g = P.cylinder(r, h, 6 if kind == 'hex' else 8, bevel=0.0, bsegs=1, mat=mat, z0=0.0)
    mark_hidden(g, (0, 0, -1))
    return g


P.bolt = _cheap_bolt
P.bolt_row.__defaults__ = ((0, 0, 1), 0.018, 'hex', 'steel', False, 0.0)
P.bolt_circle.__defaults__ = (0.018, 'hex', 'steel', 0.0, False)

ROUGH_FLOOR = 0.22   # minimum baked roughness (HDR overflow guard, see finalize_textures)
BOLT_SPACING = 1.6   # global multiplier on armour-plate bolt spacing (triangle budget)

IRONWAKE = os.path.dirname(BLENDER)
ASSETS = os.path.join(IRONWAKE, 'assets', 'mech')
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


def cheek(center, axis_x, r, t, strap_to=None, strap_w=None, mat='paint_dark', bolts=4, lite=False):
    """Clevis cheek plate: a disc around a joint axis (along X at `center`), thickness t
    along X, optionally strapped to a point `strap_to` (y, z) of the parent housing.
    lite: 14-sided disc + plain 16-sided boss (~half the triangles; partly hidden joints)."""
    cx, cy, cz = center
    pts = []
    n = 14 if lite else 20
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
        g.merge(P.cylinder(r * 0.34, 0.05, 16 if lite else 24, bevel=0.0 if lite else 0.012, bsegs=1, mat='steel',
                           z0=0.0).align((nx, 0, 0), loc=(cx + nx * t * 0.5, cy, cz)))
    return g


def ram(p0, p1, r=0.09, rod=None, frac=0.55, up=(0, 0, 1), segs=20, eyes=False, boot=True,
        sleeve_mat='steel_dark', rod_mat='chrome', eye_mat='steel_dark'):
    """Light hydraulic ram (~450-700 tris): stepped barrel, gland, chrome rod (24-seg look
    at >= 20 segments), rubber boot, port, optional clevis eyes with pins at both ends.
    Pins lie along `up` x (p1 - p0)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    rod = rod or r * 0.5
    er = r * 0.9
    eo = er * 1.2 if eyes else 0.0
    ls = (L - 2 * eo) * frac
    za = eo
    g = Geo()
    prof = [(0.0, za), (r * 0.9, za), (r, za + r * 0.3), (r, za + ls - r * 0.4), (r * 1.14, za + ls - r * 0.34),
            (r * 1.14, za + ls), (rod * 1.3, za + ls + r * 0.2), (0.0, za + ls + r * 0.2)]
    g.merge(P.lathe(prof, segs, sleeve_mat))
    g.merge(P.cylinder(rod, (L - eo) - (za + ls) + rod * 0.4, segs, bevel=rod * 0.2, bsegs=1, mat=rod_mat,
                       z0=za + ls))
    if boot:
        g.merge(P.ring(rod * 1.42, rod * 0.96, r * 0.2, segs, bevel=0.0, bsegs=1, mat='rubber', z0=za + ls + r * 0.2))
    port = P.cylinder(r * 0.26, r * 0.5, 8, bevel=0.0, bsegs=1, mat='steel', z0=0.0)
    port.rotate((90, 0, 0)).move(0, -r * 0.8, za + r * 1.0)
    g.merge(port)
    if eyes:
        for z in (0.0, L):
            e = P.cylinder(er, er * 1.15, 16, bevel=0.0, bsegs=1, mat=eye_mat).rotate((0, 90, 0))
            nk = P.box((er * 1.1, er * 1.15, eo), bevel=0.0, segs=1, mat=eye_mat)
            nk.move(0, 0, eo * 0.5 if z == 0.0 else -eo * 0.5)
            pin = P.cylinder(er * 0.45, er * 1.5, 8, bevel=0.0, bsegs=1, mat='steel').rotate((0, 90, 0))
            g.merge(merged(e, nk, pin).move(0, 0, z))
    R = look_rotation(d, up).to_4x4()
    g.transform(Matrix.Translation(p0) @ R)
    return g


def bell(r_t, r_e, L, segs=32, wall=None, mat='steel_dark', glow=True, collar=True, bolts=6, ribs=1,
         rib_mat='steel', glow_rim='glow_rim'):
    """Light thruster bell (~700-1100 tris) pointing down -Z (exhaust through -Z);
    collar stack above z=0 (mounting face at z=+0.12)."""
    wall = wall or max(0.014, r_e * 0.07)
    g = Geo()
    n = 4 if r_t >= 0.15 else 3
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
        # throat (r2): full 360-degree glow in two rings (hot core #FFB04A + dim rim #7A2A10 =
        # a radial gradient once baked) behind a turbine / flame-holder: a 24-segment hub cone
        # and 8 radial vanes, so the throat never reads as a flat disc or a black void
        big = r_t >= 0.15
        gs = 24 if big else 16
        g.merge(P.lathe([(0.0, -0.03), (r_t * 0.55, -0.03)], gs, 'glow'))              # hot core disc (faces -Z)
        g.merge(P.lathe([(r_t * 0.55, -0.03), (r_t * 1.02, -0.03)], gs, glow_rim))     # dim rim annulus
        g.merge(P.cone(r_t * 0.3, r_t * 0.07, L * 0.22, 24 if r_t >= 0.15 else 12, bevel=0.0, bsegs=1,
                       mat='steel_dark').rotate((180, 0, 0)).move(0, 0, -0.025))
        for k in range(8 if r_t >= 0.15 else 0):
            vane = P.box((r_t * 0.66, 0.008, L * 0.05), bevel=0.0, segs=1, mat='steel_dark')
            vane.move(r_t * 0.63, 0, -0.025 - L * 0.025).rotate((0, 0, 22.5 + 45 * k))
            g.merge(vane)
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


def shackle(r=0.06, bar=0.016, mat='steel_dark', base_mat='paint_primary', segs=(18, 8)):
    """Light lifting eye / tow shackle on a welded base plate (z=0 up)."""
    g = Geo()
    base = P.box((r * 2.6, r * 1.5, 0.02), bevel=0.004, segs=1, mat=base_mat).move(0, 0, 0.01)
    lug = P.prism(P.fillet([(-r * 0.9, 0), (r * 0.9, 0), (r * 0.9, r * 1.1), (0, r * 1.9), (-r * 0.9, r * 1.1)],
                           r * 0.3, 2), 0.035, bevel=0.004, segs=1, mat=base_mat, axis='Y').move(0, 0, 0.02)
    lug.boolean(P.cylinder(r * 0.42, 0.1, 16, bevel=0.0, mat='steel_dark').rotate((90, 0, 0))
                .move(0, 0, 0.02 + r * 1.1))
    loop = P.torus(r * 0.75, bar, segs[0], segs[1], mat=mat)
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
    kw.setdefault('mat', 'bell_heat' if 'bell_heat' in a.presets else 'steel_dark')   # heat-tinted bell shell
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
MAT_WEIGHT = {'steel': 0.7, 'steel_dark': 0.55, 'chrome': 0.5, 'rubber': 0.45, 'nozzle_inner': 0.5, 'glow': 2.4,
              'glow_rim': 2.0, 'lens': 0.5, 'glass': 0.8, 'paint_dark': 0.65}


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
        w = mw * np.where(nrm[:, 2] < -0.5, down, 1.0) * obj_weight.get(o.name, 1.0)
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


def _unwrap_weighted(objs, res=2048, margin_px=6, angle=62.0, rotate=True, shape='AABB', small=0.07, small_scale=0.5,
                     stack=True, obj_weight=None, rotate_method='AXIS_ALIGNED'):
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
    bpy.ops.uv.pack_islands(rotate=rotate, rotate_method=rotate_method, scale=True, margin_method='FRACTION',
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
def run(name, build_fn, decal_fn, scheme='player', colors=None, seed=7, obj_weight=None, weathering=None,
        views=None, clay=None, bake_kw=None, eye=None):
    """Shared CLI for the rig builds:
        --blockout [--poses] [--views a,b]   geometry + clay renders only (fast)
        --quick                              1024 bake, GLB, 2 previews
        (default)                            2048 bake, GLB + FBX, all previews
    """
    import argparse
    import json
    import time
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=2048)
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--blockout', action='store_true')
    ap.add_argument('--poses', action='store_true')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--no-fbx', action='store_true')
    ap.add_argument('--reuse-bakes', action='store_true')
    ap.add_argument('--views', default='')
    ap.add_argument('--seg-scale', type=float, default=0.66)
    ap.add_argument('--out', default=os.path.join(ASSETS, name + '.glb'))
    args = ap.parse_args([x for x in sys.argv[1:] if x != '--'])
    if args.quick:
        args.res, args.samples = 1024, 24
    P.SEG_SCALE = args.seg_scale
    t0 = time.time()
    os.makedirs(PREVIEW, exist_ok=True)
    iw.reset_scene()
    a = iw.Asset(name, seed=seed, scheme=scheme, res=args.res, kind='mech', colors=colors)
    tris = build_fn(a)
    st = a.stats()
    iw.log('model:', st['tris'], 'tris in', st['parts'], 'parts')
    iw.log('parts:', json.dumps(dict(sorted(tris.items(), key=lambda kv: -kv[1]))))
    work = os.path.join(a.work, 'clay')
    if args.blockout:
        sel = args.views.split(',') if args.views else list(clay)
        paths = clay_views(a, os.path.join(work, 'clay'), {k: clay[k] for k in sel})
        contact(paths, os.path.join(work, 'clay_sheet.png'))
        if args.poses:
            pp = []
            for pose in ('crouch', 'walk', 'boost', 'aim_up', 'twist', 'lunge'):
                set_pose(a, POSES[pose])
                pp += clay_views(a, os.path.join(work, f'pose_{pose}'),
                                 {'v': dict(azimuth=-58, elevation=10, lens=45, distance=27, target=(0, -0.3, 4.9))},
                                 res=(640, 360), samples=8)
            contact(pp, os.path.join(work, 'pose_sheet.png'))
            set_pose(a, {})
        iw.log('clay ->', work)
        return
    decal_fn(a)
    unwrap(a, angle=66.0, obj_weight=obj_weight)
    cov, ovl = iw.uv.coverage(a.bake_objects(), 512)
    iw.log(f'uv coverage {cov:.1%}, overlap {ovl:.2%}, texel {a.texel_density:.0f} px/m')
    kw = dict(edge=0.035, cavity=0.085, ao_dist=1.1, bevel_radius=0.016)
    kw.update(bake_kw or {})
    a.bake(weathering=weathering, reuse=args.reuse_bakes, **kw)
    finalize_textures(a, sizes={'orm': args.res // 2, 'emissive': args.res // 2})
    size = a.export_glb(args.out, image_format='JPEG', quality=86, compress=True)
    rep = iw.export.glb_report(args.out)
    missing = [n for n in iw.MECH_NODES if n not in rep['nodes']]
    iw.log('GLB contract nodes:', 'OK' if not missing else f'MISSING {missing}', f'{size / 1e6:.2f} MB')
    fbx = None
    if not args.no_fbx and not args.quick:
        fbx = a.export_fbx()
    previews = []
    if not args.no_render:
        iw.preview.studio(a.parts)
        names = args.views.split(',') if args.views else (['hero', 'back'] if args.quick else list(views))
        for n in names:
            iw.preview.camera(a.parts, **views[n])
            p = os.path.join(PREVIEW, f'{name}_{n}.png')
            iw.preview.render(p, res=(1600, 900) if not args.quick else (1280, 720), samples=args.samples)
            previews.append(p)
    r = a.report({'glb_bytes': size, 'missing_nodes': missing, 'fbx': fbx, 'previews': previews, 'parts_tris': tris,
                  'uv_coverage': round(cov, 3), 'total_s': round(time.time() - t0, 1)})
    with open(os.path.join(ASSETS, name + '_report.json'), 'w') as f:
        json.dump(r, f, indent=1, ensure_ascii=False)
    iw.log('REPORT', json.dumps({k: r[k] for k in ('tris', 'texel_density_px_per_m', 'glb_bytes', 'total_s')}))
