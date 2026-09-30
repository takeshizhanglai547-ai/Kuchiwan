"""RIG-07 "IRONWAKE" - the player's mid-weight assault rig (owner: mech modeler).

Foundry machinery turned to war. v2 layout (fix round 1):
  * weighted, bent-knee rest stance built into the joint placement (thighs pitched
    forward, shins back, feet flat; the leg IK in rigmotion.js reproduces it exactly),
    heavy arms hanging forward with the rifle at a low ready;
  * a dominant, faceted chest core (flat 45-degree chamfers, sharp creases, layered
    bolted plates, cockpit hatch with hinge barrels and handholds, rivet rows, seams),
    a small crane-cab head sunk into a raised collar under a brow overhang with an
    ASYMMETRIC sensor face (4 cm slit, one 18 cm main lens, a vertical 3-lens cluster);
  * exposed inner frame at every joint: waist actuator ring with 4 cable bundles, two
    rams per hip, upper arms as open frames (actuator disc + 2 rams) under the
    pauldrons, forearm housings bigger than the upper arms, knee and ankle rams;
  * reverse-angle knee plates, shins tapering 1.1 m -> 0.7 m, 2 m feet with toe caps;
  * a booster pack with heat-shield louvres between the bells and rectangular louvred
    flank intakes; marker lights (amber / cyan) that lift the backlit silhouette;
  * every stencil / label / number / emblem / hazard band is a crisp decal card.
Fixed loadout: RF-24 rifle (R hand, low ready), PB-7 pulse-blade emitter (L forearm),
ML-6 box launcher (L shoulder), HC-90 heavy cannon over the R shoulder.

    python3 blender/mech/build_player.py --blockout [--poses]   # geometry + clay renders only
    python3 blender/mech/build_player.py --quick                 # 1024 bakes, GLB, 2 previews
    python3 blender/mech/build_player.py                         # final: 2048 sets, GLB+FBX, 4 previews

Blender coords: +Z up, faces -Y, the rig's RIGHT is -X (node contract: src/mech/rig.js).
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

NAME = 'mech_player'
V = Vector

# ============================================================================ skeleton (L side = +X)
PELVIS = V((0.0, 0.05, 5.30))
TORSO = V((0.0, 0.20, 6.18))
HIP = V((1.10, 0.05, 5.05))
KNEE = V((1.15, -0.62, 3.36))
ANKLE = V((1.21, 0.10, 0.95))
SHOULDER = V((2.42, 0.15, 8.12))
ELBOW = V((2.60, -0.30, 6.55))
WRIST = V((2.60, -2.14, 6.02))
HEAD = V((0.0, -0.66, 9.10))
EYE = V((0.0, -1.22, 9.40))
MISSILE_MOUNT = V((1.40, 1.22, 9.02))
CANNON_MOUNT = V((-1.90, 1.25, 9.40))
BOOSTER = V((0.0, 1.60, 7.55))
SIDEBOOST = V((1.62, 1.75, 7.05))
FA_PITCH = math.degrees(math.atan2(ELBOW.z - WRIST.z, ELBOW.y - WRIST.y))   # forearm droop (deg)
L_THIGH = (KNEE - HIP).length
L_SHIN = (ANKLE - KNEE).length
L_UARM = (ELBOW - SHOULDER).length
L_FARM = (WRIST - ELBOW).length


def mx(p):
    return V((-p[0], p[1], p[2]))


def seg_frame(U, L):
    """Frame at joint U whose local -Z runs down the limb to L, local X ~ world X,
    local -Y = the limb's front. Author limbs vertical at the origin, then transform."""
    U, L = V(U), V(L)
    z = (U - L).normalized()
    x = V((1, 0, 0))
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x, U.x), (x.y, y.y, z.y, U.y), (x.z, y.z, z.z, U.z), (0, 0, 0, 1)))


def forearm_frame():
    """Forearm frame at the elbow: local -Y runs along the forearm to the wrist."""
    return Matrix.Translation(ELBOW) @ Matrix.Rotation(math.radians(FA_PITCH), 4, 'X')


def rivets(p0, p1, pitch, normal, r=0.016, mat='steel'):
    """Cheap rivet row (6-sided low caps, ~12 tris each after culling) at `pitch` spacing."""
    p0, p1 = V(p0), V(p1)
    n = max(2, int(round((p1 - p0).length / pitch)) + 1)
    proto = P.cylinder(r, r * 0.45, 6, bevel=0.0, bsegs=1, mat=mat, z0=0.0)
    K.mark_hidden(proto, (0, 0, -1))
    Rm = P._frame(normal)
    g = Geo()
    for i in range(n):
        g.merge(proto, M=Matrix.Translation(p0.lerp(p1, i / (n - 1))) @ Rm)
    proto.free()
    return g


def marker(loc, normal, color='amber', r=0.055):
    """Marker light: an emissive lens in a steel bezel with a small hood."""
    g = Geo()
    g.merge(P.cylinder(r * 1.5, 0.05, 16, bevel=0.008, bsegs=1, mat='steel_dark', z0=-0.02))
    g.merge(P.dome(r, r * 0.55, 16, 2, mat='marker_' + color).move(0, 0, 0.03))
    g.merge(P.box((r * 3.2, r * 1.4, 0.014), bevel=0.003, segs=1, mat='steel_dark').rotate((-30, 0, 0))
            .move(0, r * 1.25, 0.06))
    n = V(normal).normalized()
    g.align(n, up=(0, 0, 1) if abs(n.z) < 0.9 else (0, 1, 0), loc=loc)
    return g


def pipe(points, r=0.045, segs=16, mat='steel'):
    return P.pipe_run(points, r, bend=0.12, segs=segs, mat=mat, flanges=False)


# ============================================================================ chest geometry
# (z, half width, front y, back y, prow depth, chamfer); the front has a 0.72 m flat centre strip
UPPER = [(7.56, 1.40, -0.94, 0.92, 0.16, 0.18),
         (7.84, 1.92, -1.14, 1.00, 0.30, 0.20),
         (8.62, 2.02, -1.10, 1.04, 0.36, 0.22),
         (9.02, 1.64, -0.64, 0.96, 0.10, 0.18)]
ABDO = [(6.42, 0.96, -0.72, 0.74, 0.08, 0.16),
        (6.94, 1.22, -0.86, 0.84, 0.12, 0.18),
        (7.66, 1.46, -0.94, 0.90, 0.14, 0.20)]
FLAT = 0.36


def chest_ol(hw, yf, yb, pr, c, fw=FLAT):
    return [(fw, yf - pr), (hw - c, yf), (hw, yf + c), (hw, yb - c), (hw - c, yb), (-hw + c, yb), (-hw, yb - c),
            (-hw, yf + c), (-hw + c, yf), (-fw, yf - pr)]


def sec_at(secs, z):
    if z <= secs[0][0]:
        return secs[0][1:]
    for i in range(len(secs) - 1):
        a, b = secs[i], secs[i + 1]
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, 6))
    return secs[-1][1:]


def facet(secs, z, t, s=1, lift=0.012):
    """Point + outward normal on the angled front facet (side s) at height z;
    t = 0 at the centre strip edge .. 1 at the corner."""
    hw, yf, yb, pr, c = sec_at(secs, z)
    p0 = V((s * FLAT, yf - pr, z))
    p1 = V((s * (hw - c), yf, z))
    d = p1 - p0
    n = V((-d.y, d.x, 0.0)).normalized() * s
    if n.y > 0:
        n = -n
    return p0 + d * t + n * lift, n


def facet_plate(secs, z0, z1, t0, t1, s, thick, mat, **kw):
    a, n = facet(secs, z0, t0, s)
    b, _ = facet(secs, z0, t1, s)
    c, _ = facet(secs, z1, t1, s)
    d, _ = facet(secs, z1, t0, s)
    nz = (c - b).cross(a - b).normalized()
    if nz.dot(n) < 0:
        nz = -nz
    return K.plate_world([a, b, c, d], thick, mat=mat, normal_hint=nz, **kw)


def front_y(secs, z):
    hw, yf, yb, pr, c = sec_at(secs, z)
    return yf - pr


# ============================================================================ pelvis + waist
def build_pelvis():
    g = Geo()
    core = K.shell([(4.70, -0.52, 0.52, -0.50, 0.46, 0.14),
                    (5.12, -0.74, 0.74, -0.68, 0.62, 0.20),
                    (5.62, -0.80, 0.80, -0.72, 0.68, 0.22),
                    (5.96, -0.66, 0.66, -0.58, 0.58, 0.18)], 'Z', bevel=0.016, mat='paint_dark')
    K.grooves(core, [(0, -1, 0), (0, 1, 0), (1, 0, 0), (-1, 0, 0), (1, -1, 0), (-1, -1, 0)], (0, 0, 5.4), (0, 0, 1))
    g.merge(core)
    # waist actuator ring (the torso twists on it): stacked bands, bolt circle, 4 cable bundles
    tx, ty = TORSO.x, TORSO.y
    ring = P.banded_cylinder([(0.06, 0.60, 'steel_dark'), (0.16, 0.70, 'paint_dark'), (0.04, 0.66, 'steel'),
                              (0.12, 0.72, 'paint_dark'), (0.05, 0.64, 'steel_dark')], segs=48, step=0.0,
                             mat='paint_dark')
    g.merge(ring.move(tx, ty, 5.93))
    g.merge(P.bolt_circle((tx, ty, 6.29), (0, 0, 1), 0.68, 16, r=0.02))
    for sx, sy in ((1, -1), (-1, -1), (1, 1), (-1, 1)):
        base = V((sx * 0.56, ty + sy * 0.46, 5.94))
        top = V((sx * 0.5, ty + sy * 0.5, 6.26))
        mid = (base + top) * 0.5 + V((sx * 0.22, sy * 0.16, -0.02))
        for k in (-0.5, 0.5):
            o = V((k * 0.09 * sy, k * 0.09 * sx, 0.0))
            g.merge(P.sweep([base + o, mid + o * 1.4 + V((0, 0, -0.04 * k)), top + o], 0.04, 16, mat='rubber',
                            rib_amp=0.0, subdiv=2))
        g.merge(P.box((0.3, 0.3, 0.08), bevel=0.01, segs=1, mat='steel_dark').move(base.x, base.y, 5.93))
        g.merge(P.box((0.26, 0.2, 0.06), bevel=0.008, segs=1, mat='steel').move(top.x, top.y, 6.27))
    # hip sockets + upper hip plates (skirt) + tassets
    for s in (1, -1):
        g.merge(K.drum((s * 0.66, HIP.y, HIP.z), (1, 0, 0), 0.36, 0.22, profile='ring', hub=False))
        g.merge(K.plate_world([(s * 0.72, -0.62, 5.72), (s * 1.66, -0.52, 5.58), (s * 1.66, 0.48, 5.58),
                               (s * 0.72, 0.56, 5.72)], 0.08, mat='paint_primary', normal_hint=(0, 0, 1),
                              chamfer=0.1, bolts=1, bolt_r=0.018, bolt_spacing=0.3))
        g.merge(P.box((0.12, 0.74, 0.24), bevel=0.012, segs=1, mat='steel_dark').move(s * 0.78, 0.0, 5.6))
        g.merge(K.strip((s * 1.62, -0.5, 5.66), (s * 1.62, 0.46, 5.66), 0.06, 0.02, (s, 0, 0.4), mat='paint_accent'))
        g.merge(marker((s * 1.3, -0.62, 5.6), (0, -1, -0.3), 'amber', 0.045))
    # crotch armour (angled, bolted, hazard strip) + rear plate
    g.merge(K.plate_world([(-0.48, -0.82, 5.74), (0.48, -0.82, 5.74), (0.36, -1.02, 4.78), (-0.36, -1.02, 4.78)], 0.09,
                          mat='paint_primary', normal_hint=(0, -1, 0), ridge=0.035, ridge_axis='Y', chamfer=0.08,
                          bolts=1, bolt_r=0.018, bolt_spacing=0.3))
    g.merge(P.cylinder(0.075, 0.9, 24, bevel=0.01, mat='steel_dark').rotate((0, 90, 0)).move(0, -0.82, 5.76))
    g.merge(K.plate_world([(-0.46, 0.72, 5.68), (0.46, 0.72, 5.68), (0.36, 0.88, 4.86), (-0.36, 0.88, 4.86)], 0.07,
                          mat='paint_primary', normal_hint=(0, 1, 0), chamfer=0.08))
    return g


