"""iwkit.prims - hard-surface primitives. Every function returns a `Geo`.

Conventions
-----------
* Units are metres. Sizes are full extents (not half extents).
* Round parts are authored along +Z (use geo.align(direction) to aim them).
* `mat=` takes a SEMANTIC material name (see iwkit.materials.PRESETS), e.g.
  'paint_primary', 'paint_secondary', 'paint_accent', 'steel', 'steel_dark', 'chrome',
  'rubber', 'glow', 'lens', 'hazard', 'concrete', 'rust'.
* bevel = geometric bevel width on hard edges (rounded, `segs` segments); chamfer =
  wide flat single-segment cut applied first (the big angular facets).
* Visible round parts default to >= 32 segments; small bolts use fewer.
"""
import math

import bmesh
from mathutils import Matrix, Vector

from .core import RNG, look_rotation, to_matrix
from .geo import Geo, merged

TAU = math.tau

# Global round-part resolution scale (LOD knob). Round parts authored with >= 24 segments
# are scaled but never drop below 24 (the "visible round part" floor); small parts (bolts,
# thin tubes) keep their segment counts.
SEG_SCALE = 1.0


def _segs(n, floor=24):
    if n >= floor:
        return max(floor, int(round(n * SEG_SCALE / 2.0)) * 2)
    return n


# ============================================================================ 2D helpers
def fillet(points, radius, segs=3, closed=True):
    """Round the corners of a 2D polyline. points: [(x, y)] or [(x, y, r)] with a per-corner
    radius (0 keeps the corner sharp). segs=1 gives a flat chamfer."""
    pts = [(p[0], p[1], p[2] if len(p) > 2 else radius) for p in points]
    n = len(pts)
    out = []
    for i in range(n):
        x, y, r = pts[i]
        if (not closed and (i == 0 or i == n - 1)) or r <= 0:
            out.append((x, y))
            continue
        P = Vector((x, y))
        A = Vector(pts[i - 1][:2])
        B = Vector(pts[(i + 1) % n][:2])
        u = A - P
        v = B - P
        lu, lv = u.length, v.length
        if lu < 1e-9 or lv < 1e-9:
            out.append((x, y))
            continue
        u /= lu
        v /= lv
        cosang = max(-1.0, min(1.0, u.dot(v)))
        ang = math.acos(cosang)
        if ang > math.pi - 1e-3:  # straight
            out.append((x, y))
            continue
        d = r / math.tan(ang * 0.5)
        d = min(d, lu * 0.49, lv * 0.49)
        p0 = P + u * d
        p1 = P + v * d
        if segs <= 1:
            out += [tuple(p0), tuple(p1)]
            continue
        # circular arc between p0 and p1 tangent to both edges
        bis = (u + v).normalized()
        rr = d * math.tan(ang * 0.5)
        C = P + bis * math.sqrt(d * d + rr * rr)
        a0 = math.atan2(p0.y - C.y, p0.x - C.x)
        a1 = math.atan2(p1.y - C.y, p1.x - C.x)
        da = a1 - a0
        while da > math.pi:
            da -= TAU
        while da < -math.pi:
            da += TAU
        for k in range(segs + 1):
            a = a0 + da * k / segs
            out.append((C.x + rr * math.cos(a), C.y + rr * math.sin(a)))
    return out


def simplify(pts, tol_deg=2.0, min_len=1e-4):
    """Drop duplicate and collinear points of a closed 2D polygon."""
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > min_len:
            out.append(tuple(p[:2]))
    if len(out) > 1 and (Vector(out[0]) - Vector(out[-1])).length <= min_len:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(len(out)):
            a, b, c = Vector(out[i - 1]), Vector(out[i]), Vector(out[(i + 1) % len(out)])
            u, w = b - a, c - b
            if u.length < min_len or w.length < min_len or abs(u.angle(w)) < math.radians(tol_deg):
                out.pop(i)
                changed = True
                break
    return out


def offset_poly(pts, d):
    """Offset a convex CCW polygon inward by d (negative d = outward)."""
    pts = simplify(pts)
    if poly_area(pts) < 0:
        pts = list(reversed(pts))
    n = len(pts)
    lines = []
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        t = (b - a).normalized()
        nn = Vector((-t.y, t.x))  # inward normal for CCW
        lines.append((a + nn * d, t))
    out = []
    for i in range(n):
        p1, t1 = lines[i - 1]
        p2, t2 = lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-9:
            out.append(tuple(p2))
            continue
        k = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        q = p1 + t1 * k
        out.append((q.x, q.y))
    return out


def rect(w, h, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i][:2]
        x1, y1 = pts[(i + 1) % len(pts)][:2]
        a += x0 * y1 - x1 * y0
    return a * 0.5


