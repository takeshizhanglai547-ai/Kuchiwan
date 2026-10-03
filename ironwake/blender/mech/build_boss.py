"""GC-X1 "CINDERHOUND" - Grauwerk Consolidated's rival rig (owner: mech modeler).

A predatory counterpoint to RIG-07: lighter, hunched forward over a deep keel chest,
a long wedge 'snout' head with ONE red slit eye, swept blade pauldrons, digitigrade
(reverse-joint look) legs with a rear hock + tendon rams and three-claw feet, and a
back unit of radiator 'hackles' over twin angled booster pods. Weapons: GLR-3 laser
rifle (R hand), PX-2 plasma/missile arm (L forearm), 6-cell micro-missile pod (L back),
command sensor mast (R back). Same node contract as the player (src/mech/rig.js): the
reverse-joint look comes from geometry (a fixed hock inside the shin node), so the
standard knee/ankle pivots still animate it.

    python3 blender/mech/build_boss.py --blockout [--poses] [--views a,b]
    python3 blender/mech/build_boss.py [--quick]

Blender coords: +Z up, faces -Y, the rig's RIGHT is -X.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mechkit as K  # noqa: E402
import rigpipe as R  # noqa: E402
from mechkit import D, Geo, P, iw  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

NAME = 'mech_boss'

# ============================================================================ skeleton (L side = +X)
PELVIS = (0.0, 0.30, 5.45)
TORSO = (0.0, 0.25, 6.30)
OLD_HEAD = (0.0, -1.18, 8.50)
HEAD = (0.0, -1.62, 8.36)
HEAD_S = 1.35                      # head authored around OLD_HEAD, scaled + moved to HEAD
EYE = (0.0, HEAD[1] + (-2.26 - OLD_HEAD[1]) * HEAD_S, HEAD[2] + (8.60 - OLD_HEAD[2]) * HEAD_S)
DY = -0.24                         # arms hang further forward (hunched shoulders)
HIP = (1.00, 0.30, 5.30)
KNEE = (1.08, -0.90, 3.70)
HOCK = (1.10, 0.62, 1.96)          # fixed joint inside the shin node (the reverse-joint look)
ANKLE = (1.12, -0.02, 0.74)
SHOULDER = (1.98, -0.28 + DY, 7.92)
ELBOW0 = (2.08, -0.12, 6.12)       # forearm parts are authored here, then moved by DY
ELBOW = (2.08, -0.12 + DY, 6.12)
WRIST = (2.10, -1.98 + DY, 6.04)
BACK = (0.0, 0.8, 7.5)
MOUNT_L = (0.95, 0.36, 8.72)
MOUNT_R = (-0.95, 0.36, 8.72)
SIDEBOOST = (1.28, 0.95, 6.95)
WPN_R = (-2.10, -2.24 + DY, 5.84)
WPN_L = (2.12, -2.2 + DY, 6.08)
MUZ_R = (-2.10, -6.55 + DY, 6.16)
MUZ_L = (2.12, -3.52 + DY, 6.1)
MUZ_LB = (0.95, -0.56, 9.2)
# rest pose (r1): the upper arms reach 18 deg forward from the shoulders (hunched predator,
# elbows bent, weapons carried level); forearm-chain geometry is authored as before and
# translated by ARM_D, the upper-arm segment is rotated about the shoulder.
ARM_T = math.radians(18.0)
R_UP = Matrix.Translation(SHOULDER) @ Matrix.Rotation(-ARM_T, 4, 'X') @ Matrix.Translation(-Vector(SHOULDER))
ARM_D = (R_UP @ Vector(ELBOW)) - Vector(ELBOW)


def fwd(p):
    return tuple(Vector(p) + ARM_D)

# chest: deep keel, sheared forward (hunched). (z, half width, front y, back y, prow, chamfer)
SHEAR = 0.42
_BASE = [(6.55, 0.80, -0.48, 0.76, 0.18, 0.20),
         (7.10, 1.25, -0.95, 0.80, 0.45, 0.28),
         (7.80, 1.50, -1.05, 0.95, 0.55, 0.32),
         (8.45, 1.42, -0.90, 1.00, 0.40, 0.30),
         (8.80, 1.08, -0.60, 0.90, 0.20, 0.25)]
CHEST = [(z, hw, yf - (z - 6.3) * SHEAR, yb - (z - 6.3) * SHEAR, pr, c) for (z, hw, yf, yb, pr, c) in _BASE]


def crease(z, lift=0.02):
    return K.prow_facet(CHEST, z, 0.0, 1, lift)[0]


def mx(p):
    return (-p[0], p[1], p[2])


def marker(loc, normal, color='red', r=0.05):
    """Marker light: emissive lens in a bezel (silhouette lift in backlight)."""
    g = Geo()
    g.merge(P.cylinder(r * 1.5, 0.05, 16, bevel=0.008, bsegs=1, mat='steel_dark', z0=-0.02))
    g.merge(P.dome(r, r * 0.55, 16, 2, mat='marker_' + color).move(0, 0, 0.03))
    n = Vector(normal).normalized()
    g.align(n, up=(0, 0, 1) if abs(n.z) < 0.9 else (0, 1, 0), loc=loc)
    return g


def rivets(p0, p1, pitch, normal, r=0.016, mat='steel'):
    p0, p1 = Vector(p0), Vector(p1)
    n = max(2, int(round((p1 - p0).length / pitch)) + 1)
    proto = P.cylinder(r, r * 0.45, 6, bevel=0.0, bsegs=1, mat=mat, z0=0.0)
    K.mark_hidden(proto, (0, 0, -1))
    Rm = P._frame(normal)
    g = Geo()
    for i in range(n):
        g.merge(proto, M=Matrix.Translation(p0.lerp(p1, i / (n - 1))) @ Rm)
    return g


def pad(corners, thick, mat='paint_secondary', normal_hint=None, inner=0.13, bolts=True, ridge=0.0, **kw):
    """Hard-edged armour pad (r2: the cream pads read as pillows): near-vertical side walls
    with a 2 cm chamfer, bolts along the edges, and a raised INSET PANEL on top (a thinner
    plate shrunk toward the centre) so every pad has a seam line and a second value step."""
    C = [Vector(c) for c in corners]
    o = sum(C, Vector()) / len(C)
    n = (C[1] - C[0]).cross(C[-1] - C[0]).normalized()
    if normal_hint is not None and n.dot(Vector(normal_hint)) < 0:
        n = -n
    g = Geo()
    g.merge(K.plate_world(C, thick, mat=mat, normal_hint=n, inset=0.02, bevel=0.006, chamfer=kw.pop('chamfer', 0.05),
                          bolts=1 if bolts else 0, bolt_r=0.015, bolt_spacing=0.22, ridge=ridge, **kw))
    Ci = [o + (c - o) * (1.0 - inner * 2.2) + n * (thick + 0.002) for c in C]
    g.merge(K.plate_world(Ci, 0.02, mat=mat, normal_hint=n, inset=0.008, bevel=0.004, chamfer=0.03))
    return g


def seams(g, d, center, normals, ts, gap=0.022, depth=0.018):
    """Panel-seam grooves across a limb shell at fractions ts along direction d from center."""
    for t in ts:
        K.grooves(g, normals, Vector(center) + Vector(d) * t, d, gap=gap, depth=depth)


# ============================================================================ r4 (enemy modeler): secondary frequency
PANEL_MATS = ('paint_primary', 'paint_dark', 'paint_secondary')
PANEL_STATS = {'faces': 0, 'panels': 0, 'bolts': 0}


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


def panelize(g, seed, min_area=0.1, frac=0.66, max_side=0.62, min_side=0.16, skip=None, mats=PANEL_MATS,
             weights=(0.4, 0.38, 0.22), bolt_r=0.014, down_ok=False):
    """r4 (critic r3: 'large flat oxide planes'): breaks every big planar paint face of a shell into
    inset panels - a seam-loop panel, a raised 2 cm plate with corner bolts or a 2.5 cm recessed
    panel - 0.16-0.62 m wide, centred in the face and kept inside its outline (so they never run off
    an edge). skip(centre, normal) -> True leaves a face alone (the faces under layered plates /
    vents). Returns the bolt geometry (merge it with the part)."""
    import random
    rng = random.Random(seed)
    g.bm.normal_update()
    mids = [g.mats.index(m) for m in mats if m in g.mats]
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
        if _keeps_card(g, f, c):
            continue
        cands.append((round(-a_, 5), round(c.x, 4), round(c.y, 4), round(c.z, 4), f))
    cands.sort(key=lambda t: t[:4])
    bolts = Geo()
    for _, cx, cy, cz, f in cands:
        if not f.is_valid:
            continue
        PANEL_STATS['faces'] += 1
        o, u, v, n, pts = g.face_frame(f)
        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        ccu = sum(us) / len(us)
        ccv = sum(vs) / len(vs)
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
        # long faces get two panels side by side (keeps every panel in the 0.2-0.6 m band)
        L = max(max(us) - min(us), max(vs) - min(vs))
        splits = [(0.0, 0.0)]
        alongu = (max(us) - min(us)) >= (max(vs) - min(vs))
        big = (w >= max_side * 0.95) if alongu else (h >= max_side * 0.95)
        if L > 1.15 and big:
            off = min(L * 0.24, max_side * 0.62)
            splits = [(-off, 0.0), (off, 0.0)] if alongu else [(0.0, -off), (0.0, off)]
            if alongu:
                w = min(w, off * 1.6)
            else:
                h = min(h, off * 1.6)
        for k, (du, dv) in enumerate(splits):
            ctr = o + u * (ccu + du) + v * (ccv + dv)
            # the first panel splits the face: find the sub-face under the next centre
            face = f if (k == 0 and f.is_valid) else K.face_at(g, ctr, n, angle=8.0)
            if face is None or not face.is_valid:
                continue
            r_ = rng.random()
            mode = 0 if r_ < weights[0] else (1 if r_ < weights[0] + weights[1] else 2)
            gp = 0.012
            fm = g.mats[face.material_index]
            # value steps that read at 20-60 m: recessed panels floor in dark oxide, every fourth raised
            # plate on an oxide facet is a cream service plate (the player's bone-on-slate logic)
            cap = 'paint_secondary' if (fm == 'paint_primary' and rng.random() < 0.25) else None
            if mode == 0:     # low seam plate (8 mm): reads as a panel outline in the bevel-baked normal
                res, sl = g.hatch(face, ctr, (w, h), gap=gp, raised=0.008, u_axis=u), 0.008
            elif mode == 1:
                res, sl = g.hatch(face, ctr, (w, h), gap=gp, raised=0.02, u_axis=u, mat=cap), 0.02
            else:
                res, sl = g.hatch(face, ctr, (w, h), gap=gp, recess=0.025, u_axis=u,
                                  mat='paint_dark' if fm != 'paint_dark' else 'steel_dark'), 0.025
            if res is None:
                continue
            _slope_walls(res, ctr, u, v, w - 2 * gp, h - 2 * gp, sl)
            PANEL_STATS['panels'] += 1
            if mode == 1 and bolt_r > 0:
                lift = n * 0.02
                for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    p = ctr + u * su * (w * 0.5 - 0.06) + v * sv * (h * 0.5 - 0.06) + lift
                    bolts.merge(_bolt_at(p, n, bolt_r, cap or fm))
                    PANEL_STATS['bolts'] += 1
    return bolts


# decal-card keep-out points (L-side build coordinates; mirrored parts are built on +X): a face that a
# card lies on gets no panel step under it (a flat card over a 2 cm step would float or clip)
CARD_KEEP = []


def keep(*pts):
    for p in pts:
        CARD_KEEP.append(Vector(p))
        CARD_KEEP.append(Vector((-p[0], p[1], p[2])))


def _keeps_card(g, f, c):
    n = f.normal
    for p in CARD_KEEP:
        if abs((p - c).dot(n)) > 0.14 or (p - c).length > 1.6:
            continue
        o, u, v, n_, pts = g.face_frame(f)
        q = p - o
        if _pip((q.dot(u), q.dot(v)), pts):
            return True
    return False



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

def _bolt_at(p, n, r, mat='steel'):
    """One hex bolt standing on a surface point p with normal n (identical copies UV-stack). Panel bolts
    are painted over with their plate (bare steel heads were sub-pixel specular sparkle at 20 m)."""
    b = P.bolt(r, 'hex', mat)
    n = Vector(n).normalized()
    b.align(n, up=(0, 0, 1) if abs(n.z) < 0.9 else (0, 1, 0), loc=p)
    return b


def rust_drip(seed=1, w=64, h=288, drips=3):
    """Rust run-off below a bolt / seam (RGBA, top = source; same recipe as the player rig)."""
    import numpy as np
    from PIL import Image, ImageFilter
    rng = np.random.default_rng(seed)
    a = np.zeros((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for k in range(drips):
        x0 = w * (0.5 + rng.uniform(-0.28, 0.28))
        length = h * rng.uniform(0.45, 1.0)
        wid = rng.uniform(3.5, 7.5) * (1.3 if k == 0 else 1.0)
        wob = np.cumsum(rng.normal(0, 0.35, h)).astype(np.float32)
        cx = x0 + wob[yy.astype(int)] * 0.6
        t = np.clip(yy / max(length, 1.0), 0, 1)
        ww = wid * (1.0 - 0.7 * t)
        m = np.clip(1.0 - np.abs(xx - cx) / ww, 0, 1) * (yy < length) * (1.0 - t ** 1.6)
        a = np.maximum(a, m * rng.uniform(0.7, 1.0))
    blob = np.clip(1.0 - np.hypot((xx - w * 0.5) / (w * 0.32), (yy - h * 0.03) / (h * 0.05)), 0, 1) ** 1.2
    tw = np.clip(yy / (h * rng.uniform(0.7, 0.95)), 0, 1)
    wash = np.exp(-((xx - w * 0.5) / (w * (0.2 + 0.08 * tw))) ** 2) * (1.0 - tw) ** 1.3 * 0.55
    a = np.clip(np.maximum(np.maximum(a, blob * 0.8), wash) * (0.75 + 0.25 * rng.random((h, w))), 0, 1)
    dark = np.array([96, 50, 30], np.float32)
    lite = np.array([140, 72, 32], np.float32)
    tt = np.clip(yy / h, 0, 1)[..., None]
    col = dark * (1 - tt) + lite * tt
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = col.astype(np.uint8)
    rgba[..., 3] = (a * 235).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA').filter(ImageFilter.GaussianBlur(0.6))


def claw(p0, p1, w0, w1, h0, h1, mat='paint_primary'):
    """r4 hard claw (critic r3: 'smooth blob toe claws'): a faceted wedge with a hard three-edge
    chamfered top (two flat bevel facets + a crest), flat sides and a flat sole, tapering to a
    blunt chisel tip; bevel 6 mm so every edge is a crisp highlight, not a soft blob."""
    p0, p1 = Vector(p0), Vector(p1)
    secs = []
    for t, wd, ht in ((0.0, w0, h0), (0.55, (w0 + w1) * 0.55, (h0 + h1) * 0.6), (1.0, w1, h1)):
        c = min(wd * 0.42, ht * 0.5)
        secs.append((t, -wd * 0.5, wd * 0.5, -ht * 0.35, ht * 0.65, (0.008, 0.008, c, c)))
    return K.limb(p0, p1, secs, mat=mat, bevel=0.006)


# ============================================================================ pelvis / torso
def build_pelvis():
    g = Geo()
    core = K.shell([(4.86, -0.46, 0.46, -0.08, 0.66, 0.14), (5.3, -0.66, 0.66, -0.26, 0.86, 0.2),
                    (5.8, -0.66, 0.66, -0.2, 0.82, 0.2), (6.1, -0.56, 0.56, -0.1, 0.7, 0.18)], 'Z', mat='paint_dark')
    K.grooves(core, [(0, -1, 0), (1, 0, 0), (-1, 0, 0), (0, 1, 0)], (0, 0, 5.5), (0, 0, 1))
    g.merge(panelize(core, 501, min_area=0.06, max_side=0.4))
    g.merge(core)
    g.merge(K.shackle(0.07, bar=0.018, segs=(12, 6)).align((0, -1, 0), up=(0, 0, 1), loc=(0, -0.67, 5.45)))
    g.merge(P.banded_cylinder([(0.05, 0.5, 'steel_dark'), (0.12, 0.58), (0.03, 0.55, 'paint_accent'),
                               (0.06, 0.56, 'steel')], segs=40, step=0.0, mat='paint_dark').move(0, 0.28, 6.06))
    for s in (1, -1):
        g.merge(K.drum((s * 0.6, HIP[1], HIP[2]), (1, 0, 0), 0.32, 0.2, profile='ring', hub=False))
        # hip spurs: swept blades over the hip joints
        g.merge(K.plate_world([(s * 0.66, -0.2, 5.84), (s * 1.34, 0.0, 5.62), (s * 1.3, 1.1, 5.72), (s * 0.66, 0.82, 5.9)],
                              0.06, mat='paint_primary', normal_hint=(0, 0, 1), chamfer=0.08, bolts=1, bolt_r=0.016))
    g.merge(K.plate_world([(-0.36, -0.34, 5.86), (0.36, -0.34, 5.86), (0.2, -0.52, 4.96), (-0.2, -0.52, 4.96)], 0.07,
                          mat='paint_secondary', normal_hint=(0, -1, 0), ridge=0.03, ridge_axis='Y', chamfer=0.06))
    # waist: 4 sagging cable bundles from the pelvis block up into the actuator ring
    ty = 0.28
    for sx, sy in ((1, -1), (-1, -1), (1, 1), (-1, 1)):
        base = Vector((sx * 0.5, ty + sy * 0.34, 6.04))
        top = Vector((sx * 0.4, ty + sy * 0.4, 6.28))
        mid = (base + top) * 0.5 + Vector((sx * 0.18, sy * 0.12, -0.02))
        for k in (-0.5, 0.5):
            o = Vector((k * 0.08 * sy, k * 0.08 * sx, 0.0))
            g.merge(P.sweep([base + o, mid + o * 1.4, top + o], 0.036, 16, mat='rubber', rib_amp=0.0, subdiv=3))
        g.merge(P.box((0.24, 0.24, 0.07), bevel=0.01, segs=1, mat='steel_dark').move(base.x, base.y, 6.02))
    for s_ in (1, -1):
        g.merge(marker((s_ * 1.2, -0.08, 5.76), (0, -1, -0.2), 'amber', 0.04))
    return g


def build_torso():
    g = Geo()
    ch = K.loft_pts([(K.prow(hw, yf, yb, pr, c), z) for (z, hw, yf, yb, pr, c) in CHEST], axis='Z', bevel=0.028,
                    mat='paint_primary')
    K.grooves(ch, [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (1, 1, 0), (-1, 1, 0)], (0, 0, 7.45), (0, 0, 1))
    # r4 (critic r3: the torso read as one smooth dome): two fore-aft seam gaps split the upper shell into three
    # armour segments (centre spine + two shoulder segments) and a second horizontal seam rings the flanks/back
    for sx in (-0.56, 0.56):
        K.grooves(ch, [(0, 0, 1), (0, -1, 0.6), (0, -1, 0.3), (0, 1, 0.4), (0, 1, 0), (0, -1, 1), (0, 1, 1)],
                  (sx, 0, 0), (1, 0, 0), gap=0.03, depth=0.026)
    K.grooves(ch, [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (1, 1, 0), (-1, 1, 0), (0, -1, 0.4), (1, -1, 0.3), (-1, -1, 0.3)],
              (0, 0, 8.46), (0, 0, 1), gap=0.026, depth=0.022)
    # r4: outer seams down the front-flank facets (the big oxide cheeks beside the keel plates)
    for sx in (-1.02, 1.02):
        K.grooves(ch, [(1, -1, 0), (-1, -1, 0), (0.7, -1, 0.3), (-0.7, -1, 0.3), (0, 0, 1), (0.5, 0, 1), (-0.5, 0, 1)],
                  (sx, 0, 0), (1, 0, 0), gap=0.026, depth=0.022)
    arm = []
    for s in (1, -1):
        # cream keel plates (the 'chest' of the hound) + oxide lower plates + ID stripe
        arm.append(K.prow_plate(CHEST, 7.2, 8.36, 0.05, 0.86, s, 0.07, 'paint_secondary', chamfer=0.05, bolts=1,
                                bolt_r=0.018, bolt_spacing=0.3, inset=0.02))
        a_, n_ = K.prow_facet(CHEST, 7.42, 0.2, s, lift=0.084)
        b_, _ = K.prow_facet(CHEST, 7.42, 0.72, s, lift=0.084)
        c_, _ = K.prow_facet(CHEST, 8.12, 0.72, s, lift=0.084)
        d_, _ = K.prow_facet(CHEST, 8.12, 0.2, s, lift=0.084)
        arm.append(K.plate_world([a_, b_, c_, d_], 0.022, mat='paint_secondary', normal_hint=n_, inset=0.008,
                                 chamfer=0.03))
        arm.append(K.prow_plate(CHEST, 6.66, 7.02, 0.12, 0.8, s, 0.05, 'paint_primary', chamfer=0.05))
        n = K.prow_facet(CHEST, 7.16, 0.5, s)[1]
        arm.append(K.strip(K.prow_facet(CHEST, 7.14, 0.08, s)[0], K.prow_facet(CHEST, 7.14, 0.86, s)[0], 0.07, 0.03, n))
        # keel intake vents on the lower chest facets
        c, n2 = K.prow_facet(CHEST, 6.86, 0.5, s, lift=0.0)
        kv = P.vent(0.42, 0.24, depth=0.05, slats=4, frame=0.03, mat='paint_dark')
        kv.align(n2 + Vector((0, 0, -0.4)), up=(0, 0, 1), loc=c + n2 * 0.06)
        arm.append(kv)
        # flank vents + radiator slots
        v = P.vent(0.6, 0.34, depth=0.06, slats=6, frame=0.035, mat='paint_dark')
        hw, yf, yb, pr, c = K.sec_interp(CHEST, 7.6)
        v.align((s, 0, 0.1), up=(0, 0, 1), loc=(s * (hw + 0.03), (yf + yb) * 0.5, 7.6))
        arm.append(v)
        g.merge(K.drum((s * 1.62, SHOULDER[1], SHOULDER[2]), (1, 0, 0), 0.42, 0.26, profile='ring', hub=False))
        # flank armour above the radiator vent (layered oxide plate + cream edge strip), cable run, grille
        hw2, yf2, yb2, pr2, c2 = K.sec_interp(CHEST, 8.05)
        xm = s * (hw2 + 0.012)
        arm.append(K.plate_world([(xm, yf2 + 0.32, 7.86), (xm, yb2 - 0.3, 7.86), (xm, yb2 - 0.34, 8.26),
                                  (xm, yf2 + 0.4, 8.26)], 0.05, mat='paint_primary', normal_hint=(s, 0, 0),
                                 chamfer=0.06, bolts=1, bolt_r=0.016, bolt_spacing=0.26))
        arm.append(K.strip((xm + s * 0.05, yf2 + 0.4, 8.2), (xm + s * 0.05, yb2 - 0.34, 8.2), 0.05, 0.012, (s, 0, 0),
                           mat='paint_secondary'))
        arm.append(P.hose([(s * 0.5, yb2 - 0.1, 8.5), (s * 0.7, yb2 + 0.08, 8.0), (s * 0.66, yb2 + 0.12, 7.4)], 0.04,
                          16, rib_amp=0.005, rib_freq=26))
        gr = P.grille(0.34, 0.2, bars=5, bar_r=0.012, frame=0.03, depth=0.04, mat='paint_dark')
        cg, ng = K.prow_facet(CHEST, 8.55, 0.55, s, lift=0.0)
        gr.align(ng + Vector((0, 0, 0.25)), up=(0, 0, 1), loc=cg + ng * 0.02)
        arm.append(gr)
        g.merge(K.shackle(0.08, bar=0.02).move(s * 0.8, 0.0, 8.8))
    arm.append(K.strip(crease(7.82), crease(8.42), 0.1, 0.04, (0, -1, 0.3), mat='steel_dark'))
    for s_ in (1, -1):
        # rivet rows along the keel plates' upper and lower edges, red marker lights under the keel
        a0, n0 = K.prow_facet(CHEST, 8.3, 0.1, s_, lift=0.004)
        a1, _ = K.prow_facet(CHEST, 8.3, 0.84, s_, lift=0.004)
        arm.append(rivets(a0, a1, 0.12, n0))
        b0, n1 = K.prow_facet(CHEST, 7.26, 0.1, s_, lift=0.004)
        b1, _ = K.prow_facet(CHEST, 7.26, 0.84, s_, lift=0.004)
        arm.append(rivets(b0, b1, 0.12, n1))
        c, n2 = K.prow_facet(CHEST, 6.7, 0.9, s_, lift=0.02)
        arm.append(marker(c, n2 + Vector((0, 0, -0.6)), 'red', 0.045))
        hw, yf, yb, pr, c_ = K.sec_interp(CHEST, 7.95)
        arm.append(rivets((s_ * (hw + 0.004), yf + 0.3, 7.95), (s_ * (hw + 0.004), yb - 0.3, 7.95), 0.12, (s_, 0, 0)))
    # r3: secondary density on the big chest planes: a bolted access hatch low on each flank and a
    # heat-sink louvre bank either side of the neck on the chest top
    for s in (1, -1):
        hw_, yf_, yb_, pr_, c_ = K.sec_interp(CHEST, 6.98)
        K.hatch_at(ch, (s * hw_, (yf_ + yb_) * 0.5 + 0.05, 6.98), (s, 0, 0), (0.5, 0.26), u_axis=(0, 1, 0),
                   recess=0.04, mat='steel_dark', angle=40)
        lv = P.louvres(0.42, 0.5, count=5, depth=0.05, angle=26, thickness=0.016, mat='steel_dark', side_mat='paint_dark')
        lv.align((0, 0, 1), up=(0, 1, 0), loc=(s * 0.62, -0.62, 8.805))
        arm.append(lv)
        arm.append(rivets((s * 0.35, -1.3, 8.81), (s * 0.35, -0.3, 8.81), 0.12, (0, 0, 1)))
        # r4: a vent grille on each rear shoulder segment of the dome (heat exhaust over the back)
        hwv, yfv, ybv, prv, cv = K.sec_interp(CHEST, 8.62)
        vg = P.vent(0.5, 0.36, depth=0.06, slats=5, frame=0.035, angle=34, mat='paint_dark')
        vg.align((s * 0.25, 0.35, 1.0), up=(0, -1, 0), loc=(s * 0.92, ybv - 0.42, 8.66))
        arm.append(vg)
        # corner chamfer facets (the big oxide planes beside the keel): a recessed hatch + a bolted
        # cream service panel with a vent slot
        for zc, sz in ((7.45, (0.34, 0.42)),):
            hw_, yf_, yb_, pr_, c_ = K.sec_interp(CHEST, zc)
            K.hatch_at(ch, (s * (hw_ - c_ * 0.5), yf_ + c_ * 0.5, zc), (s, -1, 0), sz, u_axis=(0, 0, 1), recess=0.035,
                       mat='steel_dark', angle=30)
        hw_, yf_, yb_, pr_, c_ = K.sec_interp(CHEST, 8.15)
        cn = Vector((s, -1, 0)).normalized()
        cc = Vector((s * (hw_ - c_ * 0.5), yf_ + c_ * 0.5, 8.15)) + cn * 0.005
        tv = Vector((-1, -s, 0)).normalized() * s
        arm.append(K.plate_world([cc + tv * 0.14 + Vector((0, 0, -0.16)), cc - tv * 0.14 + Vector((0, 0, -0.16)),
                                  cc - tv * 0.12 + Vector((0, 0, 0.16)), cc + tv * 0.12 + Vector((0, 0, 0.16))], 0.03,
                                 mat='paint_secondary', normal_hint=cn, chamfer=0.03, bolts=1, bolt_r=0.013,
                                 bolt_spacing=0.14))
    # r4 (enemy modeler; critic r3 S 'flat oxide torso planes'): inset panels on every remaining big facet
    # (not the front V facets under the keel plates, nor the flank faces under the armour + vent stack)
    def skip_t(c, n):
        if n.y < -0.55 and abs(n.x) < 0.75 and 7.15 < c.z < 8.4:
            return True                                    # keel plates
        if abs(n.x) > 0.85 and 7.35 < c.z < 8.3:
            return True                                    # flank vent + armour plate
        return n.z > 0.85 and c.y < -0.25                  # chest-top louvres / rivets ahead of the neck
    arm.append(panelize(ch, 101, min_area=0.1, skip=skip_t))
    g.merge(ch, *arm)
    # r4: lifting eyes on the rear dome segments and a tow shackle under each keel corner
    for s in (1, -1):
        hwv, yfv, ybv, prv, cv = K.sec_interp(CHEST, 8.62)
        g.merge(K.shackle(0.08, bar=0.02).move(s * 0.4, ybv - 0.3, 8.83))
        c_, n_ = K.prow_facet(CHEST, 6.72, 0.62, s, lift=0.0)
        g.merge(K.shackle(0.06, bar=0.016).align(n_ + Vector((0, 0, -0.5)), up=(0, 0, 1), loc=c_ + n_ * 0.01))
    # neck cradle at the front top (the head juts forward from it)
    nk = K.limb((0, -1.0, 8.66), (0, HEAD[1] + 0.05, HEAD[2] + 0.02), [(0, -0.42, 0.42, -0.34, 0.34, 0.1),
                                                                     (1, -0.34, 0.34, -0.3, 0.3, 0.1)], mat='paint_dark')
    g.merge(nk)
    g.merge(P.banded_cylinder([(0.05, 0.54, 'steel_dark'), (0.14, 0.6), (0.04, 0.56, 'steel_dark')], segs=40, step=0.0,
                              mat='paint_dark').move(0, 0.26, 6.2))
    for s in (1, -1):
        g.merge(K.ram((s * 0.36, -0.9, 8.3), (s * 0.3, HEAD[1] + 0.12, HEAD[2] + 0.08), r=0.06, frac=0.55, segs=16))
        mx_, my_, mz_ = MOUNT_L if s > 0 else MOUNT_R
        for cx, sg in ((mx_ - 0.24, -1), (mx_ + 0.24, 1)):
            g.merge(K.cheek((cx, my_, mz_), sg, 0.22, 0.07, strap_to=(my_ - 0.35, mz_ - 0.3), strap_w=0.3, bolts=4))
    for z in (6.9, 8.1):
        g.merge(P.box((1.5, 0.1, 0.14), bevel=0.01, segs=1, mat='steel_dark').move(0, 0.8 - (z - 6.3) * SHEAR, z))
    return g


# ============================================================================ head (hound snout, one slit)
def build_head():
    g = Geo()
    c = (0.06, 0.06, 0.14, 0.14)
    hd = K.shell([(-0.72, -0.46, 0.46, 8.30, 8.92, (0.1, 0.1, 0.16, 0.16)),
                  (-1.55, -0.44, 0.44, 8.28, 8.88, (0.1, 0.1, 0.18, 0.18)),
                  (-2.18, -0.30, 0.30, 8.34, 8.66, c),
                  (-2.48, -0.14, 0.14, 8.40, 8.52, (0.04, 0.04, 0.05, 0.05))], 'Y', bevel=0.02, mat='paint_primary')
    K.grooves(hd, [(0, 0, 1), (1, 0, 0), (-1, 0, 0), (1, 0, 1), (-1, 0, 1)], (0, -1.2, 0), (0, 1, 0))
    for s in (1, -1):   # r3: bolted access hatch on each flank of the wedge
        K.hatch_at(hd, (s * 0.44, -1.98, 8.5), (s, 0, 0), (0.26, 0.15), u_axis=(0, 1, 0), recess=0.03,
                   mat='steel_dark', angle=35)
    g.merge(hd)
    # slit recess across the brow (single eye) - glowing bar lives under 'eye'
    g.merge(K.shell([(-1.86, -0.4, 0.4, 8.53, 8.69, 0.03), (-2.24, -0.32, 0.32, 8.49, 8.63, 0.03)], 'Y', mat='steel_dark'))
    # crest fin (cream) with ID stripe, jaw guard, swept 'ear' antennas
    fin = P.prism(P.fillet([(-2.0, 8.66), (-1.2, 8.92), (-0.5, 9.2), (-0.62, 8.9)], 0.03, 1), 0.08, bevel=0.012, segs=1,
                  mat='paint_secondary', axis='X')
    g.merge(fin)
    g.merge(K.strip((0.045, -1.5, 8.94), (0.045, -0.8, 9.1), 0.08, 0.01, (1, 0, 0)))
    g.merge(K.strip((-0.045, -1.5, 8.94), (-0.045, -0.8, 9.1), 0.08, 0.01, (-1, 0, 0)))
    g.merge(K.plate_world([(-0.34, -0.8, 8.26), (0.34, -0.8, 8.26), (0.22, -2.1, 8.32), (-0.22, -2.1, 8.32)], 0.05,
                          mat='paint_dark', normal_hint=(0, 0, -1), chamfer=0.06))
    for s in (1, -1):
        g.merge(K.plate_world([(s * 0.465, -0.8, 8.42), (s * 0.465, -1.5, 8.4), (s * 0.465, -1.5, 8.78),
                               (s * 0.465, -0.9, 8.84)], 0.045, mat='paint_secondary', normal_hint=(s, 0, 0),
                              chamfer=0.05, bolts=1, bolt_r=0.014, bolt_spacing=0.24))
        for k in range(3):   # gill slots behind the cheek plate
            g.merge(P.box((0.03, 0.05, 0.2), bevel=0.006, segs=1, mat='steel_dark').rotate((-25, 0, 0))
                    .move(s * 0.47, -0.68 - k * 0.1, 8.62))
        ant = P.antenna(0.9, r=0.01, base_r=0.036, segs=10)
        ant.rotate((-62, 0, 0)).move(s * 0.3, -0.76, 8.9)
        g.merge(ant)
        g.merge(P.cylinder(0.075, 0.1, 24, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                .align((s, 0, 0), loc=(s * 0.46, -1.05, 8.62)))
    # r3 secondary / tertiary density on the big head wedge (critic r2: flat planes with seams only):
    # recessed vent grilles either side of the crest, a bolted access hatch on each flank, rivet rows
    # along the top edges, a bolted sensor brow ridge and a raised bone panel on the snout
    for s in (1, -1):
        v = P.vent(0.17, 0.5, depth=0.04, slats=5, frame=0.022, mat='paint_dark')
        v.align((0, 0.05, 1), up=(0, -1, 0), loc=(s * 0.19, -1.18, 8.905))
        g.merge(v)
        g.merge(rivets((s * 0.3, -0.8, 8.922), (s * 0.3, -1.5, 8.892), 0.1, (0, 0, 1)))
        g.merge(P.box((0.06, 0.16, 0.05), bevel=0.006, segs=1, mat='steel_dark').move(s * 0.33, -1.62, 8.88))
    g.merge(K.plate_world([(-0.2, -1.62, 8.86), (0.2, -1.62, 8.86), (0.14, -2.14, 8.68), (-0.14, -2.14, 8.68)], 0.035,
                          mat='paint_secondary', normal_hint=(0, -0.3, 1), chamfer=0.04, bolts=1, bolt_r=0.012,
                          bolt_spacing=0.16))
    g.merge(K.strip((-0.36, -1.84, 8.7), (0.36, -1.84, 8.7), 0.05, 0.03, (0, -0.4, 1), mat='steel_dark'))
    # neck joint drum (pitch pivot)
    g.merge(K.drum(OLD_HEAD, (1, 0, 0), 0.26, 0.6, mat='paint_dark', hub=True, bolts=4))
    return _to_head(g)


def _to_head(g):
    return g.transform(Matrix.Translation(HEAD) @ Matrix.Scale(HEAD_S, 4) @ Matrix.Translation(-Vector(OLD_HEAD)))


def build_eye():
    g = Geo()
    # single slit: a thin glowing bar standing proud of the visor band (front face + wrapped ends)
    g.merge(K.shell([(-2.265, -0.33, 0.33, 8.52, 8.6, 0.012), (-1.88, -0.42, 0.42, 8.57, 8.65, 0.012)], 'Y',
                    bevel=0.004, mat='lens'))
    return _to_head(g)


# ============================================================================ arms
PAUL = [(1.70, 8.36), (1.82, 8.64), (2.26, 8.80), (2.58, 8.52), (2.50, 8.02), (2.34, 7.94), (2.28, 8.32)]


def build_arm(side):
    g = Geo()
    g.merge(K.drum(SHOULDER, (1, 0, 0), 0.4, 0.46, mat='paint_dark'))
    about = (2.2, 8.3)
    big = K.scale2(PAUL, 1.18, about)
    secs = [(K.scale2(PAUL, 0.62, about), -1.12 + DY), (big, -0.55 + DY), (K.scale2(big, 0.92, about), 0.6 + DY),
            ([(x, z + 0.32) for x, z in K.scale2(PAUL, 0.34, (2.3, 8.7))], 2.1 + DY)]
    pa = K.loft_pts(secs, axis='Y', bevel=0.02, mat='paint_primary')
    K.grooves(pa, [(1, 0, 0), (0, 0, 1), (1, 0, 1), (-1, 0, 1)], (0, 0.1, 0), (0, 1, 0))
    K.hatch_at(pa, (2.62, 1.3 + DY, 8.24), (1, 0, 0), (0.5, 0.34), u_axis=(0, 1, 0), recess=0.04, mat='steel_dark',
               angle=35)
    # r4 (critic r3 S 'flat pauldron planes'): extra seam rings split the slab into 4 armour segments, then
    # inset panels on every remaining big facet (not under the outer plate stack / top cream plate / louvres)
    for y in (-0.62 + DY, 0.95 + DY):
        K.grooves(pa, [(1, 0, 0), (0, 0, 1), (1, 0, 1), (-1, 0, 1), (0, 0, -1), (-1, 0, 0)], (0, y, 0), (0, 1, 0),
                  gap=0.022, depth=0.02)

    def skip_p(c, n):
        if n.x > 0.8 and 7.86 < c.z < 8.5 and -0.46 + DY < c.y < 0.56 + DY:
            return True                                    # outer plate + accent plate
        if n.z > 0.55 and c.x > 2.2:
            return True                                    # top cream plate + stripe
        return n.z > 0.55 and c.x < 2.16 and -0.4 + DY < c.y < 0.62 + DY   # louvre bank
    g.merge(panelize(pa, 201, min_area=0.08, skip=skip_p))
    g.merge(pa)
    # r4: front face of the slab: a bolted hatch + a lifting eye on the leading edge
    g.merge(K.shackle(0.07, bar=0.018, segs=(12, 6)).move(2.42, -0.9 + DY, 8.74))
    g.merge(K.plate_world([(2.3, -0.62 + DY, 8.8), (2.3, 0.9 + DY, 8.78), (2.52, 1.2 + DY, 8.58), (2.56, -0.5 + DY, 8.54)],
                          0.04, mat='paint_secondary', normal_hint=(0.6, 0, 1), chamfer=0.05))
    g.merge(K.strip((2.4, -0.76 + DY, 8.76), (2.34, 1.1 + DY, 8.72), 0.06, 0.05, (0.2, 0, 1)))
    g.merge(K.plate_world([(2.64, -0.4 + DY, 7.92), (2.64, 0.5 + DY, 7.92), (2.6, 0.5 + DY, 8.44), (2.6, -0.4 + DY, 8.44)],
                          0.05, mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.08, bolts=1, bolt_r=0.016))
    g.merge(K.plate_world([(2.645, -0.36 + DY, 8.0), (2.645, 0.46 + DY, 8.0), (2.62, 0.46 + DY, 8.36),
                           (2.62, -0.36 + DY, 8.36)], 0.03, mat='paint_accent', normal_hint=(1, 0, 0), chamfer=0.04))
    g.merge(marker((2.3, -1.12 + DY, 8.3), (0, -1, -0.2), 'red', 0.045))
    # r3: >= 3 secondary features on the slab (critic r2: under-detailed large plates)
    n_in = Vector((-0.34, 0, 0.94)).normalized()
    lv = P.louvres(0.34, 0.9, count=6, depth=0.05, angle=26, thickness=0.016, mat='steel_dark', side_mat='paint_dark')
    lv.align(n_in, up=(0, 1, 0), loc=(1.99, 0.1 + DY, 8.79))
    g.merge(lv)
    g.merge(rivets((2.31, -0.5 + DY, 8.9), (2.31, 1.6 + DY, 8.9), 0.14, (0.4, 0, 1)))
    g.merge(rivets((2.66, -0.3 + DY, 8.52), (2.66, 1.7 + DY, 8.52), 0.14, (1, 0, 0.4)))
    g.merge(K.shackle(0.07, bar=0.018, segs=(12, 6)).move(2.2, 1.55 + DY, 8.86))
    if side == 'L':
        # Grauwerk ID stripe (#D8A31A) across the slab
        g.merge(K.strip((2.0, 1.36 + DY, 8.79), (2.6, 1.36 + DY, 8.6), 0.16, 0.012, (0.3, 0, 1), mat='paint_accent'))
        g.merge(K.strip((2.0, 1.12 + DY, 8.79), (2.6, 1.12 + DY, 8.6), 0.05, 0.012, (0.3, 0, 1), mat='paint_accent'))
    u = Geo()
    ua = K.shell([(7.56, 1.76, 2.26, -0.5 + DY, 0.2 + DY, 0.1), (6.9, 1.8, 2.34, -0.52 + DY, 0.24 + DY, 0.12),
                  (6.5, 1.84, 2.3, -0.42 + DY, 0.2 + DY, 0.1)], 'Z', mat='paint_primary')
    K.hatch_at(ua, (2.06, -0.53 + DY, 7.0), (0, -1, 0), (0.3, 0.4), u_axis=(1, 0, 0), recess=0.03, mat='steel_dark')
    u.merge(panelize(ua, 211, min_area=0.06, max_side=0.4, skip=lambda c, n: n.y < -0.8))
    u.merge(ua)
    ex, ey, ez = ELBOW
    for cx, sg in ((1.78, -1), (2.38, 1)):
        u.merge(K.cheek((cx, ey, ez), sg, 0.34, 0.07, strap_to=(ey - 0.1, 6.66), strap_w=0.4, bolts=4))
    u.merge(K.ram((2.5, -0.46 + DY, 7.3), (2.5, ey, ez), r=0.06, frac=0.5, segs=20))
    u.merge(K.ram((1.72, 0.18 + DY, 7.4), (1.72, ey + 0.12, ez + 0.08), r=0.055, frac=0.5, segs=20))
    u.merge(P.box((0.18, 0.16, 0.16), bevel=0.01, segs=1, mat='steel_dark').move(2.36, -0.46 + DY, 7.3))
    u.merge(P.cylinder(0.05, 0.14, 16, bevel=0.006, mat='steel').rotate((0, 90, 0)).move(2.46, ey, ez))
    u.transform(R_UP)
    g.merge(u)
    if side == 'R':
        g.mirror('X')
    return g


def build_forearm_R():
    """Slim right forearm (authored on +X, mirrored): long housing, tendon ram, cable."""
    g = Geo()
    g.merge(K.drum(ELBOW0, (1, 0, 0), 0.3, 0.52, mat='paint_dark', hub=False))
    c = (0.08, 0.1, 0.2, 0.12)
    fa = K.shell([(-0.02, 1.72, 2.44, 5.72, 6.44, c), (-0.8, 1.68, 2.48, 5.7, 6.5, c),
                  (-1.86, 1.8, 2.4, 5.8, 6.3, c)], 'Y', mat='paint_primary')
    for y in (-0.6, -1.3):
        K.grooves(fa, [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (1, 0, 1)], (0, y, 0), (0, 1, 0))
    arm = [K.plate_at(fa, (2.49, -0.9, 6.1), (1, 0, 0), u_axis=(0, -1, 0), margin=0.05, thickness=0.045, chamfer=0.06,
                      mat='paint_secondary', bolts=1, bolt_r=0.014, bolt_spacing=0.34)]
    arm.append(panelize(fa, 301, min_area=0.07, max_side=0.42, skip=lambda c, n: n.x > 0.8))
    g.merge(fa, *[x for x in arm if x is not None])
    g.merge(K.ram((2.08, -0.06, 5.64), (2.08, -1.72, 5.7), r=0.06, frac=0.55, segs=16))
    g.merge(P.hose([(1.74, 0.0, 6.2), (1.7, -0.9, 6.1), (1.8, -1.8, 6.1)], 0.03, 8, rib_amp=0.004, rib_freq=30))
    g.merge(K.shell([(-1.84, 1.84, 2.36, 5.86, 6.3, 0.1), (-2.0, 1.88, 2.32, 5.9, 6.26, 0.1)], 'Y', mat='steel_dark'))
    return g.mirror('X').move(0, DY, 0).move(*ARM_D)


def build_hand_R():
    g = Geo()
    gx, gy, zt = WRIST[0], -2.24, 6.06
    g.merge(P.cylinder(0.13, 0.44, 24, bevel=0.01, mat='steel').rotate((0, 90, 0)).move(gx, -2.04, zt - 0.04))
    g.merge(P.box((0.15, 0.42, 0.52), bevel=0.018, segs=1, chamfer=0.035, chamfer_axes='X', mat='steel_dark')
            .move(gx + 0.17, gy + 0.02, zt - 0.22))
    g.merge(K.plate_world([(gx + 0.255, gy + 0.2, zt - 0.46), (gx + 0.255, gy + 0.2, zt), (gx + 0.255, gy - 0.22, zt - 0.04),
                           (gx + 0.255, gy - 0.2, zt - 0.44)], 0.045, mat='paint_primary', normal_hint=(1, 0, 0),
                          chamfer=0.04))
    for i in range(4):
        z = zt - 0.08 - i * 0.11
        g.merge(P.box((0.08, 0.2, 0.09), bevel=0.01, segs=1, mat='steel_dark').move(gx + 0.12, gy - 0.16, z))
        g.merge(P.box((0.22, 0.08, 0.09), bevel=0.01, segs=1, mat='paint_primary').move(gx + 0.01, gy - 0.27, z))
        g.merge(P.box((0.07, 0.15, 0.085), bevel=0.01, segs=1, mat='steel_dark').move(gx - 0.11, gy - 0.18, z))
    return g.mirror('X').move(0, DY, 0).move(*ARM_D)


def build_plasma_arm():
    """PX-2 plasma lance / micro-missile arm: the whole LEFT forearm is the weapon (+X)."""
    g = Geo()
    g.merge(K.drum(ELBOW0, (1, 0, 0), 0.34, 0.54, mat='paint_dark', hub=False))
    c = (0.1, 0.12, 0.3, 0.14)
    body = K.shell([(0.0, 1.66, 2.56, 5.62, 6.62, c), (-0.7, 1.6, 2.64, 5.56, 6.74, c), (-2.0, 1.66, 2.6, 5.6, 6.62, c),
                    (-2.5, 1.78, 2.46, 5.72, 6.46, c)], 'Y', mat='paint_primary')
    for y in (-0.5, -1.4):
        K.grooves(body, [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (1, 0, 1), (0, 0, -1)], (0, y, 0), (0, 1, 0))
    arm = [K.plate_at(body, (2.65, -1.0, 6.1), (1, 0, 0), u_axis=(0, -1, 0), margin=0.06, thickness=0.05,
                      chamfer=0.08, mat='paint_secondary', bolts=1, bolt_r=0.016, bolt_spacing=0.36)]
    # r4: inset panels on the inner flank / belly / nose of the lance housing (outer plate + cells excluded)
    arm.append(panelize(body, 311, min_area=0.07, max_side=0.5, down_ok=True,
                        skip=lambda c, n: n.x > 0.8 or (n.z > 0.8 and -1.5 < c.y < -0.5)))
    g.merge(body, *[x for x in arm if x is not None])
    # micro-missile cells on top
    cp, cells = K.cell_panel(0.7, 0.9, 2, 3, 0.05, 0.04, 0.08, t=0.1, mat='paint_primary')
    M = Matrix.Translation((2.1, -1.0, 6.78))
    cp.transform(M)
    g.merge(cp)
    for (x, y, z) in cells:
        g.merge(P.dome(0.07, 0.06, 16, 2, mat='paint_accent').move(2.1 + x, -1.0 + y, 6.72))
    # plasma projector: twin rails + red-hot core coil (glow) ahead of the arm
    for x in (1.92, 2.32):
        rl = P.prism(P.fillet([(-2.4, 5.84), (-3.5, 5.94), (-3.56, 6.04), (-2.4, 6.3)], 0.03, 1), 0.1, bevel=0.012,
                     segs=1, mat='steel_dark', axis='X')
        g.merge(rl.move(x, 0, 0))
    coil = P.banded_cylinder([(0.08, 0.1, 'steel_dark'), (0.06, 0.13, 'glow'), (0.05, 0.1, 'steel_dark'),
                              (0.06, 0.13, 'glow'), (0.05, 0.1, 'steel_dark'), (0.06, 0.13, 'glow'), (0.1, 0.1, 'steel')],
                             segs=24, step=0.0, mat='steel_dark')
    g.merge(coil.align((0, -1, 0), loc=(2.12, -2.5, 6.08)))
    g.merge(P.hose([(1.72, -0.2, 6.4), (1.6, -1.2, 6.5), (1.8, -2.3, 6.3)], 0.035, 8, rib_amp=0.004, rib_freq=28))
    g.merge(P.bolt_row((2.645, -0.3, 5.8), (2.645, -1.9, 5.8), 5, (1, 0, 0), r=0.015))
    return g.move(0, DY, 0).move(*ARM_D)


def build_rifle():
    """GLR-3 laser rifle for the RIGHT hand, authored at x = 0 then moved to WPN_R."""
    g = Geo()
    gx, gy, gz = WPN_R
    y0 = gy + 0.3
    rec = P.prism([(y0, 0.0), (y0 - 1.6, 0.0), (y0 - 1.6, 0.4), (y0 - 1.42, 0.52), (y0 - 0.2, 0.52), (y0, 0.34)], 0.3,
                  bevel=0.014, segs=1, mat='paint_primary', axis='X').move(0, 0, gz + 0.14)
    for y in (y0 - 0.55, y0 - 1.1):
        K.grooves(rec, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, y, 0), (0, 1, 0))
    arm = [K.plate_at(rec, (-0.16, y0 - 0.8, gz + 0.4), (-1, 0, 0), u_axis=(0, -1, 0), margin=0.03, thickness=0.03,
                      chamfer=0.04, mat='paint_secondary', bolts=1, bolt_r=0.012, bolt_spacing=0.2)]
    g.merge(rec, *[x for x in arm if x is not None])
    g.merge(P.box((0.14, 0.17, 0.48), bevel=0.018, segs=1, chamfer=0.03, chamfer_axes='Z', mat='rubber')
            .rotate((-12, 0, 0)).move(0, gy, gz - 0.02))
    cellb = P.banded_cylinder([(0.04, 0.1, 'steel_dark'), (0.5, 0.12), (0.04, 0.1, 'steel_dark'), (0.1, 0.12, 'hazard')],
                              segs=24, step=0.0, mat='paint_dark')
    g.merge(cellb.align((0, -1, 0), loc=(0.0, y0 - 0.2, gz + 0.02)))
    # long emitter barrel with cooling vanes
    bz = gz + 0.32
    g.merge(P.cylinder(0.1, 2.5, 32, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0).align((0, -1, 0), loc=(0, y0 - 1.6, bz)))
    for k in range(9):
        y = y0 - 1.8 - k * 0.22
        g.merge(P.box((0.34, 0.03, 0.34), bevel=0.006, segs=1, chamfer=0.08, chamfer_axes='Y', mat='steel')
                .move(0, y, bz))
    for s in (-1, 1):
        g.merge(P.box((0.03, 2.0, 0.08), bevel=0.006, segs=1, mat='paint_primary').move(s * 0.17, y0 - 2.7, bz))
    g.merge(P.box((0.18, 1.2, 0.05), bevel=0.008, segs=1, mat='paint_secondary').move(0, y0 - 2.4, bz + 0.19))
    g.merge(P.ring(0.16, 0.08, 0.14, 32, bevel=0.0, mat='steel_dark', z0=0.0).align((0, -1, 0), loc=(0, y0 - 4.1, bz)))
    g.merge(P.cylinder(0.085, 0.02, 32, bevel=0.0, mat='lens', z0=0.0).align((0, -1, 0), loc=(0, y0 - 4.2, bz)))
    g.merge(P.ring(0.13, 0.1, 0.05, 32, bevel=0.0, mat='hazard', z0=0.0).align((0, -1, 0), loc=(0, y0 - 3.9, bz)))
    g.merge(K.shell([(y0 - 0.1, -0.1, 0.1, gz + 0.66, gz + 0.8, 0.03), (y0 - 0.6, -0.1, 0.1, gz + 0.66, gz + 0.8, 0.03)],
                    'Y', mat='steel_dark'))
    g.merge(P.hose([(0.16, y0 - 0.1, gz + 0.1), (0.24, y0 + 0.3, gz + 0.2), (0.2, y0 + 0.6, gz + 0.3)], 0.025, 8,
                   rib_amp=0.003, rib_freq=34))
    return g.move(gx, 0, 0).move(*ARM_D)


def build_missile_pod():
    """Left back: 6-cell micro-missile pod, angled up."""
    g = Geo()
    bx, by, bz = MOUNT_L
    g.merge(K.drum((bx, by, bz), (1, 0, 0), 0.17, 0.36, mat='paint_dark', profile='ring', bolts=4))
    pod = K.shell([(by - 0.9, bx - 0.36, bx + 0.36, bz + 0.14, bz + 0.74, 0.08),
                   (by - 0.72, bx - 0.38, bx + 0.38, bz + 0.1, bz + 0.8, 0.1),
                   (by + 0.7, bx - 0.36, bx + 0.36, bz + 0.1, bz + 0.72, 0.1)], 'Y', mat='paint_primary')
    K.grooves(pod, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, by, 0), (0, 1, 0))
    g.merge(pod)
    cp, cells = K.cell_panel(0.66, 0.5, 3, 2, 0.05, 0.04, 0.08, t=0.1, mat='paint_primary')
    M = Matrix.Translation((bx, by - 0.98, bz + 0.46)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    cp.transform(M)
    g.merge(cp)
    for (x, y, z) in cells:
        p = M @ Vector((x, y, -0.08))
        g.merge(P.dome(0.06, 0.07, 16, 2, mat='paint_secondary').align((0, -1, 0), loc=p))
    g.merge(K.strip((bx - 0.36, by - 0.2, bz + 0.81), (bx + 0.36, by - 0.2, bz + 0.81), 0.1, 0.01, (0, 0, 1)))
    # pitch the pod up 18 deg around its pivot
    g.transform(Matrix.Translation((bx, by, bz)) @ Matrix.Rotation(math.radians(18), 4, 'X') @
                Matrix.Translation((-bx, -by, -bz)))
    return g


def build_sensor_mast():
    """Right back: command sensor mast (radar blade + optics)."""
    g = Geo()
    bx, by, bz = MOUNT_R
    g.merge(K.drum((bx, by, bz), (1, 0, 0), 0.17, 0.36, mat='paint_dark', profile='ring', bolts=4))
    g.merge(K.limb((bx, by, bz), (bx - 0.1, by + 0.5, bz + 1.1), [(0, -0.16, 0.16, -0.14, 0.14, 0.05),
                                                                   (1, -0.1, 0.1, -0.09, 0.09, 0.03)], mat='paint_dark'))
    blade = P.prism(P.fillet([(-0.5, 0.0), (0.5, 0.0), (0.42, 0.18), (-0.42, 0.18)], 0.02, 1), 0.06, bevel=0.01, segs=1,
                    mat='paint_secondary', axis='Y')
    blade.rotate((0, 0, 8)).move(bx - 0.12, by + 0.55, bz + 1.12)
    g.merge(blade)
    g.merge(K.strip((bx - 0.5, by + 0.52, bz + 1.31), (bx + 0.3, by + 0.52, bz + 1.34), 0.05, 0.01, (0, -1, 0)))
    g.merge(P.cylinder(0.08, 0.14, 24, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0).align((0, -1, 0),
                                                                                              loc=(bx - 0.1, by + 0.4, bz + 1.0)))
    g.merge(P.dome(0.055, 0.03, 20, 2, mat='lens').align((0, -1, 0), loc=(bx - 0.1, by + 0.26, bz + 1.0)))
    g.merge(P.antenna(1.1, r=0.009, base_r=0.03, segs=10).move(bx + 0.14, by + 0.5, bz + 0.6))
    return g


# ============================================================================ back unit
def build_back():
    g = Geo()
    sp = K.limb((0, 0.78, 6.55), (0, -0.12, 8.7), [(0, -0.46, 0.46, -0.36, 0.3, 0.12), (0.5, -0.56, 0.56, -0.46, 0.34, 0.14),
                                                  (1, -0.44, 0.44, -0.36, 0.28, 0.12)], mat='paint_dark')
    K.hatch_at(sp, (0, 0.75, 7.2), (0, 1, 0.4), (0.4, 0.5), u_axis=(1, 0, 0), recess=0.05, mat='steel_dark', angle=35)
    g.merge(panelize(sp, 401, min_area=0.08, max_side=0.42, skip=lambda c, n: n.z > 0.7))
    g.merge(sp)
    # r4: lifting eyes either side of the spine (crane points for the pier gantry)
    for s in (1, -1):
        g.merge(K.shackle(0.07, bar=0.018, segs=(12, 6)).align((s * 0.7, 0.3, 0.65), up=(0, 1, 0),
                                                               loc=(s * 0.4, 0.62, 7.85)))
    # radiator hackles: four short raked heat-sink blocks along the spine (dark oxide with
    # steel fin stacks and a glowing core slot): a jagged dorsal read without a pale slab
    hs = [0.62, 0.86, 0.8, 0.56]
    for i, h in enumerate(hs):
        y = 0.0 + i * 0.3
        z = 8.46 - i * 0.46
        fin = P.prism([(0.0, 0.0), (0.46, 0.0), (0.3 + h * 0.62, h), (0.08 + h * 0.56, h)], 0.2,
                      bevel=0.014, segs=1, mat='paint_primary' if i % 2 == 0 else 'paint_dark', axis='X')
        fin.move(0, y, z)
        g.merge(fin)
        g.merge(K.strip((0.0, y + 0.1 + h * 0.56, z + h + 0.004), (0.0, y + 0.3 + h * 0.62, z + h + 0.004), 0.2, 0.02,
                        (0, 0, 1), mat='paint_accent' if i % 2 else 'paint_secondary'))
        g.merge(P.box((0.04, 0.1, h * 0.5), bevel=0.004, segs=1, mat='glow').rotate((-30, 0, 0))
                .move(0.0, y + 0.34 + h * 0.2, z + h * 0.42))
        for s_ in (-1, 1):
            for k in range(3):
                g.merge(P.box((0.02, 0.24, h * 0.62), bevel=0.0, segs=1, mat='steel_dark').rotate((-30, 0, 0))
                        .move(s_ * (0.11 + k * 0.035), y + 0.3 + h * 0.2, z + h * 0.4))
    # twin booster pods angled down-back
    for s in (1, -1):
        p0, p1 = Vector((s * 0.82, 0.5, 7.9)), Vector((s * 0.92, 1.72, 6.42))
        pod = K.limb(p0, p1, [(0, -0.3, 0.3, -0.3, 0.3, 0.1), (0.2, -0.36, 0.36, -0.36, 0.36, 0.12),
                              (0.85, -0.34, 0.34, -0.34, 0.34, 0.12), (1, -0.3, 0.3, -0.3, 0.3, 0.1)], mat='paint_primary')
        K.grooves(pod, [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)], (p0 + p1) * 0.5, (p1 - p0).normalized())
        nb = Vector((0, (p1 - p0).normalized().z, -(p1 - p0).normalized().y)).normalized()
        nb = -nb if nb.y < 0 else nb
        g.merge(panelize(pod, 411 + (s > 0), min_area=0.06, max_side=0.42,
                         skip=lambda c, n, s=s, nb=nb: n.x * s > 0.8 or n.dot(nb) > 0.8))
        g.merge(pod)
        # r4 (critic r3): heat-shield louvre bank over each booster pod (the face toward the spine/top)
        hl = P.louvres(0.3, 0.46, count=6, depth=0.04, angle=28, thickness=0.014, mat='steel_dark',
                       side_mat='paint_dark')
        dpod = (p1 - p0).normalized()
        hl.align(nb, up=dpod, loc=p0.lerp(p1, 0.56) + nb * 0.424)
        g.merge(hl)
        lv = P.louvres(0.5, 0.9, count=5, depth=0.05, angle=24, thickness=0.018, mat='steel_dark', side_mat='paint_dark')
        M, L = K.frame_along(p0, p1)
        lv.transform(Matrix.Translation(p0.lerp(p1, 0.5) + Vector((s * 0.36, 0, 0))) @
                     Matrix.Rotation(math.radians(90 * s), 4, 'Y') @ Matrix.Rotation(math.radians(-51), 4, 'X'))
        g.merge(lv)
        g.merge(P.box((0.5, 0.4, 0.3), bevel=0.02, segs=1, chamfer=0.06, chamfer_axes='X', mat='steel_dark')
                .move(s * 0.62, 0.4, 7.96))
        d = (p1 - p0).normalized()
        for t, m, w in ((0.18, 'steel_dark', 0.08), (0.62, 'steel_dark', 0.08), (0.9, 'hazard', 0.1)):
            c = p0.lerp(p1, t)
            band = K.limb(c - d * w / 2, c + d * w / 2, [(0, -0.38, 0.38, -0.38, 0.38, 0.13),
                                                         (1, -0.38, 0.38, -0.38, 0.38, 0.13)], mat=m)
            g.merge(band)
        g.merge(P.hose([p0 + Vector((-s * 0.3, 0.1, -0.1)), p0.lerp(p1, 0.4) + Vector((-s * 0.38, 0, 0.1)),
                        p0.lerp(p1, 0.8) + Vector((-s * 0.34, 0, 0))], 0.035, 8, rib_amp=0.004, rib_freq=28))
        # back plate armour on the pod (cream) with bolts
        n = Vector((0, d.z, -d.y)).normalized()
        if n.y < 0:
            n = -n
        q0, q1 = p0.lerp(p1, 0.25) + n * 0.38, p0.lerp(p1, 0.8) + n * 0.38
        g.merge(K.plate_world([q0 + Vector((-0.24, 0, 0)), q0 + Vector((0.24, 0, 0)), q1 + Vector((0.2, 0, 0)),
                               q1 + Vector((-0.2, 0, 0))], 0.04, mat='paint_secondary', normal_hint=n, chamfer=0.06,
                              bolts=1, bolt_r=0.014, bolt_spacing=0.3))
    return g


# ============================================================================ legs (reverse-joint look)
def build_thigh():
    g = Geo()
    g.merge(K.drum(HIP, (1, 0, 0), 0.4, 0.62, mat='paint_dark', hub=False))
    th = K.limb(HIP, KNEE, [(0.05, 0.72, 1.34, -0.42, 0.42, 0.14), (0.4, 0.62, 1.44, -0.5, 0.56, 0.2),
                            (0.8, 0.7, 1.42, -0.4, 0.44, 0.16), (0.95, 0.76, 1.36, -0.32, 0.36, 0.12)],
                mat='paint_primary')
    th.transform(Matrix.Translation((-1.0, 0, 0)))   # sections are in absolute x: undo limb's p0.x offset
    dth = (Vector(KNEE) - Vector(HIP)).normalized()
    seams(th, dth, HIP, [(1, 0, 0), (-1, 0, 0), (0, -1, 0), (0, 1, 0)], (0.62, 1.32))
    fn0 = Vector((0, dth.z, -dth.y)).normalized()
    fn0 = -fn0 if fn0.y > 0 else fn0
    g.merge(panelize(th, 601, min_area=0.06, max_side=0.44, skip=lambda c, n: n.x > 0.8 or n.dot(fn0) > 0.8))
    g.merge(th)
    # r4 (critic r3: 'exposed hip hydraulic rams'): a 32-segment chrome hip ram down the back of the thigh
    bn = -fn0
    g.merge(K.ram(Vector(HIP) + bn * 0.62 + Vector((0.0, 0, -0.3)) + dth * 0.1,
                  Vector(HIP).lerp(Vector(KNEE), 0.78) + bn * 0.56, r=0.07, frac=0.5, segs=32))
    for t in (0.06, 0.8):
        g.merge(P.box((0.2, 0.16, 0.18), bevel=0.012, segs=1, mat='steel_dark')
                .move(*(Vector(HIP).lerp(Vector(KNEE), t) + bn * 0.5 + Vector((0, 0, 0.0)))))
    g.merge(pad([(1.45, 0.1, 5.02), (1.45, -0.62, 4.1), (1.44, -0.3, 3.9), (1.45, 0.34, 4.7)], 0.05,
                normal_hint=(1, 0, 0), chamfer=0.05))
    g.merge(pad([(1.46, -0.3, 5.52), (1.46, 0.62, 5.36), (1.46, 0.6, 4.98), (1.46, -0.22, 5.04)], 0.05,
                mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.05, inner=0.16))
    g.merge(rivets(Vector(HIP) + Vector((0.47, 0.3, -0.5)), Vector(KNEE) + Vector((0.4, 0.26, 0.5)), 0.12, (1, 0, 0)))
    g.merge(rivets(Vector(HIP) + Vector((-0.31, 0.2, -0.45)), Vector(KNEE) + Vector((-0.37, 0.2, 0.5)), 0.12, (-1, 0, 0)))
    kx, ky, kz = KNEE
    d = (Vector(KNEE) - Vector(HIP)).normalized()
    fn = Vector((0, d.z, -d.y)).normalized()
    if fn.y > 0:
        fn = -fn
    q0, q1 = Vector(HIP).lerp(Vector(KNEE), 0.28) + fn * 0.55, Vector(HIP).lerp(Vector(KNEE), 0.82) + fn * 0.42
    g.merge(pad([q0 + Vector((-0.34, 0, 0)), q0 + Vector((0.34, 0, 0)), q1 + Vector((0.28, 0, 0)),
                 q1 + Vector((-0.28, 0, 0))], 0.06, normal_hint=fn, chamfer=0.06))
    g.merge(K.strip(q0 + Vector((-0.3, 0, 0)) + fn * 0.07, q0 + Vector((0.3, 0, 0)) + fn * 0.07, 0.08, 0.01, fn))
    for cx, sg in ((0.72, -1), (1.44, 1)):
        g.merge(K.cheek((cx, ky, kz), sg, 0.4, 0.08, strap_to=(ky + 0.3, kz + 0.42), strap_w=0.44))
    g.merge(K.ram((1.58, 0.55, 4.9), (1.58, ky, kz), r=0.075, frac=0.5, segs=32))
    g.merge(K.ram((0.66, 0.5, 5.0), (0.66, ky + 0.2, kz + 0.1), r=0.065, frac=0.5, segs=32))
    g.merge(P.box((0.22, 0.2, 0.2), bevel=0.012, segs=1, mat='steel_dark').move(1.47, 0.55, 4.9))
    g.merge(P.cylinder(0.06, 0.18, 16, bevel=0.008, mat='steel').rotate((0, 90, 0)).move(1.52, ky, kz))
    return g


def build_shin():
    g = Geo()
    kx, ky, kz = KNEE
    hx, hy, hz = HOCK
    ax, ay, az = ANKLE
    g.merge(K.drum(KNEE, (1, 0, 0), 0.36, 0.7, mat='paint_dark', hub=False))
    # forward knee cap (the hound's 'elbow' spike): layered cream wedge + oxide under-plate
    cap = P.prism([(ky - 0.2, kz + 0.36), (ky - 0.52, kz + 0.2), (ky - 0.66, kz - 0.14), (ky - 0.5, kz - 0.5),
                   (ky - 0.36, kz - 0.42), (ky - 0.44, kz - 0.08), (ky - 0.3, kz + 0.16)], 0.6, bevel=0.016, segs=1,
                  mat='paint_secondary', axis='X')
    g.merge(cap.move(kx, 0, 0))
    g.merge(K.strip((kx - 0.28, ky - 0.6, kz - 0.2), (kx + 0.28, ky - 0.6, kz - 0.2), 0.08, 0.012, (0, -1, -0.3),
                    mat='paint_accent'))
    d_mt = (Vector(ANKLE) - Vector(HOCK)).normalized()
    n_mt = Vector((0, d_mt.z, -d_mt.y)).normalized()
    if n_mt.y > 0:
        n_mt = -n_mt
    q0, q1 = Vector(HOCK) + d_mt * 0.2 + n_mt * 0.3, Vector(HOCK) + d_mt * 1.05 + n_mt * 0.25
    g.merge(K.plate_world([q0 + Vector((-0.24, 0, 0)), q0 + Vector((0.24, 0, 0)), q1 + Vector((0.2, 0, 0)),
                           q1 + Vector((-0.2, 0, 0))], 0.05, mat='paint_primary', normal_hint=n_mt, chamfer=0.05,
                          bolts=1, bolt_r=0.014, bolt_spacing=0.24))
    g.merge(rivets(q0 + n_mt * 0.055 + Vector((0.16, 0, 0)), q1 + n_mt * 0.055 + Vector((0.13, 0, 0)), 0.12, n_mt))
    g.merge(marker(Vector(HOCK) + Vector((0.34, 0.18, -0.1)), (1, 0.4, 0), 'amber', 0.035))
    up = K.limb(KNEE, HOCK, [(0.0, 0.8, 1.36, -0.34, 0.3, 0.12), (0.25, 0.7, 1.46, -0.5, 0.44, 0.18),
                             (0.75, 0.78, 1.42, -0.4, 0.36, 0.14), (1.0, 0.84, 1.36, -0.3, 0.3, 0.1)], mat='paint_primary')
    up.transform(Matrix.Translation((-kx, 0, 0)))
    dsh = (Vector(HOCK) - Vector(KNEE)).normalized()
    seams(up, dsh, KNEE, [(1, 0, 0), (-1, 0, 0), (0, -1, 0), (0, 1, 0)], (0.7, 1.45))
    ng0 = Vector((0, -dsh.z, dsh.y)).normalized()
    ng0 = -ng0 if ng0.y > 0 else ng0
    g.merge(panelize(up, 701, min_area=0.06, max_side=0.42, skip=lambda c, n: n.dot(ng0) > 0.8))
    g.merge(up)
    g.merge(rivets(Vector(KNEE) + dsh * 0.5 + Vector((0.4, 0.3, 0)), Vector(KNEE) + dsh * 1.7 + Vector((0.34, 0.26, 0)),
                   0.12, (1, 0, 0)))
    # cream greave on the upper shin (facing forward-down)
    d = (Vector(HOCK) - Vector(KNEE)).normalized()
    nrm = Vector((0, -d.z, d.y)).normalized()
    if nrm.y > 0:
        nrm = -nrm
    q = [Vector(KNEE) + d * t + nrm * 0.5 for t in (0.35, 1.45)]
    g.merge(pad([q[0] + Vector((-0.34, 0, 0)), q[0] + Vector((0.34, 0, 0)), q[1] + Vector((0.28, 0, 0)),
                 q[1] + Vector((-0.28, 0, 0))], 0.06, normal_hint=nrm, chamfer=0.06))
    # hock joint (fixed) + rear spur
    g.merge(K.drum(HOCK, (1, 0, 0), 0.3, 0.62, mat='paint_dark', accent='paint_accent'))
    sp = P.prism(P.fillet([(hy - 0.1, hz + 0.3), (hy + 0.62, hz - 0.12), (hy + 0.2, hz - 0.2)], 0.03, 1), 0.2,
                 bevel=0.012, segs=1, mat='paint_secondary', axis='X').move(hx, 0, 0)
    g.merge(sp)
    # metatarsus (hock -> ankle)
    mt = K.limb(HOCK, ANKLE, [(0.0, 0.86, 1.34, -0.28, 0.26, 0.1), (0.5, 0.88, 1.36, -0.3, 0.28, 0.1),
                              (1.0, 0.9, 1.34, -0.24, 0.22, 0.08)], mat='paint_primary')
    mt.transform(Matrix.Translation((-hx, 0, 0)))
    dmt = (Vector(ANKLE) - Vector(HOCK)).normalized()
    seams(mt, dmt, HOCK, [(1, 0, 0), (-1, 0, 0), (0, -1, 0), (0, 1, 0)], (0.45, 0.95))
    g.merge(panelize(mt, 711, min_area=0.05, max_side=0.36, skip=lambda c, n: n.dot(n_mt) > 0.8))
    g.merge(mt)
    # tendon rams: knee region -> hock (both inside the shin node, so they never detach)
    for x in (0.78, 1.42):
        g.merge(K.ram((x, -0.62, 3.2), (x, hy - 0.05, hz + 0.1), r=0.065, frac=0.5, segs=32))
    # r4 (critic r3: 'exposed ankle rams'): twin 32-segment chrome ankle rams (outer + inner)
    for x in (1.46, 0.76):
        g.merge(K.ram((x, hy, hz), (x, ay + 0.12, az + 0.1), r=0.058, frac=0.55, segs=32))
    # ankle cheeks
    for cx, sg in ((0.84, -1), (1.4, 1)):
        g.merge(K.cheek((cx, ay, az), sg, 0.26, 0.07, strap_to=(ay + 0.2, az + 0.42), strap_w=0.3))
    # calf vernier housing on the metatarsus back
    g.merge(P.box((0.36, 0.3, 0.5), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Z', mat='paint_dark')
            .move(hx, hy + 0.12, hz - 0.5))
    return g


def build_foot():
    g = Geo()
    ax, ay, az = ANKLE
    g.merge(K.drum(ANKLE, (1, 0, 0), 0.24, 0.52, mat='paint_dark', hub=False))
    g.merge(P.frustum((0.56, 0.7), (0.4, 0.44), 0.4, bevel=0.018, segs=1, chamfer=0.05, mat='paint_dark')
            .move(ax, ay + 0.02, 0.34))
    # three forward claws + rear spur
    for dx, ln, sc in ((-0.34, 1.2, 0.85), (0.0, 1.5, 1.0), (0.34, 1.2, 0.85)):
        # r4 (critic r3: 'smooth blob toe claws'): hard chamfered wedge + a separate dark steel chisel tip,
        # a hinge knuckle at the root and a bolted wear strip on top
        r0 = Vector((ax + dx * 0.6, ay - 0.1, 0.42))
        tip = Vector((ax + dx, ay - ln, 0.1))
        mid = r0.lerp(tip, 0.78)
        g.merge(claw(r0, mid, 0.32 * sc, 0.24 * sc, 0.34, 0.2))
        g.merge(claw(mid - (tip - r0).normalized() * 0.02, tip, 0.22 * sc, 0.07, 0.19, 0.06, mat='steel_dark'))
        g.merge(K.drum(r0 + Vector((0, -0.02, -0.04)), (1, 0, 0), 0.14, 0.36 * sc, mat='paint_dark', hub=False, segs=24,
                       profile='ring'))
        d_ = (tip - r0).normalized()
        nt_ = Vector((0, -d_.z, d_.y)).normalized()
        nt_ = -nt_ if nt_.z < 0 else nt_
        g.merge(K.strip(r0.lerp(tip, 0.3) + nt_ * 0.2, r0.lerp(tip, 0.6) + nt_ * 0.16, 0.12 * sc, 0.012, nt_,
                        mat='hazard'))
    g.merge(K.limb((ax, ay + 0.1, 0.36), (ax, ay + 0.95, 0.06), [(0, -0.18, 0.18, -0.12, 0.16, 0.05),
                                                                 (1, -0.07, 0.07, -0.04, 0.06, 0.02)],
                   mat='paint_secondary'))
    g.merge(K.shell([(ay - 0.9, ax - 0.5, ax + 0.5, 0.0, 0.1, 0.03), (ay + 0.4, ax - 0.4, ax + 0.4, 0.0, 0.1, 0.03)], 'Y',
                    bevel=0.01, mat='steel_dark'))
    return g


# ============================================================================ assembly
def build(a):
    K.BOLT_SPACING = 1.4      # r4: denser bolt rows on the boss plates (r3 1.6; global default is now 2.0)
    r4_keep()
    a.pivot('pelvis', PELVIS)
    a.pivot('torso', TORSO, parent='pelvis')
    a.pivot('head', HEAD, parent='torso')
    a.pivot('eye', EYE, parent='head', iw_eye_color='#FF2A2A', iw_eye_strength=9.0)
    for S, m in (('L', lambda p: p), ('R', mx)):
        a.pivot('thigh_' + S, m(HIP), parent='pelvis')
        a.pivot('shin_' + S, m(KNEE), parent='thigh_' + S)
        a.pivot('foot_' + S, m(ANKLE), parent='shin_' + S)
        a.pivot('arm_' + S, m(SHOULDER), parent='torso')
        a.pivot('forearm_' + S, m(fwd(ELBOW)), parent='arm_' + S)
        a.pivot('hand_' + S, m(fwd(WRIST)), parent='forearm_' + S)
        a.pivot('booster_' + S, m(SIDEBOOST), parent='torso')
    a.pivot('shoulder_L', MOUNT_L, parent='torso')
    a.pivot('shoulder_R', MOUNT_R, parent='torso')
    a.pivot('weapon_R', fwd(WPN_R), parent='hand_R')
    a.pivot('weapon_L', fwd(WPN_L), parent='hand_L')
    a.pivot('booster_back', BACK, parent='torso')
    a.muzzle('muzzle_R', fwd(MUZ_R), fire=(0, -1, 0), parent='weapon_R')
    a.muzzle('muzzle_L', fwd(MUZ_L), fire=(0, -1, 0), parent='weapon_L')
    a.muzzle('muzzle_RB', (MOUNT_R[0] - 0.1, MOUNT_R[1] + 0.2, MOUNT_R[2] + 1.0), fire=(0, -1, 0.1), parent='shoulder_R')
    a.muzzle('muzzle_LB', MUZ_LB, fire=(0, -1, 0.33), parent='shoulder_L')
    tris = {}

    def put(name, g, parent, sharp=24.0):
        g.cull_inside()
        K.drop_hidden(g)
        ob = a.part(name, g, parent=parent, sharp_angle=sharp)
        tris[name] = iw.tri_count([ob])
        return ob

    with iw.timed('model'):
        put('pelvis_geo', build_pelvis(), 'pelvis')
        put('torso_geo', build_torso(), 'torso', sharp=14.0)
        put('head_geo', build_head(), 'head')
        put('eye_geo', build_eye(), 'eye', sharp=60.0)
        put('booster_back_geo', build_back(), 'booster_back')
        put('weapon_R_geo', build_rifle(), 'weapon_R')
        put('weapon_L_geo', build_plasma_arm(), 'weapon_L')
        put('shoulder_L_geo', build_missile_pod(), 'shoulder_L')
        put('shoulder_R_geo', build_sensor_mast(), 'shoulder_R')
        put('forearm_R_geo', build_forearm_R(), 'forearm_R')
        put('hand_R_geo', build_hand_R(), 'hand_R')
        th, sh, ft = build_thigh(), build_shin(), build_foot()
        for S in ('L', 'R'):
            gth, gsh, gft = th.copy(), sh.copy(), ft.copy()
            if S == 'R':
                gth.mirror('X')
                gsh.mirror('X')
                gft.mirror('X')
            put(f'thigh_{S}_geo', gth, f'thigh_{S}')
            put(f'shin_{S}_geo', gsh, f'shin_{S}')
            put(f'foot_{S}_geo', gft, f'foot_{S}')
            put(f'arm_{S}_geo', build_arm(S), f'arm_{S}')
        th.free()
        sh.free()
        ft.free()
        for i, s in enumerate((1, -1)):
            S = 'L' if s > 0 else 'R'
            p1 = Vector((s * 0.92, 1.72, 6.42))
            d = (p1 - Vector((s * 0.82, 0.5, 7.9))).normalized()
            K.nozzle_part(a, f'nozzle_back_{i}', tuple(p1 + d * 0.5), tuple(d), 'booster_back', 0.2, 0.33, 0.5,
                          segs=40, ribs=2, collar=2)
            K.nozzle_part(a, f'nozzle_{S}_0', (s * 1.62, 0.98, 6.9), (s, 0.3, -0.1), f'booster_{S}', 0.1, 0.17, 0.24,
                          segs=24, ribs=0, bolts=0)
            K.nozzle_part(a, f'nozzle_front_{S}', (s * 1.0, -1.16, 6.78), (0, -1, -0.5), 'torso', 0.07, 0.12, 0.2,
                          segs=24, ribs=0, bolts=0)
            K.nozzle_part(a, f'nozzle_leg_{S}', (s * 1.1, HOCK[1] + 0.12, HOCK[2] - 0.8), (0, 0.35, -1), f'shin_{S}',
                          0.09, 0.15, 0.22, segs=24, ribs=0, bolts=0)
            K.nozzle_part(a, f'nozzle_sh_{S}', (s * 2.42, 1.4 + DY, 8.62), (s * 0.4, 1, 0.2), f'arm_{S}', 0.08, 0.13,
                          0.18, segs=24, ribs=0, bolts=0)
    iw.log('r4 panelize:', PANEL_STATS, 'card keep-outs', len(CARD_KEEP))
    return tris


def _leg_frames():
    d_th = (Vector(KNEE) - Vector(HIP)).normalized()
    fn = Vector((0, d_th.z, -d_th.y)).normalized()
    fn = -fn if fn.y > 0 else fn
    d_sh = (Vector(HOCK) - Vector(KNEE)).normalized()
    ng = Vector((0, -d_sh.z, d_sh.y)).normalized()
    ng = -ng if ng.y > 0 else ng
    d_mt = (Vector(ANKLE) - Vector(HOCK)).normalized()
    n_mt = Vector((0, d_mt.z, -d_mt.y)).normalized()
    n_mt = -n_mt if n_mt.y > 0 else n_mt
    return d_th, fn, d_sh, ng, d_mt, n_mt


def _pod(s):
    p0, p1 = Vector((s * 0.82, 0.5, 7.9)), Vector((s * 0.92, 1.72, 6.42))
    d = (p1 - p0).normalized()
    nb = Vector((0, d.z, -d.y)).normalized()
    return p0, p1, d, (-nb if nb.y < 0 else nb)


def r4_card_specs():
    """r4 (critic r3 S: 7 decals vs the player's 48): the extra stencil / warning / serial / hazard cards,
    as (image_fn, loc, normal, up, width, parent, density, both_sides). Locations are L-side (+X) for
    the mirrored parts; both_sides mirrors them onto the R part."""
    BK, CR, Y = D.BLACK, (189, 179, 154), D.YELLOW
    d_th, fn, d_sh, ng, d_mt, n_mt = _leg_frames()
    K0, H0, A0, HP = Vector(KNEE), Vector(HOCK), Vector(ANKLE), Vector(HIP)
    sp = []
    # torso: LIFT arrows by the dome lifting eyes, NO STEP on the spine segment, serial plates on the flanks
    hwv, yfv, ybv, prv, cv = K.sec_interp(CHEST, 8.62)
    for s in (1, -1):
        sp.append((lambda s=s: D.arrow_decal(text='LIFT', seed=120 + s), (s * 0.4, ybv - 0.62, 8.805), (0, 0, 1),
                   (0, 1, 0), 0.26, 'torso', 460, False))
        hw_, yf_, yb_, pr_, c_ = K.sec_interp(CHEST, 7.27)
        sp.append((lambda s=s: D.serial_plate(('GC-X1  HULL ' + ('L' if s > 0 else 'R'), 'GRAUWERK PIER DIV.  42MPa'),
                                              w=640, seed=122 + s),
                   (s * (hw_ + 0.01), (yf_ + yb_) * 0.5 + 0.05, 7.27), (s, 0, 0), (0, 0, 1), 0.36, 'torso', 520,
                   False))
    sp.append((lambda: D.text_decal(['NO STEP', '踏むな'], px=160, color=BK, worn=0.3, seed=124), (0.0, 0.25, 8.805),
               (0, 0, 1), (0, -1, 0), 0.3, 'torso', 460, False))
    # pauldrons: Grauwerk emblem on the L slab (the R slab carries it already), hazard band along the lower
    # outer edge, a data plate on the front face
    sp.append((lambda: K.grauwerk_mark(512, seed=125), (2.64, 0.52, 8.22), (1, 0, 0), (0, 0, 1), 0.4, 'arm_L', 440,
               False))
    sp.append((lambda: D.hazard_decal(768, 110, seed=126), (2.62, 1.0 + DY, 7.99), (1, 0, 0), (0, 0, 1), 0.62, 'arm_',
               360, True))
    sp.append((lambda: D.serial_plate(('ARM  GC-X1', 'HYD 42MPa  LOT 12-C'), w=560, seed=127),
               (2.05, -1.12 + DY - 0.02, 8.44), (0, -1, 0), (0, 0, 1), 0.3, 'arm_', 520, True))
    # R forearm cream plate: load stencil; back pods: HOT plate near the nozzle end
    sp.append((lambda: D.text_decal(['MAX 18t', '荷重注意'], px=160, color=BK, worn=0.3, seed=128),
               fwd((-2.54, -0.9 + DY, 6.1)), (-1, 0, 0), (0, 0, 1), 0.3, 'forearm_R', 460, False))
    for s in (1, -1):
        p0, p1, dp, nb = _pod(s)
        sp.append((lambda s=s: D.warning_label('HOT', '高温注意', ('EXHAUST', '排気口 接近禁止'), w=640, seed=129 + s),
                   p0.lerp(p1, 0.76) + nb * 0.43, nb, -dp, 0.24, 'booster_back', 520, False))
    # legs: thigh front-pad load stencil, greave unit number + hazard band, shin serial plate,
    # metatarsus load stencil, knee-cap number
    sp.append((lambda: D.text_decal(['MAX 28t'], px=170, color=BK, worn=0.3, seed=131), HP.lerp(K0, 0.55) + fn * 0.6,
               fn, -d_th, 0.34, 'thigh_', 460, True))
    sp.append((lambda: D.text_decal('01', px=240, color=BK, worn=0.3, seed=132), K0 + d_sh * 0.62 + ng * 0.58, ng,
               -d_sh, 0.26, 'shin_', 460, True))
    sp.append((lambda: D.hazard_decal(768, 128, seed=133), K0 + d_sh * 1.3 + ng * 0.58, ng, -d_sh, 0.42, 'shin_',
               360, True))
    sp.append((lambda: D.serial_plate(('GC-X1 LEG', 'LOT 12-C  HYD 42MPa'), w=560, seed=134),
               K0.lerp(H0, 0.42) + Vector((0.39, -0.16, 0.0)), (1, 0, 0), (0, 0, 1), 0.36, 'shin_', 520, True))
    sp.append((lambda: D.text_decal(['MAX 34t', '荷重注意'], px=160, color=CR, worn=0.3, seed=135),
               H0.lerp(A0, 0.52) + Vector((0.27, -0.02, 0.0)), (1, 0, 0), -d_mt, 0.26, 'shin_', 460, True))
    sp.append((lambda: D.text_decal('X1', px=220, color=BK, worn=0.3, seed=136),
               Vector((KNEE[0], KNEE[1] - 0.6, KNEE[2] + 0.04)), (0, -0.92, 0.38), (0, 0.38, 0.92), 0.22, 'shin_', 460,
               True))
    return sp


def r4_keep():
    """Register the card points (existing + r4) so panelize leaves those faces flat."""
    CARD_KEEP.clear()
    keep((0.0, 1.36, 7.1), (0.0, 0.64, 6.62), (1.0, -1.02, 7.02), (2.665, -0.3, 8.2), (2.47, 0.55 + DY, 8.72))
    for (fn_, loc, n, up, w, parent, dens, both) in r4_card_specs():
        p = Vector(loc)
        keep(tuple(p))
        n = Vector(n).normalized()
        x = Vector(up).cross(n).normalized()
        for k in (-0.45, 0.45):
            keep(tuple(p + x * w * k))


def r4_decals(a):
    card = R.card
    for (fn_, loc, n, up, w, parent, dens, both) in r4_card_specs():
        img = fn_()
        if parent.endswith('_'):
            card(a, img, loc, n, up=up, size=(w, None), parent=parent + 'L', density=dens)
            if both:
                card(a, img.copy(), mx(loc), mx(n), up=mx(up), size=(w, None), parent=parent + 'R', density=dens)
        else:
            card(a, img, loc, n, up=up, size=(w, None), parent=parent, density=dens)
    # baked rust run-off below the bolt rows / plate edges (0.4-0.8 m) and soot at every vernier
    nrust = 0
    d_th, fn, d_sh, ng, d_mt, n_mt = _leg_frames()

    def drip(loc, normal, length):
        nonlocal nrust
        nrust += 1
        a.decal(rust_drip(300 + nrust), Vector(loc) + Vector((0, 0, -length * 0.45)), normal, up=(0, 0, 1),
                size=(length * 0.26, length), depth=0.12, opacity=0.9)
    for s in (1, -1):
        for t, ln in ((0.3, 0.5), (0.68, 0.42)):                      # under the keel plates
            p, n = K.prow_facet(CHEST, 7.16, t, s, lift=0.05)
            drip(p, n, ln)
        for y, ln in ((-0.45, 0.42), (0.05, 0.5)):                    # pauldron outer plate lower bolts
            drip((s * 2.67, y, 7.93), (s, 0, 0), ln)
        drip((s * 1.47, 0.32, 4.98), (s, 0, 0), 0.5)                  # thigh oxide pad -> cream pad
        drip((s * 1.47, -0.2, 4.1), (s, 0, 0), 0.4)
        q = Vector(KNEE) + d_sh * 1.45 + ng * 0.56                    # under the greave
        drip(mx(q) if s < 0 else q, mx(ng) if s < 0 else ng, 0.45)
        q = Vector(HOCK) + d_mt * 1.05 + n_mt * 0.3                   # under the metatarsus plate
        drip(mx(q) if s < 0 else q, mx(n_mt) if s < 0 else n_mt, 0.36)
        hw2, yf2, yb2, pr2, c2 = K.sec_interp(CHEST, 8.05)
        drip((s * (hw2 + 0.04), (yf2 + yb2) * 0.5, 7.86), (s, 0, 0), 0.4)   # flank armour -> vent
        p0, p1, dp, nb = _pod(s)
        drip(p0.lerp(p1, 0.82) + nb * 0.38, nb, 0.4)                  # below the pod back plate
        # r4b: more run-off under the pauldron front bolts, the hip fender and the shin greave bolts
        drip((s * 2.3, -1.12 + DY - 0.02, 8.2), (0, -1, 0), 0.5)
        drip((s * 1.52, 0.6, 5.35), (s, 0, 0), 0.38)
        q = Vector(KNEE) + d_sh * 0.7 + ng * 0.6
        drip(mx(q) if s < 0 else q, mx(ng) if s < 0 else ng, 0.32)
        # soot: chest verniers, pauldron verniers, pod louvres
        a.decal(K.soot(256, 140 + s), (s * 1.0, -1.08, 6.72), (0, -1, -0.3), size=(0.55, 0.55), depth=0.35,
                opacity=0.85)
        a.decal(K.soot(256, 142 + s), (s * 2.4, 1.32 + DY, 8.6), (0, 1, 0.2), size=(0.5, 0.5), depth=0.3, opacity=0.8)
        a.decal(K.soot(256, 144 + s, elong=1.4), p0.lerp(p1, 0.56) + nb * 0.42, nb, up=-dp, size=(0.4, 0.6),
                depth=0.25, opacity=0.7)
    iw.log(f'r4 decals: {len(r4_card_specs())} card specs, {nrust} rust drips')


def add_decals(a):
    """Soot is baked into the albedo; every stencil / mark / stripe is a decal card."""
    r4_decals(a)
    C, K_, Y = (189, 179, 154), D.BLACK, D.YELLOW
    for s_ in (1, -1):
        a.decal(K.soot(256, 60 + s_, elong=1.3), (s_ * 0.9, 1.7, 6.6), (0, 1, -0.6), size=(1.3, 1.3), depth=0.6,
                opacity=0.95)
        a.decal(K.soot(256, 62 + s_), (s_ * 1.5, 0.98, 6.9), (s_, 0, 0), size=(0.7, 0.7), depth=0.3, opacity=0.8)
        a.decal(K.soot(256, 64 + s_, elong=1.5), (s_ * 1.1, HOCK[1] + 0.2, HOCK[2] - 0.7), (0, 1, 0), size=(0.6, 0.9),
                depth=0.35, opacity=0.8)
    a.decal(K.soot(256, 66), fwd((2.12, -3.3 + DY, 6.1)), (0, 0, 1), up=(0, -1, 0), size=(0.7, 0.9), depth=0.4,
            opacity=0.8)
    card = R.card
    card(a, K.grauwerk_mark(640), (-2.665, -0.3, 8.2), (-1, 0, 0), size=(0.56, None), parent='arm_R', density=460)
    card(a, D.text_decal('X1', px=300, color=K_, worn=0.3, seed=71), (2.665, -0.3, 8.2), (1, 0, 0), size=(0.42, None),
         parent='arm_L')
    p, n = K.prow_facet(CHEST, 7.75, 0.45, 1, lift=0.09)
    card(a, D.text_decal('GC-X1', px=260, color=K_, worn=0.3, seed=72), tuple(p), tuple(n), size=(0.62, None),
         parent='torso')
    p2, n2 = K.prow_facet(CHEST, 7.75, 0.45, -1, lift=0.09)
    card(a, K.id_bars(512, 96, seed=5), tuple(p2), tuple(n2), size=(0.56, None), parent='torso', density=380)
    card(a, D.text_decal('CINDERHOUND', px=200, color=C, worn=0.3, seed=73), (0.0, 1.36, 7.1), (0, 1, 0.35),
         size=(0.9, None), parent='booster_back')
    card(a, D.warning_label('DANGER', '高圧注意', ('HIGH VOLTAGE', '高電圧 接触厳禁'), w=900, colors=(Y, K_), seed=74),
         (0.0, 0.64, 6.62), (0, 1, 0.3), size=(0.56, None), parent='booster_back')
    card(a, D.text_decal(['GRAUWERK', 'CONSOLIDATED SECURITY'], px=150, color=K_, worn=0.25, seed=75),
         fwd((2.705, -1.2 + DY, 6.1)), (1, 0, 0), size=(0.8, None), parent='weapon_L')
    card(a, D.text_decal(['GLR-3', 'LASER'], px=170, color=C, worn=0.3, seed=76), fwd((-2.265, -2.9 + DY, 6.3)),
         (-1, 0, 0), size=(0.34, None), parent='weapon_R')
    # r3: load-rating stencils on the slabs, the unit number on the head flank, gun soot sources
    nt = Vector((0.33, 0, 0.38)).normalized()
    for s_, S in ((1, 'L'), (-1, 'R')):
        card(a, D.text_decal(['MAX 32t', '荷重注意'], px=170, color=K_, worn=0.25, seed=81 + s_),
             (s_ * 2.47, 0.55 + DY, 8.72), (s_ * nt.x, 0, nt.z), up=(0, -1, 0), size=(0.36, None), parent='arm_' + S)
    hp = Matrix.Translation(HEAD) @ Matrix.Scale(HEAD_S, 4) @ Matrix.Translation(-Vector(OLD_HEAD))
    card(a, D.text_decal('GC-X1', px=200, color=C, worn=0.3, seed=83), tuple(hp @ Vector((0.49, -1.2, 8.6))), (1, 0, 0),
         size=(0.36, None), parent='head')
    a.soot_points = [(fwd(MUZ_R), 0.12), (fwd(MUZ_L), 0.15)]
    a.post = dict(chip_grow=1.0, chip_lo=0.35, chip_hi=0.62)   # lighter chip growth (cream pads read blotchy)
    # r4 (critic r3: 'near-white bone shin cards'): dirtier cream - mottled grime + cavity dirt, a taller yard-dirt
    # gradient up the legs, and a linear albedo pull on the cream (#BDB39A authored reads near-white in the sun)
    a.post.update(bone_grime=0.26, bone_cav=0.42, low_z=3.4, low_mul=0.58)
    a.post_tint = {'paint_secondary': (0.78, 0.77, 0.74)}
    # r4b (critic r3 S: 'large flat oxide planes', 'near-white bone shin cards'): stronger 0.3-1 m dirty /
    # sun-faded mottling, darker crevice + cavity grime, a taller yard-dirt gradient, and the cream pulled to
    # a dirty #BDB39A in-engine (x0.66 linear) instead of a sun-blown card; oxide slightly darker / less pink
    a.post.update(mottle_lo=0.66, ao_grime=1.0, cav_grime=0.5, bone_grime=0.38, bone_cav=0.6, low_z=4.2,
                  low_mul=0.5)
    a.post_tint = {'paint_secondary': (0.66, 0.65, 0.62), 'paint_primary': (0.88, 0.85, 0.85)}
    for s_, S in ((1, 'L'), (-1, 'R')):
        card(a, D.serial_plate(('GC-X1 CINDERHOUND', 'GRAUWERK PIER DIV.  LOT 12'), w=720, seed=77 + s_),
             (s_ * 1.51, -0.3, 4.62), (s_, 0, 0), size=(0.4, None), parent='thigh_' + S)
        card(a, K.id_bars(256, 64, seed=7 + s_), (s_ * 1.51, 0.2, 5.1), (s_, 0, 0), size=(0.4, None),
             parent='thigh_' + S, density=380)
        card(a, D.text_decal(['DANGER', '危険'], px=180, color=Y, worn=0.3, seed=79 + s_), (s_ * 1.0, -1.02, 7.02),
             (0, -1, 0.3), size=(0.28, None), parent='torso')


VIEWS = {
    'hero': dict(azimuth=-40, elevation=8, lens=45, distance=26, target=(0, -0.6, 4.9)),
    'front': dict(azimuth=0, elevation=6, lens=50, distance=25, target=(0, -0.5, 4.9)),
    'back': dict(azimuth=160, elevation=16, lens=50, distance=25, target=(0, 0.5, 5.1)),
    'close': dict(azimuth=-30, elevation=10, lens=70, distance=12, target=(0, -1.3, 8.1)),
}
CLAY = dict(VIEWS, side=dict(azimuth=-90, elevation=4, lens=50, distance=26, target=(0, -0.8, 4.9)))
# Grauwerk scheme (benchmark s5), oxide desaturated ~30% (it read as a red toy under the warm grade)
COLORS = {'paint_primary': {'color': '#5A3B33', 'rough': 0.54, 'metal': 0.25},
          'paint_secondary': {'color': '#BDB39A', 'rough': 0.58, 'metal': 0.08, 'grime': 1.2, 'wear': 0.35},
          'paint_accent': {'color': '#D8A31A'}, 'paint_dark': {'color': '#33302E', 'rough': 0.52, 'metal': 0.3},
          'steel_dark': {'color': '#45423F'}, 'chrome': {'color': '#D9DBDD', 'rough': 0.25},
          'marker_red': dict(color='#180806', metal=0.0, rough=0.25, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                             emit='#FF3B2F', emit_strength=3.5, decals=False),
          'marker_amber': dict(color='#1A1208', metal=0.0, rough=0.25, wear=0.0, grime=0.0, rust=0.0, dust=0.0,
                               var=0.0, emit='#FFB347', emit_strength=3.0, decals=False),
          'bell_heat': dict(color='#3A302A', metal=0.85, rough=0.38, wear=0.0, grime=0.5, rust=0.0, dust=0.0, var=0.06,
                            pattern='heat', decals=False),
          'glow_rim': dict(color='#1A1410', metal=0.0, rough=0.4, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                           emit='#7A2A10', emit_strength=6.0, decals=False)}
OBJ_WEIGHT = {'head_geo': 1.8, 'torso_geo': 1.45, 'weapon_R_geo': 1.1, 'booster_back_geo': 1.1, 'foot_L_geo': 0.8,
              'foot_R_geo': 0.8, 'pelvis_geo': 0.8, 'hand_R_geo': 0.85, 'arm_L_geo': 1.3, 'arm_R_geo': 1.3,
              'weapon_L_geo': 1.15, 'shin_L_geo': 1.1, 'shin_R_geo': 1.1}
# r2: wear = crisp bare-steel chips on the EDGES (no white flat-panel dabs or pale ash smudges on the
# oxide tops), more roughness break-up
# r3: the player's wear recipe (wider chips to bare steel, plates not suppressed as 'thin'); the rig
# texture post-pass (rigpipe.post_weather) adds the per-part grime gradient, soot and throat ramps
# ground_dirt=0: iwkit's ground-dirt gradient inverts (see build_player.py); rigpipe does it per part
WEATHER = iw.Weathering(edge_wear=1.4, grime=1.35, streaks=1.6, rust=0.8, dust=0.15, chip_threshold=0.62,
                        flat_chips=0.08, macro=0.12, ground_dirt=0.0, ao_in_albedo=0.0, rough_breakup=0.32,
                        edge_lo=0.1, edge_hi=0.4, edge_polish=0.05, thin_suppress=0.5,
                        bare_dark=(0.22, 0.23, 0.24), bare_light=(0.31, 0.32, 0.33))
SET_B = ('pelvis', 'thigh', 'shin', 'foot', 'booster', 'nozzle')
BAKE_KW = {'edge': 0.035}
# r3: ORM A 1536 (r2: 1024), basecolor B 1536 (r2: 2048); WebP qualities keep the GLB at r2's ~2.07 MB
# r4 (enemy modeler): ORM A 1024 / B 768 pays for the +20k tris of panel detail (GLB must not grow)
TEX_SIZES = {'A': {'basecolor': 2048, 'orm': 1024, 'normal': 2048, 'emissive': 1024},
             'B': {'basecolor': 1536, 'orm': 768, 'normal': 1024, 'emissive': 1024}}


def set_of(name):
    return 'B' if name.split('_')[0] in SET_B else 'A'


def _vnoise(p, seed=0):
    """3D value noise (smooth trilinear over hashed lattice values in 0..1) for N x 3 float32 points."""
    import numpy as np
    i0 = np.floor(p).astype(np.int64)
    f = (p - i0).astype(np.float32)
    f = f * f * (3.0 - 2.0 * f)

    def h(ix, iy, iz):
        x = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        x = (x ^ (x >> 13)) * 1274126177
        return ((x ^ (x >> 16)) & 0xFFFF).astype(np.float32) / 65535.0
    x0, y0, z0 = i0[:, 0], i0[:, 1], i0[:, 2]
    out = np.zeros(len(p), np.float32)
    for dx in (0, 1):
        wx = f[:, 0] if dx else 1.0 - f[:, 0]
        for dy in (0, 1):
            wy = f[:, 1] if dy else 1.0 - f[:, 1]
            for dz in (0, 1):
                wz = f[:, 2] if dz else 1.0 - f[:, 2]
                out += wx * wy * wz * h(x0 + dx, y0 + dy, z0 + dz)
    return out


def post_paint_breakup(a, tag, objs, lo, hi):
    """r4b (critic r3 S: 'large flat oxide planes'; in-engine the r4 oxide still read as a uniform terracotta
    sheet): world-space paint break-up on top of rigpipe.post_weather - vertical grime / rain streaks
    (~7 cm wide, ~0.8 m long), faded-paint patches (~0.6 m) and a fine 12 cm mottle, on every painted
    texel that is not a bare-steel chip; the streaks also roughen the paint (matte grime) so the sun sheet
    on the big pauldron / chest planes breaks up."""
    import numpy as np
    from iwkit import texcomp as TC
    raw, maps = a.raw, a.maps
    flip = (lambda x: x[::-1])
    pal = {m.name: i for i, m in enumerate(a.palette)}
    mid = np.rint(flip(raw['matid'])[..., 0] * 255.0).astype(np.int32)
    valid = flip(raw['albedo'])[..., 3] > 0.5
    ids = [pal[n] for n in ('paint_primary', 'paint_secondary', 'paint_dark') if n in pal]
    paint = np.isin(mid, ids) & valid
    orm = maps['orm'].astype(np.float32) / 255.0
    paint &= orm[..., 2] < 0.6                      # not the bare-steel chips
    if not paint.any():
        return
    lo_, hi_ = np.array(lo, np.float32), np.array(hi, np.float32)
    wp = (lo_ + flip(raw['wpos'])[..., :3].astype(np.float32) * (hi_ - lo_))[paint]
    streak = _vnoise(wp * np.array([14.0, 14.0, 1.25], np.float32), 3)
    streak = TC.smoothstep(0.42, 0.72, streak) * (0.35 + 0.65 * TC.smoothstep(0.3, 0.65, _vnoise(wp * 2.2, 5)))
    patch = TC.smoothstep(0.2, 0.8, _vnoise(wp * 1.7, 7))
    fine = _vnoise(wp * 8.0, 11)
    mult = (1.0 - 0.42 * streak) * (0.7 + 0.42 * patch) * (0.86 + 0.2 * fine)
    base = R._s2l(maps['basecolor'].astype(np.float32) / 255.0)
    bp = base[paint] * mult[:, None]
    # faded patches drift the oxide slightly toward a dusty grey-brown (sun-bleached paint)
    fade = TC.smoothstep(0.62, 0.95, patch)[:, None] * 0.22
    bp = bp * (1.0 - fade) + np.array([0.11, 0.085, 0.07], np.float32) * fade
    base[paint] = bp
    rgh = orm[..., 1]
    rgh[paint] = np.clip(rgh[paint] + 0.14 * streak - 0.05 * TC.smoothstep(0.6, 0.9, patch), 0, 1)
    orm[..., 1] = rgh
    maps['basecolor'] = (np.clip(TC.lin_to_srgb(base), 0, 1) * 255 + 0.5).astype(np.uint8)
    maps['orm'] = (np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8)
    iw.log(f'r4b paint break-up {tag}: {int(paint.sum())} texels, streak mean {float(streak.mean()):.3f}')


def main():
    _pw = R.post_weather

    def post_weather(a, tag, objs, lo, hi, P=None):
        _pw(a, tag, objs, lo, hi, P)
        post_paint_breakup(a, tag, objs, lo, hi)
    R.post_weather = post_weather
    # r4b: 12-bit positions / UVs (2.4 mm on a 10 m rig, half a texel at 2048) pay for the panel detail;
    # GLB must not grow past r3's 1.86 MB
    R.GLTFPACK_EXTRA = ['-vp', '12', '-vt', '12']
    R.run(NAME, build, add_decals, set_of, scheme='grauwerk', colors=COLORS, seed=13, obj_weight=OBJ_WEIGHT,
          weathering=WEATHER, views=VIEWS, clay=CLAY, tex_sizes=TEX_SIZES, bake_kw=BAKE_KW,
          tex_quality={'basecolor': 71, 'orm': 64, 'normal': 66, 'decals': 70})


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