# ============================================================================ torso
def build_torso():
    g = Geo()
    up = K.loft_pts([(chest_ol(hw, yf, yb, pr, c), z) for (z, hw, yf, yb, pr, c) in UPPER], axis='Z', bevel=0.02,
                    mat='paint_primary')
    for zz in (8.22,):
        K.grooves(up, [(1, 0, 0), (-1, 0, 0), (0, 1, 0)], (0, 0, zz), (0, 0, 1), gap=0.02, depth=0.018)
    K.grooves(up, [(0, 0, 1), (1, 0, 0.35), (-1, 0, 0.35), (0, 1, 0.3)], (0, 0.32, 0), (0, 1, 0), gap=0.02, depth=0.018)
    for sx in (1.0, -1.0):
        K.grooves(up, [(0, 1, 0), (0, 0, 1), (0, 1, 0.3)], (sx * 0.95, 0, 0), (1, 0, 0), gap=0.02, depth=0.018)
    ab = K.loft_pts([(chest_ol(hw, yf, yb, pr, c, 0.3), z) for (z, hw, yf, yb, pr, c) in ABDO], axis='Z', bevel=0.018,
                    mat='paint_dark')
    K.grooves(ab, [(1, 0, 0), (-1, 0, 0), (0, 1, 0)], (0, 0, 7.1), (0, 0, 1), gap=0.02, depth=0.016)
    armour = []
    for s in (1, -1):
        # layered plates on the upper chest facets (ridged, bolted): the L one bone, the R one slate
        # with a smaller bone insert lower down (asymmetric: no pair of pale 'eyes' from afar)
        if s > 0:
            armour.append(facet_plate(UPPER, 7.92, 8.56, 0.06, 0.94, s, 0.09, 'paint_secondary', chamfer=0.12,
                                      bolts=1, bolt_r=0.02, bolt_spacing=0.34))
        else:
            armour.append(facet_plate(UPPER, 8.2, 8.56, 0.06, 0.94, s, 0.09, 'paint_primary', chamfer=0.1,
                                      bolts=1, bolt_r=0.02, bolt_spacing=0.34))
            armour.append(facet_plate(UPPER, 7.92, 8.14, 0.3, 0.94, s, 0.08, 'paint_secondary', chamfer=0.07,
                                      bolts=1, bolt_r=0.018, bolt_spacing=0.3))
            armour.append(facet_plate(UPPER, 7.92, 8.14, 0.06, 0.26, s, 0.08, 'paint_dark', chamfer=0.05))
        n = facet(UPPER, 7.86, 0.5, s)[1]
        armour.append(K.strip(facet(UPPER, 7.86, 0.08, s)[0], facet(UPPER, 7.86, 0.92, s)[0], 0.07, 0.03, n))
        armour.append(facet_plate(UPPER, 8.66, 8.96, 0.1, 0.86, s, 0.06, 'paint_primary', chamfer=0.07, bolts=1,
                                  bolt_r=0.018, bolt_spacing=0.3))
        # abdomen: stacked counterweight bands (ladle-housing banding)
        for (z0, z1) in ((6.56, 6.9), (6.98, 7.3), (7.36, 7.58)):
            armour.append(facet_plate(ABDO, z0, z1, 0.0, 0.94, s, 0.07, 'paint_primary', chamfer=0.05, bolts=1,
                                      bolt_r=0.017, bolt_spacing=0.36))
        # side intake vents on the abdomen flanks + upper chest flank grille
        v = P.vent(0.5, 0.42, depth=0.08, slats=6, frame=0.04, mat='paint_dark')
        hw, yf, yb, pr, c = sec_at(ABDO, 7.12)
        v.align((s, 0, 0), up=(0, 0, 1), loc=(s * (hw + 0.04), 0.0, 7.12))
        armour.append(v)
        gr = P.grille(0.62, 0.34, bars=6, bar_r=0.014, frame=0.035, depth=0.05, mat='paint_primary', horizontal=True)
        gr.align((s, 0, 0), up=(0, 0, 1), loc=(s * 2.005, 0.46, 8.44))
        armour.append(gr)
        # rivet rows along the upper chest plate edges (12 cm pitch)
        a0, nn = facet(UPPER, 8.62, 0.08, s, lift=0.004)
        a1, _ = facet(UPPER, 8.62, 0.94, s, lift=0.004)
        armour.append(rivets(a0, a1, 0.12, nn))
        a0, nn = facet(UPPER, 7.84, 0.1, s, lift=0.004)
        # flank rivets on the side wall
        armour.append(rivets((s * 2.003, -0.8, 8.62), (s * 2.003, 0.9, 8.62), 0.2, (s, 0, 0)))
        armour.append(rivets((s * 1.943, -0.8, 7.84), (s * 1.943, 0.9, 7.84), 0.2, (s, 0, 0)))
        # coolant pipe run down the flank into the abdomen
        armour.append(pipe([(s * 1.52, -0.3, 7.62), (s * 1.44, 0.2, 7.3), (s * 1.28, 0.5, 6.92)], 0.04))
        for t in (0.3, 0.75):
            q = V((s * 1.52, -0.3, 7.62)).lerp(V((s * 1.28, 0.5, 6.92)), t)
            armour.append(P.box((0.12, 0.08, 0.08), bevel=0.008, segs=1, mat='steel_dark').move(q))
        # underside of the overhanging shelf: grille + amber marker + brake nozzle block
        gr2 = P.grille(0.5, 0.2, bars=5, bar_r=0.012, frame=0.03, depth=0.04, mat='paint_dark')
        gr2.align((0, -0.3, -1), up=(0, -1, 0), loc=(s * 0.8, -1.02, 7.63))
        armour.append(gr2)
        armour.append(marker((s * 1.62, -1.02, 7.66), (0, -0.4, -1), 'amber', 0.05))
        hb = P.box((0.42, 0.42, 0.28), bevel=0.016, segs=1, chamfer=0.05, chamfer_axes='Y', mat='paint_dark')
        armour.append(hb.move(s * 1.26, -0.96, 7.5))
    # centre strip: cockpit hatch with hinge barrels + two handholds; spine plate on the abdomen
    zf = front_y(UPPER, 8.2)
    K.hatch_at(up, (0, zf, 8.22), (0, -1, 0), (0.62, 0.58), u_axis=(1, 0, 0), raised=0.035, mat='paint_primary',
               gap=0.02, angle=12)
    for x in (-0.2, 0.2):
        armour.append(P.cylinder(0.035, 0.16, 16, bevel=0.006, bsegs=1, mat='steel').rotate((0, 90, 0))
                      .move(x, zf - 0.07, 8.53))
    for x in (-0.22, 0.22):
        armour.append(P.pipe_run([(x, zf - 0.02, 8.02), (x, zf - 0.11, 8.04), (x, zf - 0.11, 8.16), (x, zf - 0.02, 8.18)],
                                 0.016, bend=0.03, segs=12, mat='steel', flanges=False))
    armour.append(rivets((-0.3, zf - 0.005, 8.62), (0.3, zf - 0.005, 8.62), 0.12, (0, -1, 0)))
    armour.append(rivets((-0.3, zf - 0.005, 7.84), (0.3, zf - 0.005, 7.84), 0.12, (0, -1, 0)))
    zfa = front_y(ABDO, 7.1)
    K.hatch_at(ab, (0, zfa, 7.1), (0, -1, 0), (0.4, 0.62), u_axis=(1, 0, 0), recess=0.05, mat='steel_dark', angle=15)
    g.merge(up, ab, *armour)
    # collar: raised armour around the sunk head (open to the front), lifting eyes
    for s in (1, -1):
        cw = P.prism([(-0.96, 8.76), (0.46, 8.96), (0.46, 9.40), (0.02, 9.44), (-0.7, 9.2), (-0.96, 8.98)], 0.26,
                     bevel=0.018, segs=1, mat='paint_primary', axis='X')
        g.merge(cw.move(s * 0.70, 0, 0))
        g.merge(K.plate_world([(s * 0.835, -0.86, 8.94), (s * 0.835, 0.38, 9.06), (s * 0.835, 0.38, 9.34),
                               (s * 0.835, 0.0, 9.38), (s * 0.835, -0.66, 9.16)], 0.04, mat='paint_secondary',
                              normal_hint=(s, 0, 0), chamfer=0.04))
        g.merge(K.shackle(0.09, bar=0.022).move(s * 1.12, 0.3, 9.02))
        g.merge(K.strip((s * 0.58, -0.92, 8.98), (s * 0.58, -0.62, 9.18), 0.05, 0.012, (s * 0.3, -0.3, 1),
                        mat='paint_accent'))
    cb = P.box((1.14, 0.42, 0.44), bevel=0.018, segs=1, chamfer=0.1, chamfer_axes='X', mat='paint_primary')
    g.merge(cb.move(0, 0.36, 9.18))
    g.merge(P.ring(0.52, 0.34, 0.1, 40, bevel=0.01, mat='steel_dark', z0=8.97).move(0, HEAD.y + 0.04, 0))
    # shoulder sockets
    for s in (1, -1):
        g.merge(P.ring(0.58, 0.36, 0.1, 48, bevel=0.01, mat='steel_dark', z0=0.0)
                .align((s, 0, 0), loc=(s * 1.96, SHOULDER.y, SHOULDER.z)))
        g.merge(P.bolt_circle((s * 2.06, SHOULDER.y, SHOULDER.z), (s, 0, 0), 0.47, 10, r=0.02))
    # back-weapon pylons: missile (L) cheeks, cannon (R) pylon block with a support ram
    bx, by, bz = MISSILE_MOUNT
    for cx, sg in ((bx - 0.32, -1), (bx + 0.32, 1)):
        g.merge(K.cheek((cx, by, bz), sg, 0.26, 0.09, strap_to=(0.95, 8.7), strap_w=0.36, bolts=4))
    mxp, myp, mzp = CANNON_MOUNT
    py = K.shell([(8.5, mxp - 0.28, mxp + 0.28, 0.62, 1.66, 0.1), (9.0, mxp - 0.26, mxp + 0.26, 0.78, 1.6, 0.1),
                  (9.3, mxp - 0.22, mxp + 0.22, 1.0, 1.5, 0.08)], 'Z', bevel=0.016, mat='paint_dark')
    K.hatch_at(py, (mxp, 1.66, 8.9), (0, 1, 0.1), (0.3, 0.44), u_axis=(1, 0, 0), recess=0.04, mat='steel_dark')
    g.merge(py)
    g.merge(K.ram((mxp, 0.72, 8.62), (mxp, 1.1, 9.34), r=0.07, frac=0.55, segs=24, up=(1, 0, 0)))
    for cx, sg in ((mxp - 0.28, -1), (mxp + 0.28, 1)):
        g.merge(K.cheek((cx, myp, mzp), sg, 0.25, 0.09, strap_to=(myp, 9.2), strap_w=0.36, bolts=4))
    # back mounting frame for the booster pack
    for z in (6.95, 8.3):
        g.merge(P.box((2.1, 0.14, 0.18), bevel=0.012, segs=1, mat='steel_dark').move(0, 1.0, z))
    return g


# ============================================================================ head (crane cab)
# side profile (y, z) of the cab, lofted along X; brow overhang in front of the recessed face
HEAD_PROF = [(-1.12, 8.98), (-1.18, 9.06), (-1.18, 9.52), (-1.40, 9.66), (-1.36, 9.76), (-0.60, 9.82),
             (0.02, 9.76), (0.10, 9.48), (0.06, 9.00)]
HW = 0.47
LENS_MAIN = (0.21, 9.20, 0.09)                               # x, z, r (the rig's LEFT side)
LENS_CLUSTER = [(-0.30, 9.26, 0.03), (-0.30, 9.18, 0.03), (-0.30, 9.10, 0.03)]
SLIT = (0.0, 9.36, 0.62, 0.05)                               # x, z, width, height
FACE_Y = -1.18
HEAD_OFS = V((0.0, -0.08, 0.08))    # head authored in place, then nudged up/forward