# ============================================================================ boxes / prisms
def box(size, bevel=0.012, segs=3, chamfer=0.0, chamfer_axes='XYZ', mat='paint_primary',
        center=(0, 0, 0)):
    """Box of full extents size=(x, y, z). chamfer_axes limits the flat chamfer to edges
    parallel to those axes (e.g. 'Z' = chamfer only the vertical edges)."""
    g = Geo()
    bmesh.ops.create_cube(g.bm, size=1.0)
    g.set_mat(mat)
    g.transform(Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
    if chamfer > 0:
        es = []
        for ax in chamfer_axes:
            es += g.edges_parallel({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[ax])
        g.chamfer(chamfer, edges=list(dict.fromkeys(es)))
    g.bevel(bevel, segs)
    if any(center):
        g.move(center)
    return g


def wedge(w, d, h0, h1, bevel=0.012, segs=3, chamfer=0.0, mat='paint_primary'):
    """Wedge block: width w (X), depth d (Y, from -d/2 to +d/2), height h0 at the front
    (-Y) rising/falling to h1 at the back (+Y); bottom on z=0. Sloped glacis plates,
    ramps, shoulder armour."""
    g = prism([(-d / 2, 0.0), (d / 2, 0.0), (d / 2, h1), (-d / 2, h0)], w, bevel=0.0, mat=mat, axis='X')
    if chamfer > 0:
        g.chamfer(chamfer)
    g.bevel(bevel, segs)
    return g


def frustum(bottom, top, h, shift=(0.0, 0.0), bevel=0.012, segs=3, chamfer=0.0,
            mat='paint_primary'):
    """Tapered box: bottom=(x, y) extents at z=0, top=(x, y) at z=h, top centre offset by shift."""
    bx, by = bottom[0] / 2, bottom[1] / 2
    tx, ty = top[0] / 2, top[1] / 2
    sx, sy = shift
    v = [(-bx, -by, 0), (bx, -by, 0), (bx, by, 0), (-bx, by, 0),
         (sx - tx, sy - ty, h), (sx + tx, sy - ty, h), (sx + tx, sy + ty, h), (sx - tx, sy + ty, h)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    g = Geo.from_pydata(v, f, mat)
    if chamfer > 0:
        g.chamfer(chamfer, edges=g.hard_edges(25, where=lambda e: abs((e.verts[1].co - e.verts[0].co).normalized().z) > 0.5))
    g.bevel(bevel, segs)
    return g


def prism(outline, depth, bevel=0.012, segs=3, mat='paint_primary', axis='Y', taper=0.0,
          centered=True):
    """Extrude a 2D outline [(a, b)] by depth.
    axis='Y': outline is in the XZ plane (a=x, b=z) and extruded along Y (side profiles).
    axis='Z': outline in XY, extruded along Z.   axis='X': outline in YZ, along X.
    taper: shrink the far cap by this fraction (angled side walls)."""
    pts = [(p[0], p[1]) for p in outline]
    if poly_area(pts) < 0:
        pts.reverse()
    n = len(pts)
    d0, d1 = (-depth / 2, depth / 2) if centered else (0.0, depth)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    back = [(p[0], p[1], d0) for p in pts]
    s = 1.0 - taper
    front = [(cx + (p[0] - cx) * s, cy + (p[1] - cy) * s, d1) for p in pts]
    verts = back + front
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    g = Geo.from_pydata(verts, faces, mat)
    # local (a, b, depth) -> world axes
    if axis == 'Y':
        M = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # a->x, b->z, d->-y
    elif axis == 'X':
        M = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # a->y, b->z, d->x
    else:
        M = Matrix.Identity(4)
    g.transform(M)
    g.bevel(bevel, segs)
    return g


def loft(sections, bevel=0.012, segs=3, mat='paint_primary', axis='Y', caps=True, corner=None, corner_segs=1):
    """Loft closed 2D outlines placed along an axis -> armour shells, tapered housings.
    sections: [(outline, t), ...] where outline = [(a, b)...] (same point count in every
    section) and t is the position along `axis`.
    axis='Y': a=x, b=z (cross-sections of a limb pointing along Y).
    axis='X': a=y, b=z.   axis='Z': a=x, b=y.
    corner: optional per-outline fillet radius (or per-point via (a, b, r) points) applied
    to every section first (corner_segs=1 -> chamfers)."""
    outs = []
    for ol, t in sections:
        o = fillet(ol, corner, corner_segs, closed=True) if corner is not None else [(p[0], p[1]) for p in ol]
        if poly_area(o) < 0:
            o = list(reversed(o))
        outs.append((o, t))
    n = len(outs[0][0])
    assert all(len(o) == n for o, _ in outs), 'loft: sections need equal point counts'

    def P3(a, b, t):
        if axis == 'Y':
            return (a, t, b)
        if axis == 'X':
            return (t, a, b)
        return (a, b, t)
    verts = []
    for o, t in outs:
        verts += [P3(a, b, t) for a, b in o]
    faces = []
    for k in range(len(outs) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
    if caps:
        faces.append(tuple(reversed(range(n))))
        faces.append(tuple(range((len(outs) - 1) * n, len(outs) * n)))
    g = Geo.from_pydata(verts, faces, mat)
    g.fix_normals()
    g.bevel(bevel, segs)
    return g


def plate(outline, thickness, taper=None, ridge=0.0, ridge_axis='X', bevel=0.006, segs=2, mat='paint_primary',
          inset=None):
    """Armour plate: 2D outline in XY (z=0 is the back), thickness along +Z. The top face
    is inset uniformly by `inset` metres (default 0.8 x thickness -> crisp ~40 deg edge
    facets; `taper` is accepted for compatibility as a fraction of the thickness).
    ridge: raises a crisp crease line across the top through the centre, running along
    ridge_axis ('X' or 'Y')."""
    pts = simplify([(p[0], p[1]) for p in outline])
    if poly_area(pts) < 0:
        pts.reverse()
    if inset is None:
        inset = thickness * (0.8 if taper is None else max(0.0, taper) * 6.0)
    minw = min((Vector(pts[i]) - Vector(pts[(i + 2) % len(pts)])).length for i in range(len(pts)))
    inset = min(inset, minw * 0.2)
    top = offset_poly(pts, inset) if inset > 1e-5 else pts
    n = len(pts)
    verts = [(x, y, 0.0) for x, y in pts] + [(x, y, thickness) for x, y in top]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    g = Geo.from_pydata(verts, faces, mat)
    if ridge > 0:
        topf = g.faces_facing((0, 0, 1), 3)
        if topf:
            cx = sum(p[0] for p in top) / n
            cy = sum(p[1] for p in top) / n
            no = (0, 1, 0) if ridge_axis == 'X' else (1, 0, 0)
            faces_, edges, verts_ = g._region(topf)
            r = bmesh.ops.bisect_plane(g.bm, geom=faces_ + edges + verts_, dist=1e-6, plane_co=(cx, cy, 0), plane_no=no)
            for gg in r['geom_cut']:
                if isinstance(gg, bmesh.types.BMVert) and gg.co.z > thickness - 1e-4:
                    gg.co.z += ridge
    g.bm.normal_update()
    g.bevel(bevel, segs, min_angle=6.0)
    return g
def armor_on_face(geo, face, margin=0.03, thickness=0.03, gap=0.004, inset=None, ridge=0.0, ridge_axis='X',
                  chamfer=0.0, bevel=0.005, segs=2, mat='paint_primary', u_axis=None, outline=None, bolts=0,
                  bolt_r=0.012, bolt_inset=None, bolt_spacing=0.16, taper=None):
    """Layered armour: a separate plate (real thickness, crisp inset edge facets, optional
    ridge) following the outline of a planar `face` of `geo`, shrunk by `margin` and
    floating `gap` above it. Returns the plate Geo (not merged).
    outline: optional custom 2D outline in the face's (u, v) frame (see Geo.face_frame).
    bolts: 0 = none, 1 = bolts along edges longer than 2*bolt_spacing (~bolt_spacing apart)."""
    o, u, v, n, pts = geo.face_frame(face, u_axis)
    ol = outline or offset_poly(pts, margin)
    if chamfer > 0:
        ol = fillet(ol, chamfer, 1)
    ins = thickness * 0.8 if inset is None else inset
    g = plate(ol, thickness, ridge=ridge, ridge_axis=ridge_axis, bevel=bevel, segs=segs, mat=mat, inset=ins)
    if bolts:
        bi = bolt_inset if bolt_inset is not None else ins + bolt_r * 2.2
        corners = offset_poly(simplify(ol), bi)
        for i in range(len(corners)):
            a, b = corners[i], corners[(i + 1) % len(corners)]
            L = (Vector(b) - Vector(a)).length
            if L < bolt_spacing * 1.6:
                continue
            k = max(2, int(round(L / bolt_spacing)) + 1)
            g.merge(bolt_row((a[0], a[1], thickness), (b[0], b[1], thickness), k, (0, 0, 1), r=bolt_r))
    M = Matrix((
        (u.x, v.x, n.x, o.x + n.x * gap),
        (u.y, v.y, n.y, o.y + n.y * gap),
        (u.z, v.z, n.z, o.z + n.z * gap),
        (0, 0, 0, 1)))
    g.transform(M)
    return g
def banded_cylinder(bands, segs=48, step=0.006, mat='paint_dark', cap=True):
    """Lathe a drum from contiguous bands [(length, radius[, mat]), ...] along +Z from
    z=0. Steps between bands get small chamfers (`step`) -> actuator drums, hubs,
    sleeves, power cells. A band's optional 3rd item overrides its material."""
    z = 0.0
    pts = [(0.0, 0.0, 0.0)] if cap else []
    for b in bands:
        L, r = b[0], b[1]
        pts.append((r, z, step))
        pts.append((r, z + L, step))
        z += L
    if cap:
        pts.append((0.0, z, 0.0))
    prof = fillet(pts, step, 1, closed=False)
    clean = [prof[0]]
    for q in prof[1:]:
        if abs(q[0] - clean[-1][0]) > 1e-7 or abs(q[1] - clean[-1][1]) > 1e-7:
            clean.append(q)
    g = lathe(clean, segs, mat)
    z = 0.0
    for b in bands:
        L, r = b[0], b[1]
        if len(b) > 2 and b[2]:
            mi = g.mi(b[2])
            for f in g.bm.faces:
                c = f.calc_center_median()
                if z + step * 0.5 <= c.z <= z + L - step * 0.5 and math.hypot(c.x, c.y) > r - step * 1.5:
                    f.material_index = mi
        z += L
    return g


# ============================================================================ lathe family
def lathe(profile, segs=32, mat='steel', smooth_caps=False, phase=0.0):
    """Revolve a (r, z) profile around +Z. Give the profile counter-clockwise in the
    (r, z) half plane (e.g. bottom-centre -> bottom-rim -> top-rim -> top-centre) for
    outward normals. Points with r == 0 become poles."""
    g = Geo()
    bm = g.bm
    idx = g.mi(mat)
    segs = _segs(segs)
    angs = [phase + TAU * i / segs for i in range(segs)]
    rings = []
    for (r, z) in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angs])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(A) == 1:
                vs = [A[0], B[j2], B[j]]
            elif len(B) == 1:
                vs = [A[j], A[j2], B[0]]
            else:
                vs = [A[j], A[j2], B[j2], B[j]]
            try:
                f = bm.faces.new(vs)
                f.material_index = idx
            except ValueError:
                pass
    bm.normal_update()
    return g


def cylinder(r, h, segs=32, bevel=0.01, bsegs=3, mat='steel', cap=True, z0=None):
    """Solid cylinder along +Z (centred unless z0 given), rounded cap edges."""
    z0 = -h / 2 if z0 is None else z0
    z1 = z0 + h
    b = min(bevel, r * 0.45, h * 0.45)
    prof = []
    if cap:
        prof.append((0.0, z0))
    prof += fillet([(0.0, z0, 0), (r, z0, b), (r, z1, b), (0.0, z1, 0)], b, bsegs, closed=False)[1:-1]
    if cap:
        prof.append((0.0, z1))
    return lathe(prof, segs, mat)


def ring(r_out, r_in, h, segs=32, bevel=0.006, bsegs=2, mat='steel_dark', z0=None):
    """Thick washer / collar (hollow cylinder) along +Z."""
    z0 = -h / 2 if z0 is None else z0
    z1 = z0 + h
    b = min(bevel, (r_out - r_in) * 0.4, h * 0.4)
    # CCW in (r, z): inner bottom -> outer bottom -> outer top -> inner top -> back to start
    pts = [(r_in, z0, b), (r_out, z0, b), (r_out, z1, b), (r_in, z1, b)]
    prof = fillet(pts, b, bsegs, closed=True)
    prof.append(prof[0])
    g = lathe(prof, segs, mat)
    bmesh.ops.remove_doubles(g.bm, verts=list(g.bm.verts), dist=1e-6)
    return g


def cone(r0, r1, h, segs=32, bevel=0.008, bsegs=2, mat='steel', cap=True):
    """Truncated cone along +Z from radius r0 at z=0 to r1 at z=h."""
    b = min(bevel, h * 0.4, max(r0, r1) * 0.4)
    prof = [(0.0, 0.0)] if cap else []
    prof += fillet([(0.0, 0.0, 0), (r0, 0.0, b), (r1, h, b), (0.0, h, 0)], b, bsegs, closed=False)[1:-1]
    if cap:
        prof.append((0.0, h))
    return lathe(prof, segs, mat)


def dome(r, h=None, segs=32, rings=8, mat='steel', base=True):
    """Half-ellipsoid dome on z=0 (lens caps, rivet heads, sensor bulbs)."""
    h = r if h is None else h
    prof = [(0.0, 0.0)] if base else []
    for i in range(rings + 1):
        a = (math.pi / 2) * i / rings
        prof.append((r * math.cos(a), h * math.sin(a)))
    prof[-1] = (0.0, h)
    return lathe(prof, segs, mat)


def torus(R, r, segs=32, tsegs=12, mat='steel_dark', arc=TAU):
    """Torus in the XY plane (shackle rings, hose loops)."""
    pts = [(R * math.cos(arc * i / segs), R * math.sin(arc * i / segs), 0.0) for i in range(segs + (0 if arc >= TAU - 1e-6 else 1))]
    return sweep(pts, r, tsegs, closed=arc >= TAU - 1e-6, caps=arc < TAU - 1e-6, mat=mat, smooth_path=False)


# ============================================================================ sweeps / cables
def _catmull(points, subdiv):
    P = [Vector(p) for p in points]
    if len(P) < 3 or subdiv <= 1:
        return P
    out = []
    ext = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(subdiv):
            t = k / subdiv
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def sweep(points, radius, segs=12, closed=False, caps=True, mat='rubber', smooth_path=True,
          subdiv=6, rib_amp=0.0, rib_freq=0.0, radius_fn=None):
    """Sweep a circle along a 3D path (parallel-transport frames, no twisting).
    smooth_path: Catmull-Rom through the points. rib_amp/rib_freq: corrugated hose
    (radius wobble, rib_freq ribs per metre). radius_fn(t)->r overrides radius (t in 0..1)."""
    P = _catmull(points, subdiv) if (smooth_path and not closed) else [Vector(p) for p in points]
    n = len(P)
    if n < 2:
        return Geo()
    # tangents
    T = []
    for i in range(n):
        if closed:
            d = P[(i + 1) % n] - P[i - 1]
        elif i == 0:
            d = P[1] - P[0]
        elif i == n - 1:
            d = P[-1] - P[-2]
        else:
            d = P[i + 1] - P[i - 1]
        T.append(d.normalized())
    # initial normal
    t0 = T[0]
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    N = [(ref - t0 * ref.dot(t0)).normalized()]
    for i in range(1, n):
        b = T[i - 1].cross(T[i])
        nprev = N[-1]
        if b.length < 1e-9:
            N.append(nprev.copy())
        else:
            ang = math.acos(max(-1.0, min(1.0, T[i - 1].dot(T[i]))))
            N.append(Matrix.Rotation(ang, 3, b.normalized()) @ nprev)
    # arc length for ribs / radius_fn
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + (P[i] - P[i - 1]).length)
    total = L[-1] or 1.0
    g = Geo()
    bm = g.bm
    idx = g.mi(mat)
    segs = _segs(segs, 12)
    rings = []
    for i in range(n):
        r = radius_fn(L[i] / total) if radius_fn else radius
        if rib_amp and rib_freq:
            r += rib_amp * (0.5 + 0.5 * math.cos(TAU * rib_freq * L[i]))
        Bn = T[i].cross(N[i])
        ringv = []
        for k in range(segs):
            a = TAU * k / segs
            off = N[i] * math.cos(a) * r + Bn * math.sin(a) * r
            ringv.append(bm.verts.new(P[i] + off))
        rings.append(ringv)
    m = n if closed else n - 1
    for i in range(m):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            k2 = (k + 1) % segs
            try:
                f = bm.faces.new((A[k], A[k2], B[k2], B[k]))
                f.material_index = idx
            except ValueError:
                pass
    if caps and not closed:
        for ringv, rev in ((rings[0], True), (rings[-1], False)):
            try:
                f = bm.faces.new(list(reversed(ringv)) if rev else ringv)
                f.material_index = idx
            except ValueError:
                pass
    bm.normal_update()
    return g


def cable(p0, p1, sag=0.15, radius=0.025, segs=10, mat='rubber', rib_amp=0.0, rib_freq=0.0,
          n=12, via=None):
    """Hanging cable/hose between two points (parabolic sag, optional via points)."""
    p0, p1 = Vector(p0), Vector(p1)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    if via:
        pts = [p0] + [Vector(v) for v in via] + [p1]
    return sweep(pts, radius, segs, mat=mat, rib_amp=rib_amp, rib_freq=rib_freq, subdiv=4)


def hose(points, radius=0.035, segs=14, mat='rubber', rib_amp=0.004, rib_freq=28.0, fittings=True,
         fitting_mat='steel'):
    """Corrugated hydraulic hose along points with crimped metal fittings at both ends."""
    g = sweep(points, radius, segs, mat=mat, rib_amp=rib_amp, rib_freq=rib_freq, subdiv=6)
    if fittings:
        P = [Vector(p) for p in points]
        for a, b in ((P[0], P[1]), (P[-1], P[-2])):
            d = (b - a).normalized()
            fit = cylinder(radius * 1.45, radius * 3.0, 16, bevel=radius * 0.2, mat=fitting_mat, z0=0.0)
            fit.merge(cylinder(radius * 1.7, radius * 0.9, 6, bevel=radius * 0.1, mat=fitting_mat, z0=-radius * 0.2))
            fit.align(d, loc=a)
            g.merge(fit)
    return g


# ============================================================================ fasteners
def bolt(r=0.02, kind='hex', mat='steel', washer=True, nub=False):
    """Bolt head sitting on z=0 facing +Z. kind: 'hex' | 'dome' | 'socket' | 'flat'.
    Kept cheap (~50-90 tris after hidden-face culling); the baked bevel normal rounds
    the small edges. nub=True adds the threaded stub on top of a hex head."""
    h = r * 0.7
    g = Geo()
    if washer:
        g.merge(cylinder(r * 1.45, r * 0.18, 10, bevel=0.0, mat=mat, z0=0.0))
    z = r * 0.18 if washer else 0.0
    if kind == 'hex':
        g.merge(cylinder(r, h, 6, bevel=r * 0.14, bsegs=1, mat=mat, z0=z))
        if nub:
            g.merge(cylinder(r * 0.45, r * 0.3, 8, bevel=0.0, mat=mat, z0=z + h * 0.98))
    elif kind == 'dome':
        g.merge(dome(r, r * 0.55, 10, 3, mat=mat).move(0, 0, z))
    elif kind == 'socket':
        g.merge(cylinder(r, h * 0.9, 10, bevel=r * 0.15, bsegs=1, mat=mat, z0=z))
    else:
        g.merge(cylinder(r, h * 0.35, 10, bevel=0.0, mat=mat, z0=z))
    return g


def _frame(normal, up=None):
    n = Vector(normal).normalized()
    if up is None:
        up = (0, 0, 1) if abs(n.z) < 0.9 else (0, 1, 0)
    return look_rotation(n, up).to_4x4()


def bolt_row(p0, p1, count, normal=(0, 0, 1), r=0.018, kind='hex', mat='steel', washer=True,
             inset=0.0):
    """`count` bolts evenly from p0 to p1, heads facing `normal`."""
    p0, p1 = Vector(p0), Vector(p1)
    proto = bolt(r, kind, mat, washer)
    R = _frame(normal)
    g = Geo()
    for i in range(count):
        t = 0.5 if count == 1 else i / (count - 1)
        p = p0.lerp(p1, t) - Vector(normal).normalized() * inset
        g.merge(proto, M=Matrix.Translation(p) @ R)
    return g


def bolt_circle(center, normal, radius, count, r=0.018, kind='hex', mat='steel', phase=0.0,
                washer=True):
    proto = bolt(r, kind, mat, washer)
    R = _frame(normal)
    g = Geo()
    for i in range(count):
        a = phase + TAU * i / count
        local = Vector((math.cos(a) * radius, math.sin(a) * radius, 0.0))
        g.merge(proto, M=Matrix.Translation(Vector(center)) @ R @ Matrix.Translation(local))
    return g


def rivet_grid(origin, u, v, nu, nv, normal, r=0.01, mat='steel'):
    proto = bolt(r, 'dome', mat, washer=False)
    R = _frame(normal)
    g = Geo()
    o, u, v = Vector(origin), Vector(u), Vector(v)
    for i in range(nu):
        for j in range(nv):
            p = o + u * (i / max(1, nu - 1)) + v * (j / max(1, nv - 1))
            g.merge(proto, M=Matrix.Translation(p) @ R)
    return g


# ============================================================================ mechanical
def piston(p0, p1, r_sleeve=0.07, r_rod=None, sleeve_frac=0.55, up=(0, 0, 1), segs=32,
           sleeve_mat='steel_dark', rod_mat='chrome', eye_mat='steel_dark', eyes=True, boot=True):
    """Hydraulic ram from p0 (sleeve end) to p1 (rod end): barrel with end cap and port,
    chrome rod, seal gland, clevis eyes with pins at both ends. `up` sets the pin axis
    hint (pins are perpendicular to the ram, roughly along `up` x ram)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    r_rod = r_rod or r_sleeve * 0.5
    eye_r = r_sleeve * 0.95
    e_off = eye_r * 1.25 if eyes else 0.0
    ls = (L - 2 * e_off) * sleeve_frac
    g = Geo()
    z_a = e_off
    # barrel: cap -> body -> gland
    prof = fillet([(0.0, z_a, 0), (r_sleeve * 0.92, z_a, r_sleeve * 0.2), (r_sleeve * 0.92, z_a + r_sleeve * 0.35, 0),
                   (r_sleeve, z_a + r_sleeve * 0.45, r_sleeve * 0.05), (r_sleeve, z_a + ls - r_sleeve * 0.5, r_sleeve * 0.05),
                   (r_sleeve * 1.12, z_a + ls - r_sleeve * 0.45, r_sleeve * 0.05), (r_sleeve * 1.12, z_a + ls, r_sleeve * 0.08),
                   (r_rod * 1.25, z_a + ls, r_rod * 0.15), (r_rod * 1.25, z_a + ls + r_sleeve * 0.25, 0), (0.0, z_a + ls + r_sleeve * 0.25, 0)],
                  0.0, 2, closed=False)
    g.merge(lathe(prof, segs, sleeve_mat))
    # rod
    g.merge(cylinder(r_rod, (L - e_off) - (z_a + ls) + r_rod, max(24, segs - 8), bevel=r_rod * 0.2, mat=rod_mat,
                     z0=z_a + ls))
    if boot:
        g.merge(ring(r_rod * 1.35, r_rod * 0.9, r_sleeve * 0.18, segs, mat='rubber', z0=z_a + ls + r_sleeve * 0.25))
    # hydraulic port on the barrel
    port = cylinder(r_sleeve * 0.22, r_sleeve * 0.5, 12, bevel=r_sleeve * 0.04, mat='steel', z0=0.0)
    port.rotate((90, 0, 0)).move(0, -r_sleeve * 0.85, z_a + r_sleeve * 0.9)
    g.merge(port)
    if eyes:
        for z, mat in ((0.0, eye_mat), (L, eye_mat)):
            eye = cylinder(eye_r, eye_r * 1.2, segs, bevel=eye_r * 0.12, mat=mat)
            eye.rotate((0, 90, 0))
            neck = box((eye_r * 1.15, eye_r * 1.2, e_off), bevel=eye_r * 0.08, segs=2, mat=mat)
            neck.move(0, 0, e_off * 0.5 if z == 0.0 else -e_off * 0.5)
            pin = cylinder(eye_r * 0.42, eye_r * 1.6, 16, bevel=eye_r * 0.06, mat='steel')
            pin.rotate((0, 90, 0))
            e = merged(eye, neck, pin)
            e.move(0, 0, z)
            g.merge(e)
    # orient +Z -> d, with pin axis (local X) ~ perpendicular to up
    R = look_rotation(d, up).to_4x4()
    g.transform(Matrix.Translation(p0) @ R)
    return g


def nozzle(r_throat=0.12, r_exit=0.22, length=0.35, segs=40, wall=0.018, mat='steel_dark',
           inner_mat='nozzle_inner', glow_mat='glow', collar=True, collar_mat='steel',
           petals=0, bolts=12, ribs=0, rib_mat='steel', gimbal=False, gimbal_mat='steel_dark'):
    """Thruster bell pointing down -Z (exhaust leaves through -Z). The bell has real wall
    thickness, a rolled lip, burnt inner surface and an emissive disc deep in the throat.
    The mounting face (top of the collar stack) is at z=+0.11; the bell starts at z=0."""
    g = Geo()
    L = length
    n = 9
    inner = []
    outer = []
    for i in range(n + 1):
        t = i / n
        r = r_throat + (r_exit - r_throat) * (t ** 1.6)
        inner.append((r, -L * t))
        outer.append((r + wall * (1.0 + 0.6 * (1 - t)), -L * t))
    rc, zc, rl = r_exit + wall * 0.5, -L, wall * 0.5
    lip = [(rc + rl * math.cos(math.pi + math.pi * k / 6), zc + rl * math.sin(math.pi + math.pi * k / 6))
           for k in range(1, 6)]
    # CCW in (r, z): inner wall top->bottom, rolled lip, outer wall bottom->top, top annulus inward
    shell = inner + lip + list(reversed(outer))
    shell.append(inner[0])
    bell = lathe(shell, segs, mat)
    bmesh.ops.remove_doubles(bell.bm, verts=list(bell.bm.verts), dist=1e-6)
    bell.bm.normal_update()
    for f in bell.bm.faces:
        c = f.calc_center_median()
        radial = Vector((c.x, c.y, 0.0))
        if radial.length > 1e-6 and f.normal.dot(radial.normalized()) < -0.2:
            f.material_index = bell.mi(inner_mat)
    g.merge(bell)
    # glowing throat disc (slightly recessed) + dark injector cone poking through it
    g.merge(cylinder(r_throat * 1.0, 0.012, segs, bevel=0.002, bsegs=1, mat=glow_mat, z0=-0.035))
    g.merge(cone(r_throat * 0.3, r_throat * 0.06, L * 0.16, 24, bevel=0.003, mat='steel_dark')
            .rotate((180, 0, 0)).move(0, 0, -0.03))
    if collar:
        ro = r_throat + wall * 1.6
        g.merge(ring(ro + 0.045, r_throat * 0.7, 0.05, segs, bevel=0.008, bsegs=1, mat=collar_mat, z0=0.0))
        g.merge(ring(ro + 0.02, r_throat * 0.7, 0.06, segs, bevel=0.006, bsegs=1, mat='steel_dark', z0=0.05))
        if bolts:
            g.merge(bolt_circle((0, 0, 0.05), (0, 0, 1), ro + 0.032, bolts, r=0.009, kind='hex'))
    for k in range(ribs):
        t = (k + 1) / (ribs + 1) * 0.85
        r = r_throat + (r_exit - r_throat) * (t ** 1.6) + wall * (1.0 + 0.6 * (1 - t))
        g.merge(ring(r + 0.008, r - 0.004, 0.012, segs, bevel=0.0025, bsegs=1, mat=rib_mat, z0=-L * t - 0.006))
    if gimbal:
        ro = r_throat + wall * 1.6 + 0.045
        g.merge(ring(ro + 0.03, ro + 0.004, 0.035, segs, bevel=0.006, mat=gimbal_mat, z0=-0.02))
        for a in (0.0, math.pi):
            lug = box((0.05, 0.05, 0.07), bevel=0.006, segs=2, mat=gimbal_mat)
            lug.move(math.cos(a) * (ro + 0.04), math.sin(a) * (ro + 0.04), 0.0)
            g.merge(lug)
            pin = cylinder(0.018, 0.07, 16, bevel=0.003, mat='steel').rotate((0, 90, 0))
            pin.transform(Matrix.Rotation(a, 4, 'Z'))
            pin.move(math.cos(a) * (ro + 0.06), math.sin(a) * (ro + 0.06), 0.0)
            g.merge(pin)
    if petals:
        for i in range(petals):
            a = TAU * i / petals
            fin = box((0.01, wall * 2.0, L * 0.5), bevel=0.003, segs=1, mat=mat)
            rr = r_throat + (r_exit - r_throat) * 0.35 + wall * 2.2
            fin.transform(Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, -L * 0.3)) @ Matrix.Rotation(a, 4, 'Z'))
            g.merge(fin)
    return g


def vent(w, h, depth=0.05, slats=7, angle=35.0, frame=0.035, mat='paint_primary',
         slat_mat='steel_dark', back_mat='steel_dark', bevel=0.008, thickness=None):
    """Louvred vent block: a framed box (w x h face on +Z, `depth` deep below) with angled
    slats inside the recess. Face centre at origin, face normal +Z."""
    t = thickness or depth + 0.03
    g = box((w, h, t), bevel=bevel, segs=3, mat=mat)
    g.move(0, 0, -t / 2)
    top = g.faces_facing((0, 0, 1), 5)
    g.recess(top, frame, depth, floor_mat=back_mat, wall_mat=back_mat)
    inner_w = w - 2 * frame - 0.004
    inner_h = h - 2 * frame
    pitch = inner_h / slats
    for i in range(slats):
        y = -inner_h / 2 + pitch * (i + 0.5)
        s = box((inner_w, pitch * 1.15, 0.008), bevel=0.002, segs=1, mat=slat_mat)
        s.rotate((angle, 0, 0)).move(0, y, -depth * 0.45)
        g.merge(s)
    return g


def grille(w, h, bars=9, bar_r=0.008, frame=0.03, depth=0.04, mat='paint_primary', bar_mat='steel_dark',
           back_mat='steel_dark', horizontal=False):
    """Recessed frame with round bars (intake grille). Face centre at origin, normal +Z."""
    t = depth + 0.03
    g = box((w, h, t), bevel=0.008, segs=3, mat=mat).move(0, 0, -t / 2)
    g.recess(g.faces_facing((0, 0, 1), 5), frame, depth, floor_mat=back_mat, wall_mat=back_mat)
    iw, ih = w - 2 * frame, h - 2 * frame
    for i in range(bars):
        f = (i + 0.5) / bars
        if horizontal:
            b = cylinder(bar_r, iw, 12, bevel=0.0, mat=bar_mat).rotate((0, 90, 0)).move(0, -ih / 2 + ih * f, -depth * 0.35)
        else:
            b = cylinder(bar_r, ih, 12, bevel=0.0, mat=bar_mat).rotate((90, 0, 0)).move(-iw / 2 + iw * f, 0, -depth * 0.35)
        g.merge(b)
    return g


def louvres(w, h, count=5, depth=0.06, angle=28.0, thickness=0.018, mat='steel_dark', side_plates=True,
            side_mat='paint_primary'):
    """Heat-shield louvre stack (stand-off slats with side brackets). Centre at origin,
    slats face +Z, stacked along Y."""
    g = Geo()
    pitch = h / count
    for i in range(count):
        y = -h / 2 + pitch * (i + 0.5)
        s = box((w, pitch * 1.25, thickness), bevel=0.004, segs=2, mat=mat)
        s.rotate((-angle, 0, 0)).move(0, y, depth)
        g.merge(s)
    if side_plates:
        for x in (-w / 2 - 0.012, w / 2 + 0.012):
            sp = box((0.02, h + 0.02, depth * 1.7), bevel=0.004, segs=2, mat=side_mat)
            sp.move(x, 0, depth * 0.85)
            g.merge(sp)
    return g


def antenna(length=0.8, r=0.008, base_r=0.035, mat='steel_dark', tip_mat='paint_accent', segs=12):
    """Whip antenna on +Z: threaded base, spring coil section, rod, tip ball."""
    g = Geo()
    g.merge(cylinder(base_r, base_r * 1.2, 24, bevel=base_r * 0.15, mat=mat, z0=0.0))
    g.merge(cone(base_r * 0.8, r * 2.2, base_r * 1.6, 24, bevel=0.003, mat=mat).move(0, 0, base_r * 1.2))
    z = base_r * 2.8
    g.merge(cylinder(r * 1.8, 0.05, 12, bevel=0.002, mat='rubber', z0=z))
    g.merge(cylinder(r, length, segs, bevel=0.0, mat=mat, z0=z + 0.05))
    g.merge(dome(r * 2.2, r * 2.2, 12, 4, mat=tip_mat).move(0, 0, z + 0.05 + length))
    g.merge(dome(r * 2.2, r * 2.2, 12, 4, mat=tip_mat).rotate((180, 0, 0)).move(0, 0, z + 0.05 + length + 0.001))
    return g


def sensor_cluster(w=0.36, h=0.16, depth=0.14, lenses=((-0.09, 0.0, 0.035), (0.0, 0.0, 0.05), (0.09, 0.0, 0.028)),
                   slit=True, mat='steel_dark', lens_mat='lens', ring_mat='steel', hood=True):
    """Camera/sensor housing facing -Y: box body with a recessed face, round lenses with
    bezel rings (emissive glass), optional horizontal sensor slit and a sun hood.
    Origin = centre of the front face."""
    g = box((w, depth, h), bevel=0.012, segs=3, chamfer=0.018, chamfer_axes='X', mat=mat).move(0, depth / 2, 0)
    front = g.faces_facing((0, -1, 0), 5)
    floor = g.recess(front, 0.014, 0.018, floor_mat='steel_dark', wall_mat='steel_dark')
    z_face = -0.0 + 0.018  # floor is 18 mm behind the front plane (at y=+0.018)
    for (x, z, r) in lenses:
        bez = ring(r * 1.35, r * 0.92, 0.03, 32, bevel=0.004, bsegs=1, mat=ring_mat, z0=0.0)
        lens = dome(r, r * 0.45, 32, 4, mat=lens_mat)
        inner = cylinder(r * 0.95, 0.012, 32, bevel=0.0, mat='steel_dark', z0=-0.012)
        comp = merged(bez, lens, inner)
        comp.transform(Matrix.Translation((x, z_face, z)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
        g.merge(comp)
    if slit:
        s = box((w * 0.82, 0.012, h * 0.1), bevel=0.002, segs=1, mat=lens_mat).move(0, z_face - 0.004, -h * 0.34)
        g.merge(s)
    if hood:
        hd = box((w * 1.04, depth * 0.45, 0.018), bevel=0.004, segs=2, mat=mat)
        hd.rotate((-8, 0, 0)).move(0, -depth * 0.12, h / 2 + 0.006)
        g.merge(hd)
    return g


def shackle(r=0.06, bar=0.016, mat='steel_dark', base_mat='paint_primary'):
    """Lifting eye / tow shackle on a welded base plate (z=0 up). Construction-machinery greeble."""
    g = Geo()
    base = box((r * 2.6, r * 1.5, 0.02), bevel=0.004, segs=2, mat=base_mat).move(0, 0, 0.01)
    lug = prism(fillet([(-r * 0.9, 0), (r * 0.9, 0), (r * 0.9, r * 1.1), (0, r * 1.9), (-r * 0.9, r * 1.1)], r * 0.3, 3),
                0.035, bevel=0.004, segs=2, mat=base_mat, axis='Y').move(0, 0, 0.02)
    hole = cylinder(r * 0.42, 0.1, 24, bevel=0.0, mat='steel_dark').rotate((90, 0, 0)).move(0, 0, 0.02 + r * 1.1)
    lug.boolean(hole)
    loop = torus(r * 0.75, bar, 32, 10, mat=mat)
    loop.rotate((0, 90, 0)).move(0, 0, 0.02 + r * 1.1 + r * 0.65)
    g.merge(base, lug, loop)
    return g


# ============================================================================ environment kit
def pipe_run(points, r=0.08, bend=0.25, segs=24, mat='steel', flanges=True, flange_mat='steel_dark',
             flange_every=0.0):
    """Rigid pipe through polyline points with radiused elbows and bolted flanges."""
    P = [Vector(p) for p in points]
    path = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        u = (a - b).normalized()
        v = (c - b).normalized()
        ang = math.acos(max(-1.0, min(1.0, u.dot(v))))
        if ang > math.pi - 1e-3:
            path.append(b)
            continue
        d = min(bend / math.tan(ang / 2), (a - b).length * 0.45, (c - b).length * 0.45)
        p0, p1 = b + u * d, b + v * d
        for k in range(9):
            t = k / 8
            q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p1
            path.append(q)
    path.append(P[-1])
    g = sweep(path, r, segs, mat=mat, smooth_path=False, caps=True)
    if flanges:
        ends = [(P[0], (P[1] - P[0]).normalized()), (P[-1], (P[-2] - P[-1]).normalized())]
        if flange_every > 0:
            for i in range(len(P) - 1):
                seg = P[i + 1] - P[i]
                n = int(seg.length // flange_every)
                for k in range(1, n):
                    ends.append((P[i] + seg * (k / n), seg.normalized()))
        for p, d in ends:
            fl = cylinder(r * 1.55, r * 0.35, segs, bevel=r * 0.06, mat=flange_mat)
            fl.merge(bolt_circle((0, 0, r * 0.175), (0, 0, 1), r * 1.3, 8, r=r * 0.12))
            fl.align(d, loc=p)
            g.merge(fl)
    return g


def girder_i(length, h=0.4, w=0.25, web=0.018, flange=0.024, mat='steel', bevel=0.004, axis='X'):
    """I-beam along +X (or axis='Y'/'Z'), centred."""
    hw, hh = w / 2, h / 2
    wb, fl = web / 2, flange
    outline = [(-hw, -hh), (hw, -hh), (hw, -hh + fl), (wb, -hh + fl), (wb, hh - fl), (hw, hh - fl), (hw, hh),
               (-hw, hh), (-hw, hh - fl), (-wb, hh - fl), (-wb, -hh + fl), (-hw, -hh + fl)]
    g = prism(outline, length, bevel=bevel, segs=2, mat=mat, axis='Z')
    if axis == 'X':
        g.rotate((0, 90, 0))
    elif axis == 'Y':
        g.rotate((90, 0, 0))
    return g


def truss(length, height=1.0, depth=1.0, bays=6, chord=0.09, member=0.05, mat='steel', axis='X',
          box_section=True):
    """Box truss along +X from 0..length: 4 chords, verticals and alternating diagonals
    on each side face (crane jibs, conveyor bridges, gantry legs)."""
    g = Geo()
    hy, hz = depth / 2, height / 2
    corners = [(-hy, -hz), (hy, -hz), (hy, hz), (-hy, hz)] if box_section else [(-hy, -hz), (hy, -hz), (0, hz)]
    for (y, z) in corners:
        g.merge(box((length, chord, chord), bevel=0.006, segs=2, mat=mat).move(length / 2, y, z))
    bay = length / bays
    nc = len(corners)
    for i in range(bays + 1):
        x = i * bay
        for k in range(nc):
            a = Vector((x, *corners[k]))
            b = Vector((x, *corners[(k + 1) % nc]))
            g.merge(_strut(a, b, member, mat))
        if i < bays:
            for k in range(nc):
                y0, z0 = corners[k]
                y1, z1 = corners[(k + 1) % nc]
                if i % 2 == 0:
                    a, b = Vector((x, y0, z0)), Vector((x + bay, y1, z1))
                else:
                    a, b = Vector((x, y1, z1)), Vector((x + bay, y0, z0))
                g.merge(_strut(a, b, member * 0.85, mat))
    if axis == 'Y':
        g.rotate((0, 0, 90))
    elif axis == 'Z':
        g.rotate((0, -90, 0))
    return g


def _strut(a, b, s, mat, bevel=0.004):
    a, b = Vector(a), Vector(b)
    d = b - a
    st = box((s, s, d.length), bevel=bevel, segs=1, mat=mat)
    st.align(d, loc=(a + b) * 0.5)
    return st


def handrail(points, height=1.1, post_every=1.5, r=0.025, mat='hazard', post_mat='paint_secondary', mid=True,
             toe_board=True):
    """Handrail along a polyline on the ground (z of points = walkway level)."""
    P = [Vector(p) for p in points]
    g = Geo()
    top = [p + Vector((0, 0, height)) for p in P]
    g.merge(pipe_run(top, r, bend=0.12, segs=16, mat=mat, flanges=False))
    if mid:
        g.merge(pipe_run([p + Vector((0, 0, height * 0.5)) for p in P], r * 0.8, bend=0.12, segs=12, mat=post_mat,
                         flanges=False))
    for i in range(len(P) - 1):
        seg = P[i + 1] - P[i]
        n = max(1, int(math.ceil(seg.length / post_every)))
        for k in range(n + (1 if i == len(P) - 2 else 0)):
            p = P[i] + seg * (k / n)
            g.merge(cylinder(r * 1.05, height, 16, bevel=0.004, mat=post_mat, z0=0.0).move(p))
            g.merge(box((0.12, 0.12, 0.012), bevel=0.003, segs=1, mat=post_mat).move(p + Vector((0, 0, 0.006))))
        if toe_board:
            tb = box((seg.length, 0.012, 0.12), bevel=0.002, segs=1, mat=post_mat)
            tb.transform(Matrix.Translation(P[i] + seg * 0.5 + Vector((0, 0, 0.06))) @
                         Matrix.Rotation(math.atan2(seg.y, seg.x), 4, 'Z'))
            g.merge(tb)
    return g


def ladder(height, width=0.5, rung_every=0.3, rail=0.05, rung_r=0.014, cage=True, mat='paint_secondary',
           rung_mat='steel'):
    """Fixed ladder on +Z starting at z=0, rails along Y=0 plane (climb face toward -Y)."""
    g = Geo()
    for x in (-width / 2, width / 2):
        g.merge(box((rail * 0.25, rail, height), bevel=0.003, segs=1, mat=mat).move(x, 0, height / 2))
    n = int(height / rung_every)
    for i in range(1, n + 1):
        g.merge(cylinder(rung_r, width, 12, bevel=0.0, mat=rung_mat).rotate((0, 90, 0)).move(0, 0, i * rung_every))
    if cage and height > 2.5:
        k = int((height - 2.2) / 0.9)
        for i in range(k + 1):
            z = 2.2 + i * 0.9
            hoop = torus(0.38, 0.012, 24, 8, mat=mat, arc=math.pi)
            hoop.rotate((0, 0, 180)).move(0, -0.33, z)
            g.merge(hoop)
        for a in (-0.6, 0.0, 0.6):
            x, y = math.sin(a) * 0.38, -0.33 - math.cos(a) * 0.38
            g.merge(box((0.05, 0.008, height - 2.2), bevel=0.002, segs=1, mat=mat).move(x, y, 2.2 + (height - 2.2) / 2))
    return g


# ============================================================================ greebles
def greeble_panel(w, h, seed=1, density=0.6, height=0.06, mat='steel_dark', accent_mat='paint_secondary',
                  kinds=('box', 'cyl', 'vent', 'bolts', 'pipe'), margin=0.03):
    """Seeded scatter of small mechanical details on a w x h area (XY plane, +Z out).
    Uses a coarse occupancy grid so pieces do not overlap. Place it on a surface with
    geo.align(normal, up, loc) or a matrix."""
    rng = RNG(seed)
    cell = max(0.03, min(w, h) / 12)
    nx, ny = max(1, int(w / cell)), max(1, int(h / cell))
    occ = [[False] * ny for _ in range(nx)]
    g = Geo()
    tries = int(nx * ny * density)
    for _ in range(tries):
        cw = rng.randint(2, max(2, nx // 3))
        ch = rng.randint(2, max(2, ny // 3))
        if cw > nx or ch > ny:
            continue
        i0 = rng.randint(0, nx - cw)
        j0 = rng.randint(0, ny - ch)
        if any(occ[i][j] for i in range(i0, i0 + cw) for j in range(j0, j0 + ch)):
            continue
        for i in range(i0, i0 + cw):
            for j in range(j0, j0 + ch):
                occ[i][j] = True
        bw = cw * cell - margin
        bh = ch * cell - margin
        if bw <= 0.01 or bh <= 0.01:
            continue
        cx = -w / 2 + (i0 + cw / 2) * cell
        cy = -h / 2 + (j0 + ch / 2) * cell
        kind = rng.choice(kinds)
        hh = height * rng.uniform(0.35, 1.0)
        m = accent_mat if rng.random() < 0.25 else mat
        if kind == 'box':
            p = box((bw, bh, hh), bevel=min(0.006, hh * 0.2), segs=2, mat=m).move(cx, cy, hh / 2)
            if bw > 0.08 and bh > 0.08 and rng.random() < 0.5:
                top = p.faces_facing((0, 0, 1), 5)
                p.recess(top, min(bw, bh) * 0.15, hh * 0.3, floor_mat='steel_dark')
        elif kind == 'cyl':
            r = min(bw, bh) * 0.45
            p = cylinder(r, hh, 24, bevel=min(0.005, r * 0.2), mat=m, z0=0.0).move(cx, cy, 0)
            if r > 0.03:
                p.merge(bolt_circle((cx, cy, hh), (0, 0, 1), r * 0.7, 6, r=min(0.008, r * 0.15)))
        elif kind == 'vent' and bw > 0.08 and bh > 0.06:
            p = vent(bw, bh, depth=min(0.03, hh), slats=max(3, int(bh / 0.025)), frame=min(0.015, bw * 0.12),
                     mat=m).move(cx, cy, hh * 0.5)
            p.merge(box((bw, bh, hh * 0.5), bevel=0.003, segs=1, mat=m).move(cx, cy, hh * 0.25))
        elif kind == 'bolts':
            n = max(2, int(bw / 0.04))
            p = bolt_row((cx - bw / 2 + 0.015, cy, 0), (cx + bw / 2 - 0.015, cy, 0), n, (0, 0, 1), r=0.009)
        elif kind == 'pipe' and bw > 0.1:
            r = min(0.018, bh * 0.25)
            p = pipe_run([(cx - bw / 2, cy, r), (cx + bw / 2, cy, r)], r, segs=12, mat='steel', flanges=False)
            p.merge(box((0.02, bh * 0.8, r * 1.2), bevel=0.002, segs=1, mat=m).move(cx - bw * 0.3, cy, r * 0.6))
            p.merge(box((0.02, bh * 0.8, r * 1.2), bevel=0.002, segs=1, mat=m).move(cx + bw * 0.3, cy, r * 0.6))
        else:
            p = box((bw, bh, hh * 0.5), bevel=0.003, segs=1, mat=m).move(cx, cy, hh * 0.25)
        g.merge(p)
    return g


def collider_box(size, center=(0, 0, 0)):
    """Plain 6-face box for COL_ colliders (no bevel, no UV needs)."""
    g = Geo()
    bmesh.ops.create_cube(g.bm, size=1.0)
    g.set_mat('collider')
    g.transform(Matrix.Translation(Vector(center)) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
    return g