def build_head():
    g = Geo()
    neck = P.banded_cylinder([(0.06, 0.3, 'steel_dark'), (0.2, 0.34, 'paint_dark'), (0.05, 0.31, 'steel_dark')],
                             segs=32, step=0.0, mat='paint_dark')
    g.merge(neck.move(0, -0.58, 8.78))
    secs = [(K.scale2(HEAD_PROF, 0.92), -HW), (HEAD_PROF, -HW + 0.07), (HEAD_PROF, HW - 0.07),
            (K.scale2(HEAD_PROF, 0.92), HW)]
    cab = K.loft_pts(secs, axis='X', bevel=0.016, mat='paint_primary')
    K.grooves(cab, [(0, 0, 1), (1, 0, 0), (-1, 0, 0)], (0, -0.3, 0), (0, 1, 0), gap=0.016, depth=0.014)
    # recessed sensor face (under the brow) + rear vent hatch
    K.hatch_at(cab, (0, FACE_Y, 9.29), (0, -1, 0), (0.8, 0.44), u_axis=(1, 0, 0), recess=0.06, mat='steel_dark',
               gap=0.014, angle=10)
    K.hatch_at(cab, (0, 0.09, 9.32), (0, 1, 0), (0.6, 0.26), u_axis=(1, 0, 0), recess=0.05, mat='steel_dark', angle=20)
    g.merge(cab)
    fy = FACE_Y + 0.06
    # slit housing (narrow 4 cm slot in a steel bar)
    sx, sz, sw, sh = SLIT
    bar = P.box((sw + 0.1, 0.05, sh + 0.08), bevel=0.008, segs=1, mat='steel_dark').move(sx, fy - 0.02, sz)
    bar.boolean(P.box((sw, 0.2, sh), bevel=0.0, segs=1, mat='steel_dark').move(sx, fy - 0.05, sz))
    g.merge(bar)
    # main lens bezel (18 cm) + lens cluster bezels
    lx, lz, lr = LENS_MAIN
    g.merge(P.ring(lr * 1.4, lr * 0.98, 0.06, 32, bevel=0.006, bsegs=1, mat='steel', z0=0.0)
            .align((0, -1, 0), loc=(lx, fy, lz)))
    g.merge(P.ring(lr * 1.62, lr * 1.38, 0.03, 32, bevel=0.0, bsegs=1, mat='steel_dark', z0=0.0)
            .align((0, -1, 0), loc=(lx, fy + 0.01, lz)))
    for (cx, cz, cr) in LENS_CLUSTER:
        g.merge(P.ring(cr * 1.5, cr * 0.95, 0.04, 16, bevel=0.0, bsegs=1, mat='steel', z0=0.0)
                .align((0, -1, 0), loc=(cx, fy, cz)))
    g.merge(P.box((0.1, 0.03, 0.26), bevel=0.006, segs=1, mat='steel_dark').move(-0.3, fy + 0.012, 9.18))
    # brow: bone plate over the top, ridged, overhanging the face by ~0.25 m
    g.merge(K.plate_world([(-0.5, -1.44, 9.66), (0.5, -1.44, 9.66), (0.46, -0.05, 9.72), (-0.46, -0.05, 9.72)], 0.05,
                          mat='paint_secondary', normal_hint=(0, 0, 1), chamfer=0.08, ridge=0.02, ridge_axis='Y'))
    g.merge(K.strip((-0.44, -1.42, 9.58), (0.44, -1.42, 9.58), 0.06, 0.012, (0, -1, 0.1), mat='hazard'))
    for s in (1, -1):
        x = s * (HW + 0.005)
        g.merge(K.plate_world([(x, -1.14, 9.04), (x, -0.3, 9.02), (x, -0.08, 9.40), (x, -0.7, 9.62), (x, -1.14, 9.48)],
                              0.05, mat='paint_primary', normal_hint=(s, 0, 0), chamfer=0.05, bolts=1,
                              bolt_r=0.015, bolt_spacing=0.2))
        g.merge(P.cylinder(0.08, 0.1, 24, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                .align((s, 0, 0), loc=(x + s * 0.05, -0.05, 9.32)))
    g.merge(P.antenna(0.9, r=0.011, base_r=0.04, segs=12).move(0.32, -0.12, 9.72))
    g.merge(P.cylinder(0.08, 0.05, 24, bevel=0.0, mat='steel_dark', z0=9.72).move(-0.3, -0.2, 0))
    g.merge(P.dome(0.06, 0.07, 20, 3, mat='marker_amber').move(-0.3, -0.2, 9.77))
    g.merge(K.shackle(0.06, bar=0.016).move(0.0, -0.3, 9.74))
    return g.move(HEAD_OFS)


def build_eye():
    g = Geo()
    fy = FACE_Y + 0.06
    sx, sz, sw, sh = SLIT
    g.merge(P.box((sw - 0.01, 0.02, sh - 0.012), bevel=0.003, segs=1, mat='lens').move(sx, fy - 0.01, sz))
    lx, lz, lr = LENS_MAIN
    g.merge(P.dome(lr, lr * 0.45, 32, 4, mat='lens').align((0, -1, 0), loc=(lx, fy - 0.02, lz)))
    for (cx, cz, cr) in LENS_CLUSTER:
        g.merge(P.dome(cr, cr * 0.5, 16, 2, mat='lens').align((0, -1, 0), loc=(cx, fy - 0.01, cz)))
    return g.move(HEAD_OFS)


# ============================================================================ arms
# pauldron side profiles (y, z) at four X stations: the top slopes down outward and the lower
# lip flares out and down -> an angular trapezoid in front view, the upper arm stays exposed
PA_IN = [(-0.74, 8.00), (-0.92, 8.44), (-0.70, 9.28), (-0.06, 9.66), (0.70, 9.50), (0.92, 8.94), (0.88, 8.06),
         (0.50, 7.88), (-0.38, 7.86)]
PA_OUT = [(-0.84, 7.82), (-1.00, 8.30), (-0.80, 8.98), (-0.14, 9.22), (0.68, 9.12), (0.98, 8.72), (0.96, 7.92),
          (0.56, 7.68), (-0.40, 7.68)]
PA_LIP = [(-0.80, 7.52), (-0.94, 8.10), (-0.76, 8.70), (-0.14, 8.88), (0.62, 8.82), (0.90, 8.52), (0.92, 7.62),
          (0.52, 7.40), (-0.38, 7.40)]
PX = (2.26, 2.44, 3.30, 3.56)


def paul_pt(i, x, lift=0.0):
    """Point i of the pauldron outline at station x (linear between stations)."""
    st = [(PX[0], [(y, z - 0.02) for y, z in PA_IN]), (PX[1], PA_IN), (PX[2], PA_OUT), (PX[3], PA_LIP)]
    for k in range(len(st) - 1):
        (xa, A), (xb, B) = st[k], st[k + 1]
        if xa <= x <= xb:
            t = (x - xa) / (xb - xa)
            return V((x, A[i][0] + (B[i][0] - A[i][0]) * t, A[i][1] + (B[i][1] - A[i][1]) * t + lift))
    return V((x, st[-1][1][i][0], st[-1][1][i][1] + lift))


def paul_plate(i, j, x0, x1, thick, mat, inset=0.06, **kw):
    """Armour plate over the pauldron face between outline points i -> j, stations x0..x1."""
    a, b = paul_pt(i, x0), paul_pt(j, x0)
    c, d = paul_pt(j, x1), paul_pt(i, x1)
    e = (b - a).normalized()
    pts = [a + e * inset, b - e * inset, c - (c - d).normalized() * inset, d + (c - d).normalized() * inset]
    n = (pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized()
    return K.plate_world(pts, thick, mat=mat, normal_hint=n if n.x * 0 + n.z >= -1 else n, **kw)


def build_arm(side):
    """Pauldron + open upper-arm frame (authored for L = +X, mirrored for R)."""
    g = Geo()
    g.merge(K.drum((2.30, SHOULDER.y, SHOULDER.z), (1, 0, 0), 0.5, 0.52, mat='paint_dark'))
    secs = [([(y, z - 0.02) for y, z in PA_IN], PX[0]), (PA_IN, PX[1]), (PA_OUT, PX[2]), (PA_LIP, PX[3])]
    pa = K.loft_pts(secs, axis='X', bevel=0.018, mat='paint_primary')
    K.grooves(pa, [(1, 0, 0), (0, 0, 1), (0.5, 0, 1), (-0.5, 0, 1), (0, -1, 0.5), (0, 1, 0.5)], (0, 0.22, 0),
              (0, 1, 0), gap=0.018, depth=0.016)
    armour = []
    # bone top plates (top + front slope), primary outer face plate, orange lip strip
    armour.append(paul_plate(3, 4, 2.2, 3.26, 0.06, 'paint_secondary', chamfer=0.07, bolts=1, bolt_r=0.017,
                             bolt_spacing=0.3))
    armour.append(paul_plate(2, 3, 2.2, 3.26, 0.06, 'paint_secondary', chamfer=0.07))
    armour.append(paul_plate(4, 5, 2.2, 3.26, 0.05, 'paint_primary', chamfer=0.05))
    a0, a1, a2, a3 = paul_pt(1, PX[3], 0), paul_pt(6, PX[3], 0), paul_pt(6, PX[3]), paul_pt(1, PX[3])
    face = [V((PX[3] + 0.005, -0.84, 7.72)), V((PX[3] + 0.005, 0.84, 7.72)), V((PX[3] + 0.005, 0.84, 8.56)),
            V((PX[3] + 0.005, -0.1, 8.9)), V((PX[3] + 0.005, -0.84, 8.62))]
    armour.append(K.plate_world(face, 0.07, mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.1, bolts=1,
                                bolt_r=0.018, bolt_spacing=0.3))
    armour.append(K.strip(paul_pt(8, PX[3] - 0.08, -0.02) + V((0, -0.3, 0)), paul_pt(7, PX[3] - 0.08, -0.02),
                          0.1, 0.03, (0.3, 0, -1)))
    armour.append(rivets(paul_pt(2, PX[3] - 0.03, 0.0) + V((0.02, 0.06, -0.06)),
                         paul_pt(5, PX[3] - 0.03, 0.0) + V((0.02, -0.06, -0.06)), 0.12, (1, 0, 0.25)))
    armour.append(marker((3.2, -0.99, 7.72), (0, -1, -0.3), 'cyan', 0.05))
    g.merge(pa, *armour)
    g.merge(K.shackle(0.08, bar=0.02).move(2.66, 0.25, paul_pt(3, 2.66).z + 0.02))
    lv = P.louvres(0.46, 0.4, count=4, depth=0.05, angle=24, thickness=0.018, mat='steel_dark', side_mat='paint_dark')
    g.merge(lv.rotate((0, 0, 90)).rotate((0, -32, 0)).move(2.96, 1.0, 8.72))
    # ---- open upper-arm frame (local frame along shoulder -> elbow)
    F = seg_frame(SHOULDER, ELBOW)
    L = L_UARM
    fr = Geo()
    strut = K.shell([(-0.36, -0.2, 0.2, -0.22, 0.22, 0.07), (-(L - 0.42), -0.18, 0.18, -0.2, 0.2, 0.06)], 'Z',
                    bevel=0.012, mat='paint_dark')
    fr.merge(strut)
    fr.merge(P.cylinder(0.3, 0.1, 40, bevel=0.012, bsegs=1, mat='steel_dark', z0=0.0).rotate((0, 90, 0))
             .move(0.2, 0, 0))   # actuator disc on the shoulder drum
    fr.merge(P.bolt_circle((0.3, 0, 0), (1, 0, 0), 0.22, 8, r=0.018))
    fr.merge(K.plate_world([(0.24, -0.3, -0.42), (0.24, 0.3, -0.42), (0.24, 0.26, -1.0), (0.24, -0.26, -1.0)], 0.06,
                           mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.06, bolts=1, bolt_r=0.015,
                           bolt_spacing=0.24))
    for yy in (-0.33, 0.33):
        fr.merge(K.ram((0.02, yy, -0.3), (0.02, yy * 0.9, -(L - 0.1)), r=0.075, frac=0.52, segs=24, up=(1, 0, 0),
                       eyes=True))
    for cx, sg in ((-0.34, -1), (0.34, 1)):
        fr.merge(K.cheek((cx, 0.0, -L), sg, 0.36, 0.08, strap_to=(0.0, -(L - 0.5)), strap_w=0.42, bolts=6))
    fr.merge(P.hose([(-0.22, 0.22, -0.3), (-0.3, 0.3, -0.8), (-0.24, 0.2, -1.25)], 0.032, 12, rib_amp=0.004,
                    rib_freq=30))
    fr.transform(F)
    g.merge(fr)
    if side == 'R':
        g.mirror('X')
    return g


def build_forearm_local(weapon_side_blade):
    g = Geo()
    g.merge(K.drum((0, 0, 0), (1, 0, 0), 0.36, 0.6, mat='paint_dark', hub=False))
    c = (0.1, 0.12, 0.24, 0.16)
    fa = K.shell([(-0.30, -0.44, 0.44, -0.42, 0.40, c), (-0.80, -0.50, 0.50, -0.48, 0.47, c),
                  (-1.60, -0.47, 0.47, -0.45, 0.43, c), (-1.74, -0.41, 0.41, -0.39, 0.37, 0.1)], 'Y', bevel=0.016,
                 mat='paint_primary')
    for y in (-0.62, -1.28):
        K.grooves(fa, [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)], (0, y, 0), (0, 1, 0), gap=0.018, depth=0.016)
    armour = [K.plate_at(fa, (0.5, -1.0, 0.0), (1, 0, 0), u_axis=(0, -1, 0), margin=0.06, thickness=0.06,
                         chamfer=0.06, mat='paint_primary', bolts=1, bolt_r=0.016, bolt_spacing=0.3),
              K.plate_at(fa, (0.0, -1.0, 0.47), (0, 0, 1), u_axis=(0, -1, 0), margin=0.07, thickness=0.06,
                         ridge=0.025, ridge_axis='X', chamfer=0.07, mat='paint_secondary', bolts=1, bolt_r=0.016,
                         bolt_spacing=0.34)]
    K.hatch_at(fa, (-0.5, -1.0, 0.0), (-1, 0, 0), (0.7, 0.42), u_axis=(0, 1, 0), recess=0.04, mat='steel_dark')
    g.merge(fa, *[x for x in armour if x is not None])
    g.merge(rivets((0.54, -0.42, 0.3), (0.54, -1.58, 0.3), 0.12, (1, 0, 0)))
    g.merge(K.ram((0.0, -0.2, -0.54), (0.0, -1.62, -0.52), r=0.08, frac=0.55, segs=24, up=(1, 0, 0), eyes=True))
    for y in (-0.2, -1.62):
        g.merge(P.box((0.34, 0.16, 0.14), bevel=0.012, segs=1, mat='steel_dark').move(0, y, -0.46))
    g.merge(P.hose([(-0.46, 0.0, -0.2), (-0.52, -0.6, -0.26), (-0.5, -1.3, -0.3), (-0.4, -1.72, -0.24)], 0.034, 12,
                   rib_amp=0.004, rib_freq=30))
    cuff = K.shell([(-1.72, -0.36, 0.36, -0.34, 0.32, 0.1), (-1.9, -0.34, 0.34, -0.32, 0.3, 0.1)], 'Y', bevel=0.012,
                   mat='steel_dark')
    g.merge(cuff)
    if not weapon_side_blade:
        # right forearm: ammo feed box + armoured duct to the rifle
        g.merge(K.shell([(-0.5, 0.5, 0.72, -0.3, 0.2, 0.05), (-1.4, 0.5, 0.7, -0.28, 0.18, 0.05)], 'Y', bevel=0.012,
                        mat='paint_dark'))
        g.merge(P.hose([(0.6, -1.4, -0.1), (0.56, -1.8, -0.2), (0.36, -2.1, -0.32)], 0.04, 12, rib_amp=0.005,
                       rib_freq=26))
    return g


def build_hand_local():
    """Closed fist at the wrist (forearm-local, x centred): palm, knuckle guard, 4 fingers."""
    g = Geo()
    wy = -L_FARM
    g.merge(P.cylinder(0.17, 0.5, 24, bevel=0.012, mat='steel').rotate((0, 90, 0)).move(0, wy, 0))
    palm = P.box((0.36, 0.44, 0.5), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='X', mat='steel_dark')
    g.merge(palm.move(0.0, wy - 0.3, -0.06))
    g.merge(K.plate_world([(0.19, wy - 0.08, -0.3), (0.19, wy - 0.08, 0.18), (0.19, wy - 0.52, 0.14),
                           (0.19, wy - 0.52, -0.28)], 0.05, mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.05,
                          bolts=1, bolt_r=0.014, bolt_spacing=0.2))
    g.merge(K.plate_world([(-0.18, wy - 0.12, 0.2), (0.18, wy - 0.12, 0.2), (0.18, wy - 0.5, 0.17),
                           (-0.18, wy - 0.5, 0.17)], 0.04, mat='paint_primary', normal_hint=(0, 0, 1), chamfer=0.04))
    for i in range(4):
        x = -0.135 + i * 0.09
        g.merge(P.box((0.08, 0.2, 0.13), bevel=0.012, segs=1, mat='steel_dark').move(x, wy - 0.6, 0.02))
        g.merge(P.cylinder(0.05, 0.085, 12, bevel=0.006, bsegs=1, mat='steel').rotate((0, 90, 0))
                .move(x, wy - 0.68, -0.06))
        g.merge(P.box((0.08, 0.14, 0.2), bevel=0.012, segs=1, mat='paint_primary').move(x, wy - 0.7, -0.2))
        g.merge(P.box((0.075, 0.18, 0.1), bevel=0.01, segs=1, mat='steel_dark').move(x, wy - 0.6, -0.33))
    g.merge(P.box((0.12, 0.26, 0.12), bevel=0.012, segs=1, mat='steel_dark').rotate((0, 0, 25))
            .move(-0.2, wy - 0.44, -0.16))
    return g


# ============================================================================ weapons (forearm-local)
GRIP = V((0.0, -L_FARM - 0.58, -0.2))      # rifle grip inside the R fist (forearm-local, before mirroring)
RIFLE_S = 1.2


def build_rifle_local():
    """RF-24 'BRASSWORK' assault rifle, authored in its own frame (grip at the origin,
    barrel along -Y, x = 0), then placed in the fist along the forearm."""
    g = Geo()
    # receiver side profile (y, z) around the grip at y 0
    y0, y1 = 0.26, -1.12
    rec = P.prism([(y0, 0.12), (y1, 0.12), (y1, 0.44), (y1 + 0.2, 0.58), (y0 - 0.2, 0.58), (y0, 0.4)], 0.34,
                  bevel=0.016, segs=1, mat='paint_primary', axis='X')
    for y in (-0.22, -0.72):
        K.grooves(rec, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, y, 0), (0, 1, 0), gap=0.014, depth=0.012)
    K.hatch_at(rec, (-0.17, -0.47, 0.4), (-1, 0, 0), (0.36, 0.12), u_axis=(0, 1, 0), recess=0.04, mat='steel_dark')
    arm = []
    for n in ((-1, 0, 0), (1, 0, 0)):
        arm.append(K.plate_at(rec, (n[0] * 0.17, -0.9, 0.36), n, u_axis=(0, -1, 0), margin=0.03, thickness=0.035,
                              chamfer=0.04, mat='paint_primary', bolts=1, bolt_r=0.012, bolt_spacing=0.16))
    g.merge(rec, *[x for x in arm if x is not None])
    g.merge(P.box((0.3, 0.72, 0.1), bevel=0.012, segs=1, mat='steel_dark').move(0, -0.22, 0.06))
    g.merge(P.box((0.15, 0.18, 0.5), bevel=0.02, segs=1, chamfer=0.03, chamfer_axes='Z', mat='rubber')
            .rotate((-10, 0, 0)).move(0, 0.06, -0.08))
    mag = P.prism([(-0.44, 0.12), (-0.86, 0.12), (-0.94, -0.44), (-0.56, -0.44)], 0.26, bevel=0.014, segs=1,
                  mat='paint_dark', axis='X')
    for y in (-0.64, -0.74):
        K.grooves(mag, [(1, 0, 0), (-1, 0, 0)], (0, y, 0), (0, 1, 0.14), gap=0.012, depth=0.01)
    g.merge(mag)
    g.merge(P.box((0.3, 0.42, 0.05), bevel=0.01, segs=1, mat='paint_accent').move(0, -0.75, -0.47))
    g.merge(P.box((0.15, 1.0, 0.04), bevel=0.008, segs=1, mat='steel_dark').move(0, -0.52, 0.6))
    for i in range(7):
        g.merge(P.box((0.17, 0.035, 0.026), bevel=0.005, segs=1, mat='steel_dark').move(0, -0.14 - i * 0.12, 0.635))
    g.merge(K.shell([(-0.1, -0.13, 0.13, 0.66, 0.84, 0.04), (-0.4, -0.15, 0.15, 0.66, 0.86, 0.05)], 'Y', bevel=0.01,
                    mat='paint_dark'))
    g.merge(P.ring(0.06, 0.04, 0.03, 24, bevel=0.0, mat='steel', z0=0.0).align((0, -1, 0), loc=(0.04, -0.4, 0.76)))
    g.merge(P.dome(0.045, 0.02, 24, 2, mat='lens').align((0, -1, 0), loc=(0.04, -0.41, 0.76)))
    oc = [(math.cos(a) * 0.17, math.sin(a) * 0.17 + 0.36) for a in [math.pi / 8 + i * math.pi / 4 for i in range(8)]]
    sh = P.loft([(oc, y1 + 0.02), (oc, -2.22)], bevel=0.012, segs=1, mat='paint_primary')
    for sgn in (-1, 1):
        for k in range(3):
            K.hatch_at(sh, (sgn * 0.16, -1.42 - k * 0.24, 0.36), (sgn, 0, 0), (0.15, 0.08), u_axis=(0, 1, 0),
                       recess=0.035, mat='steel_dark', gap=0.01)
    g.merge(sh)
    oc2 = [(x * 1.14, (z - 0.36) * 1.14 + 0.36) for x, z in oc]
    for y in (-1.22, -2.16):
        g.merge(P.loft([(oc2, y + 0.035), (oc2, y - 0.035)], bevel=0.006, segs=1, mat='steel_dark'))
    hs = P.plate(P.fillet([(-0.11, -0.46), (0.11, -0.46), (0.11, 0.46), (-0.11, 0.46)], 0.03, 1), 0.035,
                 ridge=0.02, ridge_axis='Y', bevel=0.006, segs=1, mat='paint_secondary')
    g.merge(hs.move(0, -1.68, 0.52))
    g.merge(P.cylinder(0.068, 0.62, 32, bevel=0.008, bsegs=1, mat='steel_dark', z0=0.0).align((0, -1, 0),
                                                                                           loc=(0, -2.2, 0.36)))
    for k in range(4):
        g.merge(P.ring(0.11, 0.06, 0.018, 24, bevel=0.0, bsegs=1, mat='steel', z0=0.0)
                .align((0, -1, 0), loc=(0, -2.28 - k * 0.055, 0.36)))
    g.merge(P.ring(0.088, 0.06, 0.09, 32, bevel=0.008, bsegs=1, mat='hazard', z0=0.0).align((0, -1, 0),
                                                                                         loc=(0, -2.6, 0.36)))
    mb = P.box((0.24, 0.36, 0.2), bevel=0.014, segs=1, chamfer=0.035, chamfer_axes='Y', mat='steel_dark')
    mb.move(0, -3.0, 0.36)
    for k in range(2):
        mb.boolean(P.box((0.5, 0.06, 0.1), bevel=0.0, segs=1, mat='steel_dark').move(0, -2.92 - k * 0.1, 0.36))
    mb.boolean(P.cylinder(0.045, 0.5, 24, bevel=0.0, mat='steel_dark').align((0, -1, 0), loc=(0, -2.9, 0.36)))
    g.merge(mb)
    cell = P.banded_cylinder([(0.03, 0.07, 'steel_dark'), (0.3, 0.085), (0.02, 0.078, 'steel_dark'),
                              (0.07, 0.085, 'hazard'), (0.03, 0.065, 'steel')], segs=24, step=0.0, mat='paint_dark')
    g.merge(cell.align((0, -1, 0), loc=(0.25, -0.05, 0.24)))
    g.merge(P.box((0.08, 0.36, 0.05), bevel=0.008, segs=1, mat='steel_dark').move(0.19, -0.25, 0.18))
    g.merge(P.bolt_row((-0.172, 0.1, 0.2), (-0.172, -1.0, 0.2), 5, (-1, 0, 0), r=0.013))
    return g.scale(RIFLE_S)


RIFLE_MUZZLE_LOCAL = V((0.0, -3.18, 0.36)) * RIFLE_S


def rifle_matrix():
    """Rifle frame (grip) -> world, RIGHT hand (after the L->R mirror of the arm chain)."""
    # grip point in forearm-local (L side), then the same forearm transform as the arm
    M = Matrix.Translation((ELBOW.x, ELBOW.y, ELBOW.z)) @ Matrix.Rotation(math.radians(FA_PITCH), 4, 'X') @ \
        Matrix.Translation(GRIP)
    return M


def build_blade_local():
    """PB-7 'EMBERLINE' pulse-blade emitter on the outer side of the LEFT forearm (+X)."""
    g = Geo()
    c = (0.06, 0.08, 0.14, 0.08)
    h = K.shell([(-0.30, 0.50, 0.84, -0.26, 0.2, c), (-1.62, 0.50, 0.88, -0.28, 0.26, c),
                 (-2.2, 0.56, 0.8, -0.2, 0.14, c)], 'Y', bevel=0.014, mat='paint_secondary')
    K.grooves(h, [(0, 0, 1), (1, 0, 0), (-1, 0, 0), (1, 0, 1)], (0, -1.0, 0), (0, 1, 0), gap=0.016, depth=0.014)
    K.hatch_at(h, (0.87, -0.8, 0.0), (1, 0, 0), (0.44, 0.3), u_axis=(0, 1, 0), recess=0.03, mat='steel_dark')
    g.merge(h)
    for i in range(4):
        g.merge(P.box((0.03, 0.1, 0.3), bevel=0.005, segs=1, mat='steel_dark').move(0.9, -0.5 - i * 0.12, 0.0))
    for z in (-0.16, 0.1):
        pr = P.prism(P.fillet([(-2.1, z - 0.04), (-2.66, z - 0.02), (-2.7, z + 0.06), (-2.1, z + 0.08)], 0.03, 1), 0.1,
                     bevel=0.01, segs=1, mat='steel_dark', axis='X')
        g.merge(pr.move(0.68, 0, 0))
    g.merge(P.box((0.2, 0.03, 0.24), bevel=0.004, segs=1, mat='lens').move(0.68, -2.62, -0.03))
    g.merge(P.box((0.26, 0.1, 0.32), bevel=0.01, segs=1, mat='steel_dark').move(0.68, -2.44, -0.03))
    cap = P.banded_cylinder([(0.03, 0.065, 'steel_dark'), (0.5, 0.075), (0.03, 0.065, 'steel_dark')], segs=24,
                            step=0.0, mat='paint_dark')
    g.merge(cap.align((0, -1, 0), loc=(0.68, -0.9, 0.3)))
    g.merge(P.hose([(0.56, -0.32, -0.26), (0.5, -0.1, -0.3), (0.4, 0.0, -0.3)], 0.028, 12, rib_amp=0.004,
                   rib_freq=30))
    g.merge(P.bolt_row((0.885, -0.3, 0.16), (0.885, -1.6, 0.16), 5, (1, 0, 0), r=0.013))
    return g


BLADE_MUZZLE_LOCAL = V((0.68, -2.72, -0.03))


def build_missile():
    """ML-6 'HAILSTORM' box launcher on the left back pylon (+X), 4 x 3 cells."""
    g = Geo()
    bx, by, bz = MISSILE_MOUNT
    g.merge(K.drum((bx, by, bz), (1, 0, 0), 0.22, 0.52, mat='paint_dark', profile='ring', hub=True, bolts=6))
    c = (0.06, 0.1, 0.2, 0.08)
    x0, x1 = bx - 0.58, bx + 0.58
    box = K.shell([(-1.0, x0 + 0.04, x1 - 0.04, 9.14, 10.04, c), (-0.84, x0, x1, 9.1, 10.1, c),
                   (1.12, x0, x1, 9.1, 10.1, c), (1.3, x0 + 0.06, x1 - 0.06, 9.16, 10.02, c)], 'Y', bevel=0.016,
                  mat='paint_primary')
    K.grooves(box, [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (1, 0, 1)], (0, 0.2, 0), (0, 1, 0), gap=0.018, depth=0.016)
    armour = [K.plate_at(box, (x1 + 0.01, -0.1, 9.6), (1, 0, 0), u_axis=(0, -1, 0), margin=0.07, thickness=0.06,
                         chamfer=0.08, mat='paint_secondary', bolts=1, bolt_r=0.017, bolt_spacing=0.34),
              K.plate_at(box, (bx, 0.6, 10.11), (0, 0, 1), u_axis=(0, -1, 0), margin=0.08, thickness=0.05,
                         chamfer=0.07, mat='paint_primary')]
    g.merge(box, *[x for x in armour if x is not None])
    cp, cells = K.cell_panel(1.1, 0.92, 4, 3, 0.07, 0.045, 0.12, t=0.14, mat='paint_primary')
    Mc = Matrix.Translation((bx, -1.02, 9.6)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    cp.transform(Mc)
    g.merge(cp)
    for (x, y, z) in cells:
        p = Mc @ V((x, y, -0.12))
        g.merge(P.dome(0.075, 0.09, 16, 3, mat='paint_secondary').align((0, -1, 0), loc=p))
        g.merge(P.ring(0.082, 0.064, 0.02, 16, bevel=0.0, mat='paint_accent', z0=0.0).align((0, 1, 0), loc=p))
    g.merge(K.strip((x0 + 0.04, -1.1, 10.07), (x1 - 0.04, -1.1, 10.07), 0.07, 0.014, (0, -1, 0), mat='hazard'))
    gr = P.grille(0.84, 0.54, bars=6, bar_r=0.016, frame=0.05, depth=0.05, mat='paint_primary', horizontal=True)
    g.merge(gr.rotate((-90, 0, 0)).move(bx, 1.32, 9.6))
    g.merge(K.shackle(0.07, bar=0.018).move(bx, 0.3, 10.14))
    g.merge(rivets((x0 - 0.005, -0.7, 9.22), (x0 - 0.005, 1.0, 9.22), 0.12, (-1, 0, 0)))
    g.merge(rivets((x0 - 0.005, -0.7, 9.98), (x0 - 0.005, 1.0, 9.98), 0.12, (-1, 0, 0)))
    return g


CANNON_ELEV = 10.0   # degrees the stowed barrel points above the horizon
MUZ_RB_LOCAL = V((0.0, -3.62, 0.0))


def build_cannon():
    """HC-90 'SLEDGE' heavy cannon over the RIGHT shoulder (-X): receiver on the pylon,
    long barrel stowed forward at +10 deg."""
    g = Geo()
    mxp, myp, mzp = CANNON_MOUNT
    g.merge(K.drum((mxp, myp, mzp), (1, 0, 0), 0.23, 0.46, mat='paint_dark', profile='ring', bolts=6))
    loc = Geo()
    # authored with the trunnion at the origin, barrel axis along -Y at z = 0.3
    x0, x1 = -0.38, 0.38
    rec = K.shell([(-0.7, x0 + 0.04, x1 - 0.04, -0.12, 0.54, 0.1), (-0.2, x0, x1, -0.18, 0.6, 0.14),
                   (0.9, x0 + 0.02, x1 - 0.02, -0.16, 0.56, 0.14), (1.12, x0 + 0.08, x1 - 0.08, -0.1, 0.48, 0.1)], 'Y',
                  bevel=0.016, mat='paint_primary')
    K.grooves(rec, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, 0.3, 0), (0, 1, 0), gap=0.018, depth=0.016)
    armour = [K.plate_at(rec, (x0 - 0.01, 0.2, 0.2), (-1, 0, 0), u_axis=(0, 1, 0), margin=0.06, thickness=0.05,
                         chamfer=0.07, mat='paint_secondary', bolts=1, bolt_r=0.016, bolt_spacing=0.34)]
    K.hatch_at(rec, (0.0, 0.4, 0.6), (0, 0, 1), (0.46, 0.5), u_axis=(1, 0, 0), recess=0.04, mat='steel_dark')
    loc.merge(rec, *[x for x in armour if x is not None])
    zb = 0.3
    jk = P.banded_cylinder([(0.08, 0.25, 'steel_dark'), (0.42, 0.27), (0.05, 0.245, 'steel_dark'), (0.42, 0.27),
                            (0.05, 0.245, 'steel_dark'), (0.3, 0.27), (0.1, 0.23, 'steel_dark')], segs=40, step=0.0,
                           mat='paint_primary')
    loc.merge(jk.align((0, -1, 0), loc=(0, -0.7, zb)))
    loc.merge(P.cylinder(0.16, 2.3, 40, bevel=0.012, bsegs=1, mat='steel_dark', z0=0.0).align((0, -1, 0),
                                                                                           loc=(0, -2.1, zb)))
    loc.merge(P.ring(0.195, 0.155, 0.14, 40, bevel=0.0, bsegs=1, mat='hazard', z0=0.0).align((0, -1, 0),
                                                                                         loc=(0, -3.26, zb)))
    for y in (-2.5, -3.0):
        loc.merge(P.ring(0.205, 0.155, 0.06, 40, bevel=0.0, bsegs=1, mat='steel', z0=0.0).align((0, -1, 0),
                                                                                             loc=(0, y, zb)))
    mb = P.box((0.46, 0.54, 0.4), bevel=0.016, segs=1, chamfer=0.06, chamfer_axes='Y', mat='steel_dark')
    mb.move(0, -3.66, zb)
    for k in range(2):
        mb.boolean(P.box((0.8, 0.08, 0.18), bevel=0.0, segs=1, mat='steel_dark').move(0, -3.54 - k * 0.16, zb))
    mb.boolean(P.cylinder(0.11, 0.8, 32, bevel=0.0, mat='steel_dark').align((0, -1, 0), loc=(0, -3.34, zb)))
    loc.merge(mb)
    for s in (-1, 1):
        loc.merge(P.cylinder(0.05, 1.5, 24, bevel=0.006, bsegs=1, mat='chrome', z0=0.0)
                  .align((0, -1, 0), loc=(s * 0.3, -0.3, zb - 0.18)))
        loc.merge(P.cylinder(0.078, 0.5, 24, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                  .align((0, -1, 0), loc=(s * 0.3, -0.25, zb - 0.18)))
        loc.merge(P.box((0.14, 0.12, 0.14), bevel=0.01, segs=1, mat='steel_dark').move(s * 0.24, -1.8, zb - 0.16))
    loc.merge(P.box((0.7, 0.14, 0.2), bevel=0.01, segs=1, mat='steel_dark').move(0, -1.8, zb - 0.12))
    loc.merge(K.ram((0, 0.9, 0.62), (0, -0.4, 0.64), r=0.065, frac=0.6, up=(1, 0, 0), segs=24))
    loc.merge(rivets((x0 - 0.005, -0.5, -0.06), (x0 - 0.005, 0.9, -0.06), 0.12, (-1, 0, 0)))
    loc.transform(Matrix.Translation((mxp, myp, mzp)) @ Matrix.Rotation(math.radians(CANNON_ELEV), 4, 'X'))
    g.merge(loc)
    return g


def cannon_pt(p):
    return tuple(Matrix.Translation(CANNON_MOUNT) @ Matrix.Rotation(math.radians(CANNON_ELEV), 4, 'X') @ V(p))


# ============================================================================ booster pack
def build_backpack():
    g = Geo()
    c1 = (0.2, 0.2, 0.26, 0.26)
    c2 = (0.24, 0.24, 0.32, 0.32)
    b = K.shell([(6.40, -1.06, 1.06, 0.98, 2.06, c1), (7.22, -1.36, 1.36, 0.96, 2.46, c2),
                 (8.40, -1.26, 1.26, 0.96, 2.32, c2), (8.84, -1.06, 1.06, 0.98, 2.06, c1)], 'Z', bevel=0.018,
                mat='paint_primary')
    for z in (7.1, 7.96):
        K.grooves(b, [(0, 1, 0), (1, 0, 0), (-1, 0, 0), (1, 1, 0), (-1, 1, 0)], (0, 0, z), (0, 0, 1), gap=0.02,
                  depth=0.018)
    armour = [K.plate_world([(-1.02, 2.5, 7.22), (-0.46, 2.5, 7.22), (-0.46, 2.38, 8.2), (-1.0, 2.36, 8.2)], 0.07,
                            mat='paint_secondary', normal_hint=(0, 1, 0), chamfer=0.06, bolts=1, bolt_r=0.017,
                            bolt_spacing=0.28)]
    g.merge(b, *armour)
    hs = P.louvres(1.12, 1.0, count=8, depth=0.08, angle=30, thickness=0.02, mat='steel_dark', side_mat='paint_dark')
    g.merge(hs.rotate((-90, 0, 0)).rotate((0, 0, 0)).move(0.26, 2.44, 7.72))
    for s in (1, -1):
        # rectangular louvred flank intakes (no round ports)
        v = P.vent(0.9, 0.62, depth=0.1, slats=7, frame=0.05, angle=38, mat='paint_dark')
        v.align((s, 0, 0), up=(0, 0, 1), loc=(s * 1.37, 1.72, 7.68))
        g.merge(v)
        g.merge(K.shackle(0.08, bar=0.02).move(s * 0.82, 2.0, 8.84))
        g.merge(P.box((0.9, 0.34, 0.74), bevel=0.02, segs=1, chamfer=0.1, chamfer_axes='Y', mat='paint_dark')
                .move(s * 0.62, 2.28, 6.86))
        g.merge(P.box((0.5, 0.26, 0.48), bevel=0.02, segs=1, chamfer=0.07, chamfer_axes='Y', mat='paint_dark')
                .move(s * 0.94, 2.38, 7.72))
        g.merge(marker((s * 1.2, 2.42, 8.48), (0, 1, 0.2), 'amber', 0.05))
    # heat-shield louvre bank between the two main bells (vertical fins)
    shield = K.shell([(6.28, -0.3, 0.3, 2.2, 2.66, 0.06), (7.24, -0.3, 0.3, 2.3, 2.56, 0.06)], 'Z', bevel=0.012,
                     mat='paint_dark')
    g.merge(shield)
    for i in range(7):
        g.merge(P.box((0.026, 0.2, 0.86), bevel=0.0, segs=1, mat='steel').move(-0.21 + i * 0.07, 2.72, 6.78))
    g.merge(P.box((0.62, 0.08, 0.06), bevel=0.006, segs=1, mat='steel_dark').move(0, 2.7, 7.24))
    g.merge(P.box((0.62, 0.08, 0.06), bevel=0.006, segs=1, mat='steel_dark').move(0, 2.74, 6.34))
    top = P.louvres(1.7, 0.8, count=6, depth=0.06, angle=22, thickness=0.02, mat='steel_dark', side_mat='paint_dark')
    g.merge(top.move(0, 1.52, 8.84))
    # side booster pods (booster_L / booster_R are separate pivots: built in build_sidepod)
    return g


def build_sidepod(s):
    g = Geo()
    x = s * SIDEBOOST.x
    pod = K.shell([(6.62, x - 0.28, x + 0.28, 1.34, 2.2, 0.08), (7.5, x - 0.3, x + 0.3, 1.3, 2.26, 0.1)], 'Z', bevel=0.014,
                  mat='paint_primary')
    K.hatch_at(pod, (x + s * 0.3, 1.8, 7.06), (s, 0, 0), (0.4, 0.5), u_axis=(0, 1, 0), recess=0.035, mat='steel_dark')
    g.merge(pod)
    g.merge(P.box((0.2, 0.5, 0.2), bevel=0.012, segs=1, mat='steel_dark').move(s * (SIDEBOOST.x - 0.3), 1.8, 7.3))
    return g


# ============================================================================ legs (local frames)
def build_thigh_local():
    """Thigh authored vertical: hip at the origin, knee at (0, 0, -L_THIGH)."""
    g = Geo()
    L = L_THIGH
    g.merge(K.drum((0, 0, 0), (1, 0, 0), 0.44, 0.84, mat='paint_dark', hub=False))
    h = K.shell([(-0.26, -0.56, 0.56, -0.56, 0.5, 0.16), (-0.62, -0.62, 0.62, -0.7, 0.56, 0.2),
                 (-(L - 0.42), -0.52, 0.52, -0.6, 0.42, 0.16)], 'Z', bevel=0.016, mat='paint_primary')
    K.grooves(h, [(0, -1, 0), (1, 0, 0), (-1, 0, 0), (0, 1, 0)], (0, 0, -0.95), (0, 0, 1), gap=0.018, depth=0.016)
    armour = [K.plate_world([(-0.5, -0.72, -1.3), (0.5, -0.72, -1.3), (0.54, -0.74, -0.62), (0.0, -0.76, -0.4),
                             (-0.54, -0.74, -0.62)], 0.09, mat='paint_primary', normal_hint=(0, -1, 0), ridge=0.035,
                            ridge_axis='Y', chamfer=0.08, bolts=1, bolt_r=0.018, bolt_spacing=0.3),
              K.plate_world([(0.635, -0.5, -1.28), (0.635, 0.36, -1.28), (0.635, 0.42, -0.7), (0.635, -0.56, -0.7)],
                            0.06, mat='paint_secondary', normal_hint=(1, 0, 0), chamfer=0.06)]
    g.merge(h, *armour)
    g.merge(rivets((0.64, -0.5, -0.64), (0.64, 0.4, -0.64), 0.12, (1, 0, 0)))
    # yoke cheeks at the hip + two rams per hip (chrome rods, 24 segments)
    for cx, sg in ((-0.47, -1), (0.47, 1)):
        g.merge(K.cheek((cx, 0.0, 0.0), sg, 0.42, 0.08, strap_to=(0.0, -0.36), strap_w=0.5, bolts=6))
    g.merge(K.ram((0.66, 0.24, -0.16), (0.66, 0.08, -1.22), r=0.085, frac=0.5, segs=20, eyes=True, up=(1, 0, 0)))
    g.merge(K.ram((-0.34, 0.56, -0.2), (-0.34, 0.44, -1.2), r=0.075, frac=0.5, segs=20, eyes=False, up=(1, 0, 0)))
    g.merge(P.box((0.16, 0.26, 0.24), bevel=0.012, segs=1, mat='steel_dark').move(0.6, 0.12, -1.26))
    # knee clevis + drum + rear knee ram
    for cx, sg in ((-0.47, -1), (0.47, 1)):
        g.merge(K.cheek((cx, 0.0, -L), sg, 0.44, 0.09, strap_to=(0.08, -(L - 0.5)), strap_w=0.52, bolts=6))
    g.merge(K.drum((0, 0, -L), (1, 0, 0), 0.4, 0.84, mat='paint_dark', hub=False))
    g.merge(K.ram((0.0, 0.5, -0.5), (0.0, 0.38, -(L - 0.08)), r=0.08, frac=0.5, segs=20, eyes=False, up=(1, 0, 0)))
    g.merge(P.hose([(-0.5, 0.36, -0.3), (-0.62, 0.44, -0.8), (-0.54, 0.34, -1.3)], 0.035, 12, rib_amp=0.004,
                   rib_freq=28))
    return g


def build_shin_local():
    """Shin authored vertical: knee at the origin, ankle at (0, 0, -L_SHIN)."""
    g = Geo()
    L = L_SHIN
    # reverse-angle knee plate: projects ~0.6 m forward and up in front of the knee
    kp = P.prism([(-0.40, -0.46), (-0.64, -0.5), (-0.80, -0.12), (-1.0, 0.33), (-0.84, 0.40), (-0.62, 0.16),
                  (-0.48, -0.1)], 0.94, bevel=0.018, segs=1, mat='paint_secondary', axis='X')
    g.merge(kp)
    g.merge(K.plate_world([(-0.4, -0.84, -0.08), (0.4, -0.84, -0.08), (0.34, -1.0, 0.28), (-0.34, -1.0, 0.28)], 0.05,
                          mat='paint_primary', normal_hint=(0, -1, 0.4), chamfer=0.05, bolts=1, bolt_r=0.016,
                          bolt_spacing=0.2))
    h = K.shell([(-0.3, -0.55, 0.55, -0.56, 0.52, 0.16), (-0.9, -0.54, 0.54, -0.64, 0.58, 0.18),
                 (-(L - 0.45), -0.36, 0.36, -0.44, 0.36, 0.12)], 'Z', bevel=0.016, mat='paint_primary')
    K.grooves(h, [(1, 0, 0), (-1, 0, 0), (0, 1, 0)], (0, 0, -1.3), (0, 0, 1), gap=0.018, depth=0.016)
    armour = [K.plate_world([(-0.5, -0.69, -0.5), (0.5, -0.69, -0.5), (0.44, -0.62, -1.3), (0.0, -0.58, -1.46),
                             (-0.44, -0.62, -1.3)], 0.09, mat='paint_secondary', normal_hint=(0, -1, 0), chamfer=0.07,
                            bolts=1, bolt_r=0.019, bolt_spacing=0.28),
              K.plate_world([(-0.38, -0.52, -1.62), (0.38, -0.52, -1.62), (0.32, -0.47, -2.0), (-0.32, -0.47, -2.0)],
                            0.06, mat='paint_primary', normal_hint=(0, -1, 0), chamfer=0.05),
              K.plate_world([(0.555, -0.5, -0.5), (0.555, 0.46, -0.5), (0.48, 0.38, -1.6), (0.48, -0.44, -1.6)], 0.06,
                            mat='paint_primary', normal_hint=(1, 0, 0), chamfer=0.07, bolts=1, bolt_r=0.016,
                            bolt_spacing=0.3)]
    g.merge(h, *armour)
    g.merge(rivets((0.57, -0.52, -0.42), (0.57, 0.46, -0.42), 0.12, (1, 0, 0)))
    # calf: louvre stack + hydraulic reservoir
    lv = P.louvres(0.5, 0.62, count=5, depth=0.05, angle=24, thickness=0.018, mat='steel_dark', side_mat='paint_dark')
    g.merge(lv.rotate((-90, 0, 0)).move(0.0, 0.62, -0.62))
    g.merge(P.banded_cylinder([(0.04, 0.1, 'steel_dark'), (0.6, 0.12), (0.04, 0.1, 'steel_dark')], segs=24, step=0.0,
                              mat='paint_dark').move(-0.4, 0.5, -1.7))
    # ankle clevis + front / back ankle rams (lower eyes on the ankle cheeks: nothing detaches)
    for cx, sg in ((-0.42, -1), (0.42, 1)):
        g.merge(K.cheek((cx, 0.0, -L), sg, 0.34, 0.09, strap_to=(0.0, -(L - 0.5)), strap_w=0.42, bolts=6))
    g.merge(K.ram((0.0, -0.46, -1.52), (0.0, -0.26, -(L - 0.12)), r=0.07, frac=0.5, segs=20, eyes=True, up=(1, 0, 0)))
    g.merge(K.ram((0.0, 0.42, -1.5), (0.0, 0.26, -(L - 0.1)), r=0.07, frac=0.5, segs=20, eyes=False, up=(1, 0, 0)))
    return g


def build_foot():
    """Foot in world coordinates (L side): 2 m long pad, toe cap, heel plate, sole."""
    g = Geo()
    ax, ay, az = ANKLE
    g.merge(K.drum(ANKLE, (1, 0, 0), 0.3, 0.72, mat='paint_dark', hub=False))
    blk = P.frustum((0.8, 1.0), (0.6, 0.64), 0.4, bevel=0.018, segs=1, chamfer=0.06, mat='paint_dark')
    g.merge(blk.move(ax, ay + 0.05, 0.36))
    c = (0.05, 0.05, 0.16, 0.16)
    pad = K.shell([(ay + 0.72, ax - 0.46, ax + 0.46, 0.08, 0.36, c), (ay + 0.44, ax - 0.56, ax + 0.56, 0.08, 0.52, c),
                   (ay - 0.6, ax - 0.58, ax + 0.58, 0.08, 0.5, c), (ay - 0.86, ax - 0.54, ax + 0.54, 0.08, 0.4, c)],
                  'Y', bevel=0.016, mat='paint_primary')
    K.grooves(pad, [(0, 0, 1), (1, 0, 0), (-1, 0, 0)], (0, ay - 0.3, 0), (0, 1, 0), gap=0.018, depth=0.016)
    armour = [K.plate_at(pad, (ax, ay - 0.2, 0.52), (0, 0, 1), u_axis=(1, 0, 0), margin=0.06, thickness=0.05,
                         chamfer=0.06, mat='paint_primary', bolts=1, bolt_r=0.016, bolt_spacing=0.3),
              K.plate_world([(ax + 0.585, ay - 0.8, 0.12), (ax + 0.585, ay + 0.4, 0.12), (ax + 0.585, ay + 0.4, 0.46),
                             (ax + 0.585, ay - 0.8, 0.42)], 0.05, mat='paint_secondary', normal_hint=(1, 0, 0),
                            chamfer=0.06)]
    g.merge(pad, *[x for x in armour if x is not None])
    # toe cap (articulated look) + hazard plate
    toe = P.prism([(ay - 0.84, 0.06), (ay - 1.22, 0.03), (ay - 1.3, 0.14), (ay - 1.12, 0.34), (ay - 0.84, 0.44)], 1.1,
                  bevel=0.018, segs=1, mat='paint_secondary', axis='X')
    g.merge(toe.move(ax, 0, 0))
    g.merge(P.cylinder(0.05, 1.0, 16, bevel=0.006, bsegs=1, mat='steel').rotate((0, 90, 0)).move(ax, ay - 0.84, 0.3))
    # heel plate + spur, sole with grooves, marker on the heel
    heel = P.prism([(ay + 0.66, 0.05), (ay + 0.98, 0.08), (ay + 0.96, 0.42), (ay + 0.7, 0.6)], 0.78, bevel=0.016,
                   segs=1, mat='paint_primary', axis='X')
    g.merge(heel.move(ax, 0, 0))
    sole = K.shell([(ay - 1.24, ax - 0.56, ax + 0.56, 0.0, 0.1, 0.03), (ay + 0.98, ax - 0.5, ax + 0.5, 0.0, 0.1, 0.03)],
                   'Y', bevel=0.01, mat='steel_dark')
    for y in (-0.9, -0.46, -0.02, 0.42):
        K.grooves(sole, [(1, 0, 0), (-1, 0, 0), (0, 0, -1)], (0, ay + y, 0), (0, 1, 0), gap=0.05, depth=0.04)
    g.merge(sole)
    g.merge(marker((ax + 0.3, ay + 0.98, 0.32), (0, 1, 0.1), 'amber', 0.045))
    g.merge(K.shackle(0.06, bar=0.016).move(ax - 0.3, ay + 0.6, 0.5))
    return g


# ============================================================================ assembly
def build(a):
    a.pivot('pelvis', PELVIS)
    a.pivot('torso', TORSO, parent='pelvis')
    a.pivot('head', HEAD, parent='torso')
    a.pivot('eye', EYE, parent='head', iw_eye_color='#8FF0FF', iw_eye_strength=5.0)
    fa = forearm_frame()
    wrist_w = fa @ V((0, -L_FARM, 0))
    for S, m in (('L', lambda p: V(p)), ('R', mx)):
        a.pivot('thigh_' + S, m(HIP), parent='pelvis')
        a.pivot('shin_' + S, m(KNEE), parent='thigh_' + S)
        a.pivot('foot_' + S, m(ANKLE), parent='shin_' + S)
        a.pivot('arm_' + S, m(SHOULDER), parent='torso', iw_ready=round(math.radians(FA_PITCH), 3))
        a.pivot('forearm_' + S, m(ELBOW), parent='arm_' + S)
        a.pivot('hand_' + S, m(wrist_w), parent='forearm_' + S)
        a.pivot('booster_' + S, m(SIDEBOOST), parent='torso')
    a.pivot('shoulder_L', MISSILE_MOUNT, parent='torso')
    a.pivot('shoulder_R', CANNON_MOUNT, parent='torso')
    rm = rifle_matrix()
    a.pivot('weapon_R', mx(rm @ V((0, 0, 0))), parent='hand_R')
    a.pivot('weapon_L', fa @ (V((0.68, -2.3, 0.0))), parent='hand_L')
    a.pivot('booster_back', BOOSTER, parent='torso')
    rot = Matrix.Rotation(math.radians(FA_PITCH), 4, 'X').to_3x3()
    fire = rot @ V((0, -1, 0))
    a.muzzle('muzzle_R', mx(rm @ RIFLE_MUZZLE_LOCAL), fire=tuple(fire), parent='weapon_R')
    a.muzzle('muzzle_L', fa @ BLADE_MUZZLE_LOCAL, fire=tuple(fire), parent='weapon_L')
    a.muzzle('muzzle_LB', (MISSILE_MOUNT.x, -1.1, 9.6), fire=(0, -1, 0), parent='shoulder_L')
    crot = Matrix.Rotation(math.radians(CANNON_ELEV), 4, 'X').to_3x3()
    a.muzzle('muzzle_RB', cannon_pt((0, -3.95, 0.3)), fire=tuple(crot @ V((0, -1, 0))), parent='shoulder_R')

    tris = {}

    def put(name, g, parent, sharp=28.0):
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
        put('booster_back_geo', build_backpack(), 'booster_back')
        for s, S in ((1, 'L'), (-1, 'R')):
            put(f'booster_{S}_geo', build_sidepod(s), f'booster_{S}')
        # right hand rifle: authored for the L arm frame, mirrored with the arm
        rifle = build_rifle_local()
        rifle.transform(rm)
        rifle.mirror('X')
        put('weapon_R_geo', rifle, 'weapon_R')
        blade = build_blade_local()
        blade.transform(fa)
        put('weapon_L_geo', blade, 'weapon_L')
        put('shoulder_L_geo', build_missile(), 'shoulder_L')
        put('shoulder_R_geo', build_cannon(), 'shoulder_R')
        th, sh, ft = build_thigh_local(), build_shin_local(), build_foot()
        th.transform(seg_frame(HIP, KNEE))
        sh.transform(seg_frame(KNEE, ANKLE))
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
            f = build_forearm_local(S == 'L')
            f.transform(fa)
            hnd = build_hand_local()
            hnd.transform(fa)
            if S == 'R':
                f.mirror('X')
                hnd.mirror('X')
            put(f'forearm_{S}_geo', f, f'forearm_{S}')
            put(f'hand_{S}_geo', hnd, f'hand_{S}')
        th.free()
        sh.free()
        ft.free()
        # thrusters: 2 big + 2 small main bells, side pods, shoulder verniers, brakes, calves
        for i, s in enumerate((1, -1)):
            S = 'L' if s > 0 else 'R'
            K.nozzle_part(a, f'nozzle_back_{i}', (s * 0.72, 2.96, 6.62), (s * 0.3, 1, -0.4), 'booster_back', 0.25, 0.44,
                          0.58, segs=48, ribs=2, collar=2)
            K.nozzle_part(a, f'nozzle_back_{i + 2}', (s * 1.3, 2.5, 6.46), (s * 0.55, 1, -0.3), 'booster_back', 0.13,
                          0.22, 0.32, segs=32, ribs=1, bolts=0)
            K.nozzle_part(a, f'nozzle_{S}_0', (s * (SIDEBOOST.x + 0.3), 1.78, 6.98), (s, 0.25, -0.15), f'booster_{S}',
                          0.15, 0.26, 0.3, segs=32, ribs=1, bolts=0)
            K.nozzle_part(a, f'nozzle_sh_{S}', (s * 3.46, 1.14, 8.3), (s * 0.7, 1.0, 0.0), f'arm_{S}', 0.11, 0.18, 0.22,
                          segs=24, ribs=0, bolts=0)
            K.nozzle_part(a, f'nozzle_front_{S}', (s * 1.26, -1.28, 7.34), (0, -1, -0.45), 'torso', 0.08, 0.14, 0.22,
                          segs=24, ribs=0, bolts=0)
            calf = seg_frame(m_leg(KNEE, s), m_leg(ANKLE, s)) @ V((0.0, 0.66, -1.2))
            ex = seg_frame(m_leg(KNEE, s), m_leg(ANKLE, s)).to_3x3() @ V((0, 0.45, -1.0))
            K.nozzle_part(a, f'nozzle_leg_{S}', tuple(calf), tuple(ex), f'shin_{S}', 0.12, 0.19, 0.26, segs=32,
                          ribs=0, bolts=0)
    return tris


def m_leg(p, s):
    return V(p) if s > 0 else mx(p)


# ============================================================================ decals
def soot_decals(a):
    """Baked into the albedo atlas: soot / heat scorch gradients around and below every
    exhaust and gun muzzle (0.6-1.0 m)."""
    for i, s in enumerate((1, -1)):
        a.decal(K.soot(256, 11 + i, elong=1.3), (s * 0.7, 2.46, 6.64), (0, 1, 0), size=(1.5, 1.6), depth=0.5, opacity=0.95)
        a.decal(K.soot(256, 21 + i), (s * 1.2, 2.3, 6.5), (s * 0.5, 1, 0), size=(0.9, 0.9), depth=0.35, opacity=0.85)
        a.decal(K.soot(256, 31 + i), (s * (SIDEBOOST.x + 0.3), 1.78, 6.98), (s, 0, 0), size=(0.9, 0.9), depth=0.4,
                opacity=0.85)
        a.decal(K.soot(256, 71 + i), (s * 3.4, 1.0, 8.3), (s * 0.7, 1, 0), size=(0.7, 0.7), depth=0.3, opacity=0.8)
        calf = seg_frame(m_leg(KNEE, s), m_leg(ANKLE, s)) @ V((0.0, 0.58, -1.2))
        a.decal(K.soot(256, 41 + i, elong=1.5), tuple(calf), (0, 1, 0), size=(0.8, 1.0), depth=0.4, opacity=0.85)
        a.decal(K.soot(256, 51 + i), (s * 1.26, -1.12, 7.36), (0, -1, -0.3), size=(0.6, 0.6), depth=0.3, opacity=0.7)
    a.decal(K.soot(256, 61), cannon_pt((0, -3.7, 0.3)), (0, 0, 1), up=(0, -1, 0), size=(0.7, 0.9), depth=0.4,
            opacity=0.75)


def cards(a):
    B, KK = D.BONE, D.BLACK
    card = R.card
    # chest: big '07' on the L bone plate, cockpit warning + serial on the R plate, load stencils
    p, n = facet(UPPER, 8.22, 0.52, 1, lift=0.1)
    card(a, D.text_decal('07', px=300, color=KK, worn=0.3, seed=11), p, n, size=(0.66, None), parent='torso')
    p, n = facet(UPPER, 8.34, 0.5, -1, lift=0.1)
    card(a, D.warning_label('CAUTION', '注意', ('COCKPIT HATCH', '搭乗口 開閉注意'), w=900, seed=12), p, n,
         size=(0.74, None), parent='torso')
    p, n = facet(UPPER, 8.02, 0.5, -1, lift=0.1)
    card(a, D.serial_plate(('RIG-07  IRONWAKE', 'HALVARD PIER 7  MAX 40t'), w=720, seed=13), p, n, size=(0.66, None),
         parent='torso')
    zf = front_y(UPPER, 8.2)
    card(a, D.text_decal(['PULL', '引'], px=160, color=B, worn=0.2, seed=14), (0, zf - 0.04, 8.22), (0, -1, 0),
         size=(0.22, None), parent='torso')
    for s in (1, -1):
        card(a, D.text_decal(['MAX 40t', '荷重注意'], px=180, color=B, worn=0.25, seed=15 + s), (s * 1.3, 0.4, 9.022),
             (0, 0, 1), up=(0, -1, 0), size=(0.46, None), parent='torso')
        hw, yf, yb, pr, c = sec_at(ABDO, 7.14)
        card(a, D.text_decal('INTAKE', px=140, color=B, worn=0.3, seed=17 + s), (s * (hw + 0.05), 0.0, 7.46), (s, 0, 0),
             size=(0.4, None), parent='torso')
    card(a, D.hazard_decal(768, 128, seed=19), (0, front_y(ABDO, 7.62) - 0.02, 7.6), (0, -1, -0.1), size=(0.8, None),
         parent='torso', density=380)
    # pauldrons: emblem on the L outer face, unit number on the R, lift/load stencils on top
    xo = PX[3] + 0.08
    card(a, D.emblem(1024, seed=20), (xo, 0.0, 8.24), (1, 0, 0), size=(0.86, 0.86), parent='arm_L', density=460)
    card(a, D.text_decal('07', px=300, color=B, worn=0.3, seed=21), (-xo, 0.0, 8.24), (-1, 0, 0), size=(0.7, None),
         parent='arm_R')
    tp = paul_pt(3, 2.72) * 0.5 + paul_pt(4, 2.72) * 0.5 + V((0, 0, 0.075))
    tn = (paul_pt(4, 2.72) - paul_pt(3, 2.72)).cross(paul_pt(3, 3.0) - paul_pt(3, 2.72)).normalized()
    if tn.z < 0:
        tn = -tn
    card(a, D.text_decal('IW', px=220, color=KK, worn=0.3, seed=22), mx(tp), mx(tn), up=(0, 1, 0), size=(0.34, None),
         parent='arm_R')
    card(a, D.text_decal(['MAX 40t'], px=160, color=KK, worn=0.3, seed=23), tp, tn, up=(0, 1, 0), size=(0.4, None),
         parent='arm_L')
    for s, S in ((1, 'L'), (-1, 'R')):
        card(a, D.hazard_decal(768, 110, seed=24 + s), (s * xo, 0.0, 7.62), (s, 0, 0), size=(1.2, None),
             parent='arm_' + S, density=360)
        card(a, D.serial_plate((f'ARM-{S}  RIG-07', 'HYD 35MPa  LOT 0417'), w=640, seed=26 + s), (s * 3.08, -0.68, 7.9),
             (0, -1, 0), size=(0.44, None), parent='arm_' + S)
    # legs: side letters, serial plates, knee numbers, CAUTION pinch warnings, hazard bands
    th_f = seg_frame(HIP, KNEE)
    sh_f = seg_frame(KNEE, ANKLE)
    rot_t, rot_s = th_f.to_3x3(), sh_f.to_3x3()
    for s, S in ((1, 'L'), (-1, 'R')):
        def T(M, p):
            q = M @ V(p)
            return q if s > 0 else mx(q)

        def N(Rm, n):
            q = Rm @ V(n)
            return q if s > 0 else mx(q)
        card(a, D.text_decal(S, px=260, color=KK, worn=0.3, seed=30 + s), T(th_f, (0.7, -0.08, -1.0)), N(rot_t, (1, 0, 0)),
             up=N(rot_t, (0, 0, 1)), size=(0.22, None), parent='thigh_' + S)
        card(a, D.serial_plate((f'RIG-07 LEG {S}', 'LOT 0417-C  HYD 35MPa'), w=640, seed=32 + s),
             T(sh_f, (0.625, -0.02, -1.0)), N(rot_s, (1, 0, 0.06)), up=N(rot_s, (0, 0, 1)), size=(0.44, None),
             parent='shin_' + S)
        card(a, D.text_decal(['CAUTION', '挟まれ注意'], px=240, color=KK, worn=0.22, seed=34 + s),
             T(sh_f, (0.0, -0.79, -0.98)), N(rot_s, (0, -1, -0.09)), up=N(rot_s, (0, 0, 1)), size=(0.56, None),
             parent='shin_' + S)
        card(a, D.hazard_decal(768, 128, seed=36 + s), T(sh_f, (0.0, -0.575, -1.82)), N(rot_s, (0, -1, -0.13)),
             up=N(rot_s, (0, 0, 1)), size=(0.6, None), parent='shin_' + S, density=380)
        card(a, D.text_decal('07', px=240, color=KK, worn=0.3, seed=38 + s), T(sh_f, (0.0, -0.93, 0.06)),
             N(rot_s, (0, -1, 0.42)), up=N(rot_s, (0, 0.42, 1)), size=(0.26, None), parent='shin_' + S)
        ax, ay, az = ANKLE
        card(a, D.hazard_decal(768, 160, seed=40 + s), m_leg((ax, ay - 1.12, 0.38), s), (0, -0.62, 0.78),
             up=(0, 0.78, 0.62), size=(0.8, None), parent='foot_' + S, density=360)
        card(a, D.text_decal(['NO STEP', '踏むな'], px=180, color=B, worn=0.3, seed=42 + s), m_leg((ax, ay + 0.2, 0.585), s),
             (0, 0, 1), up=(0, -1, 0), size=(0.44, None), parent='foot_' + S)
    # back: HOT plate, IRONWAKE stencil, arrows
    card(a, D.warning_label('HOT', '高温注意', ('EXHAUST ZONE', '排気口付近立入禁止'), w=900, seed=44),
         (-0.74, 2.515, 7.74), (0, 1, 0.12), size=(0.5, None), parent='booster_back')
    card(a, D.text_decal('IRONWAKE', px=200, color=B, worn=0.3, seed=45), (0.0, 2.2, 8.62), (0, 0.8, 0.6),
         size=(0.9, None), parent='booster_back')
    for s in (1, -1):
        card(a, D.text_decal(['BOOST', 'INTAKE'], px=140, color=B, worn=0.3, seed=46 + s), (s * 1.4, 1.72, 8.18),
             (s, 0, 0), size=(0.4, None), parent='booster_back')
    card(a, D.arrow_decal(text='LIFT', seed=48), (0.82, 1.62, 8.9), (0, 0, 1), up=(1, 0, 0), size=(0.34, None),
         parent='booster_back')
    # head
    card(a, D.text_decal('IW-07', px=160, color=B, worn=0.3, seed=49), V((HW + 0.06, -0.7, 9.22)) + HEAD_OFS, (1, 0, 0),
         size=(0.3, None), parent='head')
    card(a, D.text_decal('SENSOR', px=120, color=B, worn=0.2, seed=50), V((-HW - 0.06, -0.7, 9.22)) + HEAD_OFS, (-1, 0, 0),
         size=(0.3, None), parent='head')
    # weapons
    rm = rifle_matrix()
    rrot = rm.to_3x3().normalized()

    def rp(p):
        return mx(rm @ V(p))

    def rn(n):
        return mx(rrot @ V(n))
    card(a, D.text_decal(['RF-24', 'BRASSWORK'], px=160, color=B, worn=0.3, seed=51), rp((0.215, -0.75, 0.3)),
         rn((1, 0, 0)), up=rn((0, 0, 1)), size=(0.5, None), parent='weapon_R')
    card(a, D.hazard_decal(512, 96, seed=52), rp((0.215, -0.1, 0.48)), rn((1, 0, 0)), up=rn((0, 0, 1)),
         size=(0.4, None), parent='weapon_R', density=380)
    bx = MISSILE_MOUNT.x + 0.58 + 0.075
    card(a, D.text_decal(['ML-6', 'HAILSTORM'], px=180, color=KK, worn=0.3, seed=53), (bx, -0.1, 9.6), (1, 0, 0),
         size=(0.76, None), parent='shoulder_L')
    card(a, D.text_decal('DANGER 危険', px=120, color=D.YELLOW, worn=0.2, seed=54), (MISSILE_MOUNT.x, -1.14, 10.02),
         (0, -1, 0), size=(0.5, None), parent='shoulder_L')
    crot = Matrix.Rotation(math.radians(CANNON_ELEV), 4, 'X').to_3x3()
    card(a, D.text_decal(['HC-90', 'SLEDGE'], px=180, color=KK, worn=0.3, seed=55), cannon_pt((-0.45, 0.2, 0.2)),
         crot @ V((-1, 0, 0)), up=crot @ V((0, 0, 1)), size=(0.66, None), parent='shoulder_R')
    fa = forearm_frame()
    frot = fa.to_3x3()
    card(a, D.text_decal('PB-7', px=200, color=KK, worn=0.3, seed=56), fa @ V((0.89, -1.2, 0.0)), frot @ V((1, 0, 0)),
         up=frot @ V((0, 0, 1)), size=(0.3, None), parent='weapon_L')


def add_decals(a):
    soot_decals(a)
    cards(a)


# ============================================================================ main
# benchmark s5 palette, primary lifted + cooled so the slate survives the warm dusk grade
COLORS = {
    'paint_primary': {'color': '#535D67', 'rough': 0.52, 'metal': 0.3},
    'paint_secondary': {'color': '#C9C2B4', 'rough': 0.56, 'metal': 0.1, 'grime': 0.7, 'dust': 0.6},
    'paint_dark': {'color': '#30353A', 'rough': 0.5, 'metal': 0.35},
    'paint_accent': {'color': '#E8641E', 'rough': 0.48},
    'steel_dark': {'color': '#454A4E'},
    'chrome': {'color': '#D9DBDD', 'rough': 0.2},
    'marker_amber': dict(color='#1A1208', metal=0.0, rough=0.25, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                         emit='#FFB347', emit_strength=3.5, decals=False),
    'marker_cyan': dict(color='#081418', metal=0.0, rough=0.25, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                        emit='#8FF0FF', emit_strength=3.0, decals=False),
    'bell_heat': dict(color='#3A302A', metal=0.85, rough=0.38, wear=0.0, grime=0.5, rust=0.0, dust=0.0, var=0.06,
                      pattern='heat', decals=False),
}
OBJ_WEIGHT = {'head_geo': 2.0, 'eye_geo': 1.0, 'torso_geo': 1.5, 'weapon_R_geo': 1.1, 'arm_L_geo': 1.35,
              'arm_R_geo': 1.35, 'shoulder_L_geo': 1.1, 'shoulder_R_geo': 1.05, 'forearm_L_geo': 1.1,
              'forearm_R_geo': 1.1, 'weapon_L_geo': 1.0, 'hand_L_geo': 0.75, 'hand_R_geo': 0.75,
              'booster_back_geo': 1.0, 'thigh_L_geo': 1.0, 'thigh_R_geo': 1.0, 'shin_L_geo': 1.2, 'shin_R_geo': 1.2,
              'foot_L_geo': 0.8, 'foot_R_geo': 0.8, 'pelvis_geo': 0.75}
SET_B = ('pelvis', 'thigh', 'shin', 'foot', 'booster', 'nozzle')


def set_of(name):
    return 'B' if name.split('_')[0] in SET_B else 'A'


VIEWS = {
    'hero': dict(azimuth=-36, elevation=6, lens=45, distance=27, target=(0, -0.5, 5.2)),
    'front': dict(azimuth=0, elevation=6, lens=50, distance=25, target=(0, 0, 5.1)),
    'back': dict(azimuth=160, elevation=14, lens=50, distance=25, target=(0, 0.5, 5.3)),
    'close': dict(azimuth=-30, elevation=10, lens=70, distance=11, target=(0.3, -0.9, 8.4)),
}
CLAY = {
    'front': dict(azimuth=0, elevation=6, lens=50, distance=26, target=(0, 0, 5.1)),
    'hero': dict(azimuth=-36, elevation=6, lens=45, distance=27, target=(0, -0.5, 5.1)),
    'side': dict(azimuth=-90, elevation=4, lens=50, distance=27, target=(0, -0.6, 5.1)),
    'back': dict(azimuth=160, elevation=14, lens=50, distance=26, target=(0, 0.5, 5.3)),
    'back34': dict(azimuth=135, elevation=24, lens=50, distance=27, target=(0, 0.3, 5.3)),
    'close': dict(azimuth=-28, elevation=10, lens=70, fill=2.4, target=(0.0, -0.6, 8.6)),
}
POSE_VIEW = dict(azimuth=-58, elevation=10, lens=45, distance=27, target=(0, -0.3, 4.9))
POSES = {'crouch': POSE_VIEW, 'walk': POSE_VIEW, 'boost': POSE_VIEW, 'aim_up': POSE_VIEW, 'twist': POSE_VIEW,
         'lunge': POSE_VIEW}

WEATHER = iw.Weathering(edge_wear=1.45, grime=1.0, streaks=1.3, rust=0.55, dust=0.35, chip_threshold=0.52,
                        flat_chips=0.5, macro=0.09, ground_dirt=0.45, ao_in_albedo=0.0, rough_breakup=0.18,
                        edge_lo=0.08, edge_hi=0.36, bare_dark=(0.17, 0.175, 0.18), bare_light=(0.29, 0.30, 0.31))
TEX_SIZES = {'A': {'basecolor': 2048, 'orm': 2048, 'normal': 2048, 'emissive': 512},
             'B': {'basecolor': 2048, 'orm': 1024, 'normal': 1024, 'emissive': 512}}


def main():
    R.run(NAME, build, add_decals, set_of, scheme='player', colors=COLORS, seed=7, obj_weight=OBJ_WEIGHT,
          weathering=WEATHER, views=VIEWS, clay=CLAY, tex_sizes=TEX_SIZES, poses=POSES)


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
