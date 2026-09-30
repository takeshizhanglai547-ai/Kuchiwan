"""PK-2 "PICKET" - Grauwerk Consolidated Security sentry walker MT (owner: enemy modeler).

A ~5 m unmanned sentry walker built like foundry yard machinery: a boxy armoured
operator-style cab on a slewing ring (horizontal red sensor slit + 2 round lenses under a
heavy brow, amber work-lamp bar on the roof, engine pack with twin exhaust stacks at the
back), a 40 mm autocannon on a trunnion pylon on the RIGHT shoulder, a smoke-discharger
block + whip antenna on the LEFT, and stubby forward-knee legs with exposed hydraulic
rams on big outrigger-style foot pads.

    python3 blender/enemies/build_mt.py --blockout [--views a,b]    clay renders only
    python3 blender/enemies/build_mt.py [--quick]                    bake + GLB (+ FBX)

Node contract (src/enemies/models.js, extended with legs for the walk cycle):
    root > hull > pelvis > {pelvis_geo,
                            turret > {turret_geo, eye > eye_geo, barrel > {barrel_geo, muzzle}},
                            thigh_L > shin_L > foot_L,  thigh_R > shin_R > foot_R}
Blender coords: +Z up, the unit faces -Y, so its RIGHT is -X. Feet on z = 0.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ekit as K  # noqa: E402
from ekit import D, Geo, P, iw  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

NAME = 'enemy_mt'
K.BOLT_SPACING = 2.1   # fewer, heavier bolts (triangle budget; the baked bevel carries the rest)

# ============================================================================ skeleton (L side = +X)
PELVIS = (0.0, 0.05, 2.15)
TURRET = (0.0, 0.0, 2.7)          # slewing-ring centre (turret yaw pivot)
HIP = (1.16, 0.05, 2.15)
KNEE = (1.30, -0.54, 1.32)
ANKLE = (1.40, 0.05, 0.52)
TRUNNION = (-1.78, -0.30, 3.72)   # autocannon pitch pivot (RIGHT shoulder = -X)
MUZZLE = (-1.78, -3.22, 3.72)
EYE = (0.0, -1.46, 3.45)

# cab: armoured wedge lofted along Y (front = -y). (y, x0, x1, z0, z1, corner chamfers
# (bottom-left, bottom-right, top-right, top-left) in the x/z section)
CAB_HW = 1.34
CAB = [(-1.50, -0.86, 0.86, 3.26, 3.58, (0.06, 0.06, 0.08, 0.08)),
       (-1.26, -1.08, 1.08, 3.0, 3.72, (0.14, 0.14, 0.16, 0.16)),
       (-0.24, -CAB_HW, CAB_HW, 2.78, 4.32, (0.2, 0.2, 0.3, 0.3)),
       (0.92, -CAB_HW, CAB_HW, 2.78, 4.32, (0.2, 0.2, 0.3, 0.3)),
       (1.22, -1.22, 1.22, 2.88, 4.18, (0.14, 0.14, 0.2, 0.2))]


def mx(p):
    return (-p[0], p[1], p[2])


def cab_section(y):
    """Interpolated (x0, x1, z0, z1) of the cab loft at y."""
    for i in range(len(CAB) - 1):
        a, b = CAB[i], CAB[i + 1]
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, 5))
    return CAB[-1][1:5]


def glacis_point(x, t, lift=0.0):
    """Point on the upper glacis (t = 0 at the nose top edge .. 1 at the roof edge)."""
    y0, y1 = -1.26, -0.24
    y = y0 + (y1 - y0) * t
    z = cab_section(y)[3]
    n = Vector((0, -(4.32 - 3.72), (y1 - y0))).normalized()
    return Vector((x, y, z)) + n * lift, n


def build_cab():
    B = K.Budget('cab')
    g = Geo()
    cab = K.shell([(y, x0, x1, z0, z1, c) for (y, x0, x1, z0, z1, c) in CAB], 'Y', bevel=0.022, mat='paint_primary')
    # long-range signature: a dirty-cream upper cap (roof + top chamfers) over the oxide body
    cab.bm.normal_update()
    cream = cab.mi('paint_secondary')
    for f in cab.bm.faces:
        if f.normal.z > 0.55 and f.calc_center_median().y < 1.1:
            f.material_index = cream
    # panel seams across the roof + sides, one belt seam on the sides
    for y in (0.3,):
        K.grooves(cab, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, y, 0), (0, 1, 0), gap=0.018, depth=0.016, angle=20)
    K.grooves(cab, [(1, 0, 0), (-1, 0, 0)], (0, 0, 3.14), (0, 0, 1), gap=0.018, depth=0.016, angle=20)
    # nose: deep recessed sensor bay (the red slit lives in the `eye` node)
    K.hatch_at(cab, (0, -1.50, 3.42), (0, -1, 0), (1.5, 0.26), u_axis=(1, 0, 0), gap=0.01, recess=0.1,
               mat='steel_dark')
    # roof access hatch (raised) + recessed engine-bay grille
    K.hatch_at(cab, (0.42, 0.45, 4.32), (0, 0, 1), (0.8, 0.62), u_axis=(1, 0, 0), gap=0.014, raised=0.03,
               mat='paint_primary')
    K.hatch_at(cab, (-0.45, 0.62, 4.32), (0, 0, 1), (0.8, 0.46), u_axis=(1, 0, 0), gap=0.012, recess=0.05,
               mat='steel_dark')
    B.add('shell', cab)
    g.merge(B.add('grille', P.grille(0.74, 0.4, bars=5, bar_r=0.013, frame=0.02, depth=0.03, mat='steel_dark')
                  .move(-0.45, 0.62, 4.28)))
    armour = []
    # glacis: big cream plate with a centre ridge (the value focal point at range)
    ga, n = glacis_point(-0.78, 0.1, 0.004)
    gb, _ = glacis_point(0.78, 0.1, 0.004)
    gc, _ = glacis_point(0.98, 0.92, 0.004)
    gd, _ = glacis_point(-0.98, 0.92, 0.004)
    armour.append(K.plate_world([ga, gb, gc, gd], 0.07, mat='paint_secondary', normal_hint=n, chamfer=0.1, ridge=0.04,
                                ridge_axis='Y', bolts=1, bolt_r=0.022, bolt_spacing=0.42))
    # chin plate (dark) under the nose
    armour.append(K.plate_world([(-0.82, -1.47, 3.24), (0.82, -1.47, 3.24), (0.98, -1.2, 2.98), (-0.98, -1.2, 2.98)],
                                0.05, mat='paint_secondary', normal_hint=(0, -1, -1), chamfer=0.06, bolts=1,
                                bolt_r=0.018, bolt_spacing=0.42))
    # side armour: cream front skirts that hang below the cab over the slewing ring, oxide rear panels
    for s in (1, -1):
        x = s * (CAB_HW + 0.004)
        pts = [(x, -0.2, 2.6), (x, 0.62, 2.6), (x, 0.62, 3.95), (x, -0.08, 4.02), (x, -0.36, 3.72)]
        if s < 0:
            pts = list(reversed(pts))
        armour.append(K.plate_world(pts, 0.07, mat='paint_secondary', normal_hint=(s, 0, 0), chamfer=0.08,
                                    bolts=1, bolt_r=0.02, bolt_spacing=0.42))
        pts = [(x, 0.72, 2.84), (x, 1.12, 2.92), (x, 1.12, 4.0), (x, 0.72, 4.02)]
        if s < 0:
            pts = list(reversed(pts))
        armour.append(K.plate_world(pts, 0.05, mat='paint_primary', normal_hint=(s, 0, 0), chamfer=0.06))
        # front cheek wedge (sloped armour on the nose corners)
        armour.append(K.plate_world([(s * 1.1, -1.24, 3.06), (s * 1.1, -1.24, 3.66), (s * 1.34, -0.3, 4.1),
                                     (s * 1.34, -0.3, 2.86)][::(1 if s > 0 else -1)], 0.05, mat='paint_primary',
                                    normal_hint=(s, -0.4, 0), chamfer=0.05))
    for pl in armour:
        g.merge(B.add('armour', pl))
    g.merge(cab)
    # brow visor: overhanging armour lip above the sensor slit (deep shadow line)
    brow = P.prism([(-1.72, 3.6), (-1.2, 3.62), (-1.1, 3.8), (-1.3, 3.8), (-1.7, 3.66)], 2.0, bevel=0.014, segs=1,
                   mat='paint_secondary', axis='X')
    g.merge(B.add('brow', brow))
    g.merge(B.add('brow', P.box((2.02, 0.05, 0.04), bevel=0.006, segs=1, mat='paint_accent').move(0, -1.71, 3.61)))
    for s in (1, -1):   # visor side blinkers
        g.merge(B.add('brow', P.prism([(-1.7, 3.3), (-1.36, 3.18), (-1.3, 3.62), (-1.7, 3.64)], 0.1, bevel=0.01, segs=1,
                                      mat='paint_dark', axis='X').move(s * 0.95, 0, 0)))
    # Grauwerk ID band: 0.35 m yellow belt on the rear side panels and around the engine pack
    for s in (1, -1):
        g.merge(B.add('stripe', K.strip((s * (CAB_HW + 0.055), 0.72, 3.62), (s * (CAB_HW + 0.055), 1.12, 3.62), 0.35,
                                        0.012, (s, 0, 0), mat='paint_accent')))
        g.merge(B.add('stripe', K.strip((s * 1.105, 1.2, 3.62), (s * 1.105, 1.72, 3.62), 0.35, 0.012, (s, 0, 0),
                                        mat='paint_accent')))
        # diagonal stripe along the sloped nose-corner wedges
        g.merge(B.add('stripe', K.strip((s * 1.19, -0.9, 3.28), (s * 1.3, -0.45, 3.6), 0.16, 0.012,
                                        (s, -0.42, 0), mat='paint_accent')))
    g.merge(B.add('stripe', K.strip((-1.0, 1.775, 3.95), (0.45, 1.775, 3.95), 0.2, 0.012, (0, 1, 0),
                                    mat='paint_accent')))
    # upper slewing-ring half (turns with the cab)
    g.merge(B.add('ring', P.banded_cylinder([(0.05, 0.98, 'steel_dark'), (0.07, 1.04, 'paint_dark')], segs=40,
                                            step=0.0).move(0, 0, 2.66)))
    g.merge(B.add('ring', P.bolt_circle((0, 0, 2.78), (0, 0, 1), 1.0, 8, r=0.024)))
    # --- roof: lamp bar with two amber work lamps + a red strobe dome
    for x in (-0.95, 0.95):
        g.merge(B.add('lamps', P.box((0.1, 0.1, 0.24), bevel=0.01, segs=1, mat='steel_dark').move(x, -0.1, 4.44)))
    g.merge(B.add('lamps', P.cylinder(0.05, 2.1, 16, bevel=0.006, bsegs=1, mat='steel_dark').rotate((0, 90, 0))
                  .move(0, -0.1, 4.58)))
    for x in (-0.58, 0.58):
        lamp = P.box((0.34, 0.2, 0.2), bevel=0.02, segs=1, chamfer=0.03, chamfer_axes='Y', mat='paint_dark')
        g.merge(B.add('lamps', lamp.move(x, -0.16, 4.62)))
        g.merge(B.add('lamps', P.cylinder(0.072, 0.02, 14, bevel=0.0, mat='glow', z0=0.0)
                      .align((0, -1, 0), loc=(x, -0.25, 4.62))))
        g.merge(B.add('lamps', P.box((0.3, 0.02, 0.018), bevel=0.004, segs=1, mat='steel_dark').move(x, -0.3, 4.62)))
    g.merge(B.add('mast', P.box((0.26, 0.26, 0.05), bevel=0.01, segs=1, mat='steel_dark').move(0.9, 0.95, 4.345)))
    g.merge(B.add('mast', P.cylinder(0.035, 0.86, 12, bevel=0.006, bsegs=1, mat='steel', z0=4.36).move(0.9, 0.95, 0)))
    g.merge(B.add('mast', P.cylinder(0.075, 0.06, 16, bevel=0.008, bsegs=1, mat='steel_dark', z0=5.2).move(0.9, 0.95, 0)))
    g.merge(B.add('mast', K.tube([(0.9, 0.95, 4.9), (0.97, 1.02, 4.62), (1.02, 1.08, 4.36)], 0.016, 6,
                                 mat='rubber', collars=False, subdiv=2)))
    g.merge(B.add('antenna', K.whip(1.4, r=0.01, base_r=0.04).move(-0.2, 1.05, 4.2)))
    # roof grab rail + lifting eyes
    g.merge(B.add('rail', P.pipe_run([(-0.95, 0.28, 4.32), (-0.95, 0.28, 4.46), (-0.95, 0.98, 4.46),
                                      (-0.95, 0.98, 4.32)], 0.025, bend=0.06, segs=8, mat='hazard', flanges=False)))
    # --- engine pack on the back: louvred radiator box + twin exhaust stacks with rain caps
    pack = P.box((2.2, 0.62, 1.24), bevel=0.02, segs=1, chamfer=0.08, chamfer_axes='Z', mat='paint_primary')
    pack.move(0, 1.46, 3.46)
    K.grooves(pack, [(0, 1, 0), (0, 0, 1)], (0.45, 0, 0), (1, 0, 0), gap=0.016, depth=0.014)
    g.merge(B.add('pack', pack))
    lv = P.louvres(1.3, 0.8, count=5, depth=0.05, angle=26, thickness=0.02, mat='steel_dark', side_mat='paint_dark')
    lv.rotate((90, 0, 0)).rotate((0, 0, 180)).move(-0.25, 1.78, 3.44)
    g.merge(B.add('pack', lv))
    g.merge(B.add('pack', P.box((1.4, 0.03, 0.9), bevel=0.005, segs=1, mat='steel_dark').move(-0.25, 1.775, 3.44)))
    for x in (0.62, 0.92):
        st = P.banded_cylinder([(0.12, 0.14, 'steel_dark'), (0.78, 0.115), (0.06, 0.13, 'steel_dark'), (0.18, 0.115)],
                               segs=16, step=0.0, mat='steel')
        g.merge(B.add('stacks', st.move(x, 1.6, 3.9)))
        cap = P.box((0.28, 0.22, 0.03), bevel=0.006, segs=1, mat='steel_dark').rotate((-28, 0, 0))
        g.merge(B.add('stacks', cap.move(x, 1.65, 5.08)))
    g.merge(B.add('stacks', P.box((0.6, 0.34, 0.1), bevel=0.01, segs=1, mat='steel_dark').move(0.77, 1.6, 3.95)))
    # ammo magazine on the back-right (feed chute is on the gun)
    mag = P.box((0.5, 0.6, 0.7), bevel=0.018, segs=1, chamfer=0.05, chamfer_axes='Y', mat='paint_dark')
    g.merge(B.add('mag', mag.move(-1.12, 1.46, 3.68)))
    g.merge(B.add('mag', P.bolt_row((-1.37, 1.25, 3.95), (-1.37, 1.68, 3.95), 3, (-1, 0, 0), r=0.018)))
    # rear step rungs up the left of the engine pack (service scale)
    for z in (3.45,):
        g.merge(B.add('rungs', K.rung((1.1, 1.26, z), (1.1, 1.62, z), 0.08, (1, 0, 0), r=0.018)))
    # --- RIGHT shoulder: gun pylon + trunnion yoke (the gun itself is the barrel node)
    tx, ty, tz = TRUNNION
    pyl = P.box((0.3, 0.9, 0.5), bevel=0.02, segs=1, chamfer=0.06, chamfer_axes='X', mat='paint_primary')
    g.merge(B.add('pylon', pyl.move(-1.48, ty + 0.05, tz)))
    g.merge(B.add('pylon', K.drum((-1.58, ty, tz), (1, 0, 0), 0.26, 0.16, mat='paint_dark', hub=False, segs=20,
                                  profile='ring')))
    g.merge(B.add('pylon', K.ram((-1.52, ty + 0.46, tz - 0.62), (-1.52, ty + 0.1, tz - 0.2), r=0.05, frac=0.55,
                                 segs=12)))
    g.merge(B.add('pylon', P.box((0.22, 0.3, 0.2), bevel=0.012, segs=1, mat='steel_dark')
                  .move(-1.45, ty + 0.5, tz - 0.66)))
    # --- LEFT shoulder: smoke-discharger block (2 x 3 tubes, angled forward-up)
    sd = Geo()
    sd.merge(P.box((0.5, 0.56, 0.42), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Y', mat='paint_primary'))
    for i in range(2):
        for j in range(2):
            t = P.ring(0.075, 0.058, 0.24, 12, bevel=0.0, bsegs=1, mat='steel_dark', z0=0.0)
            sd.merge(t.align((0, -1, 0.4), loc=(-0.09 + i * 0.18, -0.26, -0.08 + j * 0.16)))
    sd.rotate((12, 0, 0)).move(1.64, -0.1, 3.74)
    g.merge(B.add('smoke', sd))
    g.merge(B.add('smoke', P.box((0.34, 0.5, 0.18), bevel=0.015, segs=1, mat='steel_dark').move(1.45, -0.05, 3.5)))
    # conduit along each upper cab side (front sensor pods -> engine pack) with clamps
    for s in (1, -1):
        x = s * (CAB_HW + 0.07)
        g.merge(B.add('conduit', K.tube([(s * 1.1, -1.0, 3.9), (x, -0.3, 4.16), (x, 0.7, 4.16), (s * 1.2, 1.2, 4.05)],
                                        0.035, 8, mat='steel', collar_mat='steel_dark', subdiv=2)))
        for y in (-0.1, 0.35):
            g.merge(B.add('conduit', P.box((0.06, 0.08, 0.1), bevel=0.01, segs=1, mat='steel_dark')
                          .move(x - s * 0.02, y, 4.16)))
    # tool box on the left rear flank
    tb = P.box((0.22, 0.5, 0.34), bevel=0.015, segs=1, chamfer=0.03, chamfer_axes='X', mat='paint_dark')
    g.merge(B.add('toolbox', tb.move(CAB_HW + 0.16, 0.9, 3.2)))
    B.report()
    return g


def build_eye():
    """Sensor array: a slim red slit over THREE round lenses (hooded bezel, black glass, small
    hot iris) deep under the brow, plus two round lenses in armoured pods on the upper glacis
    corners. The irises are the brightest point of the silhouette (iw_eye_strength)."""
    g = Geo()
    y = -1.50 + 0.1
    g.merge(P.box((1.36, 0.03, 0.035), bevel=0.006, segs=1, mat='lens').move(0, y - 0.02, 3.515))
    g.merge(P.box((1.46, 0.03, 0.24), bevel=0.006, segs=1, mat='steel_dark').move(0, y - 0.004, 3.42))

    def lens(r, loc, tilt=(0, 0, 0)):
        c = Geo()
        c.merge(P.ring(r * 1.32, r * 0.98, r * 0.7, 14, bevel=0.0, bsegs=1, mat='steel', z0=0.0))
        c.merge(P.dome(r, r * 0.42, 16, 2, mat='glass', base=False))
        c.merge(P.dome(r * 0.36, r * 0.16, 12, 1, mat='lens', base=False).move(0, 0, r * 0.38))
        c.rotate((90, 0, 0)).rotate(tilt).move(*loc)
        return c
    for x in (-0.3, 0.0, 0.3):
        g.merge(lens(0.068, (x, y - 0.03, 3.4)))
    for x, r in ((-0.86, 0.085), (0.9, 0.06)):
        p, n = glacis_point(x, 0.62, 0.0)
        pod = P.box((r * 3.4, r * 2.6, r * 2.8), bevel=0.012, segs=1, chamfer=r * 0.5, chamfer_axes='Y',
                    mat='paint_dark').move(0, r * 0.9, 0)
        hood = P.box((r * 3.2, r * 1.6, 0.02), bevel=0.004, segs=1, mat='paint_dark').move(0, -r * 0.3, r * 1.45)
        comp = Geo()
        comp.merge(pod, hood, lens(r, (0, -r * 0.4, 0)))
        comp.rotate((-8, 0, 0)).move(p.x, p.y + 0.02, p.z + r * 1.2)
        g.merge(comp)
    return g


def build_beacon():
    """Mast-top strobe (blinks red at 0.6 Hz: long-range readability from every side)."""
    g = Geo()
    g.merge(P.dome(0.1, 0.15, 16, 3, mat='lens').move(0.9, 0.95, 5.26))
    for k in range(3):   # wire guard
        g.merge(P.box((0.012, 0.012, 0.19), bevel=0.0, segs=1, mat='steel_dark')
                .move(0.9 + 0.115 * math.cos(k * 2.1), 0.95 + 0.115 * math.sin(k * 2.1), 5.35))
    g.merge(P.ring(0.125, 0.105, 0.015, 20, bevel=0.0, bsegs=1, mat='steel_dark', z0=5.44).move(0.9, 0.95, 0))
    return g


# ============================================================================ autocannon (barrel node)
def build_gun():
    B = K.Budget('gun')
    g = Geo()
    tx, ty, tz = TRUNNION
    # receiver: angular side profile (y, z) extruded across X
    rec = P.prism([(0.66, -0.26), (0.66, 0.2), (0.44, 0.34), (-0.98, 0.34), (-1.14, 0.14), (-1.14, -0.22),
                   (-0.56, -0.34), (0.32, -0.34)], 0.54, bevel=0.02, segs=1, mat='paint_primary', axis='X')
    rec.move(tx - 0.04, ty, tz)
    for y in (ty - 0.38, ty + 0.26):
        K.grooves(rec, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, y, 0), (0, 1, 0), gap=0.014, depth=0.012)
    K.hatch_at(rec, (tx - 0.31, ty - 0.1, tz + 0.02), (-1, 0, 0), (0.62, 0.3), u_axis=(0, 1, 0), gap=0.012,
               recess=0.035, mat='steel_dark')
    g.merge(B.add('receiver', rec))
    g.merge(B.add('plates', K.plate_at(rec, (tx + 0.23, ty - 0.2, tz), (1, 0, 0), u_axis=(0, -1, 0), margin=0.05,
                                       thickness=0.04, chamfer=0.06, mat='paint_secondary', bolts=1, bolt_r=0.016,
                                       bolt_spacing=0.3)))
    top = K.plate_at(rec, (tx, ty - 0.3, tz + 0.34), (0, 0, 1), u_axis=(0, -1, 0), margin=0.05, thickness=0.04,
                     chamfer=0.06, mat='paint_primary', ridge=0.022, ridge_axis='Y')
    if top is not None:
        g.merge(B.add('plates', top))
    # trunnion pin boss (inner side, into the pylon drum)
    g.merge(B.add('pin', P.cylinder(0.12, 0.2, 16, bevel=0.0, bsegs=1, mat='steel').rotate((0, 90, 0))
                  .move(tx + 0.33, ty, tz)))
    # barrel jacket with cooling rings, barrel, hazard band, slotted muzzle brake
    y0 = ty - 1.16
    g.merge(B.add('jacket', P.cylinder(0.17, 0.92, 32, bevel=0.016, bsegs=1, mat='steel_dark', z0=0.0)
                  .align((0, -1, 0), loc=(tx, y0 + 0.04, tz))))
    for k in range(2):
        g.merge(B.add('jacket', P.ring(0.19, 0.16, 0.06, 32, bevel=0.0, bsegs=1, mat='steel', z0=0.0)
                      .align((0, -1, 0), loc=(tx, y0 - 0.12 - k * 0.2, tz))))
    g.merge(B.add('jacket', P.ring(0.195, 0.16, 0.13, 32, bevel=0.0, bsegs=1, mat='hazard', z0=0.0)
                  .align((0, -1, 0), loc=(tx, y0 + 0.02, tz))))
    b0 = y0 - 0.86
    g.merge(B.add('barrel', P.cylinder(0.1, 1.04, 32, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                  .align((0, -1, 0), loc=(tx, b0, tz))))
    g.merge(B.add('barrel', P.ring(0.125, 0.09, 0.08, 32, bevel=0.006, bsegs=1, mat='steel', z0=0.0)
                  .align((0, -1, 0), loc=(tx, b0 - 0.3, tz))))
    mb = P.box((0.32, 0.4, 0.27), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Y', mat='steel_dark')
    mb.move(tx, b0 - 1.2, tz)
    for k in range(3):
        mb.boolean(P.box((0.6, 0.06, 0.12), bevel=0.0, segs=1, mat='steel').move(tx, b0 - 1.09 - k * 0.1, tz))
    mb.boolean(P.cylinder(0.068, 0.6, 24, bevel=0.0, mat='steel_dark').align((0, -1, 0), loc=(tx, b0 - 0.95, tz)))
    g.merge(B.add('brake', mb))
    # belt feed chute from the magazine (back) into the receiver, coolant line along the jacket
    g.merge(B.add('chute', K.tube([(tx + 0.14, ty + 0.66, tz + 0.04), (tx + 0.3, ty + 0.95, tz + 0.06),
                                   (tx + 0.66, ty + 1.32, tz + 0.0)], 0.08, 8, mat='paint_dark', collar_mat='steel_dark',
                                  rib_amp=0.012, rib_freq=9.0, subdiv=4)))
    # rangefinder block on the receiver top (small red lens: part of the sensor set)
    rf = P.box((0.22, 0.34, 0.16), bevel=0.012, segs=1, chamfer=0.03, chamfer_axes='Y', mat='paint_dark')
    g.merge(B.add('rangefinder', rf.move(tx, ty - 0.62, tz + 0.46)))
    g.merge(B.add('rangefinder', P.dome(0.045, 0.02, 16, 2, mat='lens').rotate((90, 0, 0)).move(tx, ty - 0.79, tz + 0.46)))
    g.merge(B.add('rangefinder', P.box((0.24, 0.1, 0.02), bevel=0.004, segs=1, mat='paint_dark')
                  .move(tx, ty - 0.82, tz + 0.55)))
    B.report()
    return g


# ============================================================================ pelvis / hull frame
def build_pelvis():
    B = K.Budget('pelvis')
    g = Geo()
    core = K.shell([(1.7, -0.66, 0.66, -0.5, 0.62, 0.14), (2.1, -0.8, 0.8, -0.64, 0.76, 0.2),
                    (2.52, -0.74, 0.74, -0.58, 0.72, 0.18)], 'Z', mat='paint_dark')
    K.grooves(core, [(0, -1, 0), (0, 1, 0)], (0, 0, 2.2), (0, 0, 1), gap=0.016, depth=0.014)
    g.merge(B.add('core', core))
    g.merge(B.add('plates', K.plate_at(core, (0, -0.64, 2.12), (0, -1, 0), u_axis=(1, 0, 0), margin=0.06,
                                       thickness=0.05, chamfer=0.08, mat='paint_primary', bolts=1, bolt_r=0.018,
                                       bolt_spacing=0.3)))
    g.merge(B.add('plates', K.plate_at(core, (0, 0.76, 2.12), (0, 1, 0), u_axis=(-1, 0, 0), margin=0.08,
                                       thickness=0.04, chamfer=0.07, mat='paint_primary')))
    # lower slewing ring (fixed) with bolts
    g.merge(B.add('ring', P.banded_cylinder([(0.06, 0.9, 'steel_dark'), (0.08, 0.96, 'paint_dark')], segs=32,
                                            step=0.006).move(0, -0.05, 2.52)))
    g.merge(B.add('ring', P.bolt_circle((0, -0.05, 2.66), (0, 0, 1), 0.86, 8, r=0.02)))
    # hip actuator drums + hoses into the thigh roots
    for s in (1, -1):
        g.merge(B.add('drums', K.drum((s * 0.92, 0.05, 2.15), (1, 0, 0), 0.4, 0.34, mat='paint_dark',
                                      accent='paint_accent', hub=False, segs=16, profile='ring')))
        g.merge(B.add('hoses', K.tube([(s * 0.52, 0.64, 2.42), (s * 0.84, 0.76, 2.3), (s * 1.08, 0.58, 1.84)], 0.045,
                                      8, rib_amp=0.006, rib_freq=14.0, subdiv=2)))
    # front skirt flap (cream) + belly tow lug
    g.merge(B.add('skirt', K.strip((-0.42, -0.745, 1.93), (0.42, -0.745, 1.93), 0.08, 0.01, (0, -1, -0.15),
                                   mat='paint_accent')))
    g.merge(B.add('skirt', K.plate_world([(-0.52, -0.68, 1.98), (0.52, -0.68, 1.98), (0.44, -0.74, 1.6),
                                          (-0.44, -0.74, 1.6)], 0.045, mat='paint_primary',
                                         normal_hint=(0, -1, -0.2), chamfer=0.05, bolts=1, bolt_r=0.016,
                                         bolt_spacing=0.3)))
    # back booster housing (boost-skate thrusters; the bells are the nozzle_back_* nodes)
    bh = P.box((1.3, 0.34, 0.5), bevel=0.02, segs=1, chamfer=0.06, chamfer_axes='X', mat='paint_primary')
    g.merge(B.add('booster', bh.move(0, 0.9, 2.12)))
    lv = P.louvres(0.5, 0.3, count=2, depth=0.03, angle=24, thickness=0.014, mat='steel_dark', side_mat='paint_dark')
    g.merge(B.add('booster', lv.move(0, 0.9, 2.37)))
    B.report()
    return g


# ============================================================================ legs
# Leg language (fix round 1): a dark structural frame dressed with separate chamfered oxide
# armour plates (3 cm two-step bevel, 5 cm panel gaps, bolt rows), a small cream knee cap,
# TWO exposed hydraulic rams per leg spanning the knee (two-part pistons: the barrel rides the
# thigh, the chrome rod rides the shin; models.js aims each half at the other every frame), a
# cable bundle wrapped behind the knee drum and a real foot: split toe, heel spur, 0.15 m
# steel sole on rubber tread.
def _leg_frame(p0, p1):
    """(d, back, out): unit axis p0->p1, sagittal normal pointing to the back (+Y side) and
    the outward side axis (+X) of a left leg segment."""
    d = (Vector(p1) - Vector(p0)).normalized()
    back = Vector((0.0, d.z, -d.y)).normalized()
    if back.y < 0:
        back = -back
    return d, back, Vector((1.0, 0.0, 0.0))


def _side_plate(p0, p1, t0, t1, w0, w1, off, thick=0.06, mat='paint_primary', bolts=1, fwd=0.0, segs=2):
    """Armour plate on the OUTER (+X) face of a leg segment between fractions t0..t1, widths
    w0/w1 across the sagittal plane, `off` metres out from the axis."""
    d, back, out = _leg_frame(p0, p1)
    a, b = Vector(p0).lerp(Vector(p1), t0), Vector(p0).lerp(Vector(p1), t1)
    f = -back
    c = [a + out * off + f * (w0 * 0.5 + fwd), a + out * off + back * (w0 * 0.5 - fwd),
         b + out * off + back * (w1 * 0.5 - fwd), b + out * off + f * (w1 * 0.5 + fwd)]
    return K.plate_world(c, thick, mat=mat, normal_hint=(1, 0, 0), chamfer=0.07, bevel=0.015, segs=segs,
                         bolts=bolts, bolt_r=0.017, bolt_spacing=0.22, inset=thick * 0.45)


def _front_plate(p0, p1, t0, t1, w0, w1, off, thick=0.055, mat='paint_primary', ridge=0.03, bolts=1):
    """Armour plate on the FRONT (knee-side, -back) face of a leg segment."""
    d, back, out = _leg_frame(p0, p1)
    a, b = Vector(p0).lerp(Vector(p1), t0), Vector(p0).lerp(Vector(p1), t1)
    f = -back
    c = [a + f * off - out * w0 * 0.5, a + f * off + out * w0 * 0.5, b + f * off + out * w1 * 0.5,
         b + f * off - out * w1 * 0.5]
    return K.plate_world(c, thick, mat=mat, normal_hint=tuple(f), chamfer=0.07, bevel=0.015, segs=2, ridge=ridge,
                         ridge_axis='Y', bolts=bolts, bolt_r=0.016, bolt_spacing=0.24, inset=thick * 0.45)


def build_thigh():
    B = K.Budget('thigh')
    g = Geo()
    hx, hy, hz = HIP
    d, back, out = _leg_frame(HIP, KNEE)
    # structural frame (dark), narrower than the armour so the plates read as bolted-on layers
    fr = K.limb(HIP, KNEE, [(0.0, -0.26, 0.26, -0.3, 0.3, 0.1), (0.5, -0.28, 0.28, -0.34, 0.34, 0.11),
                            (1.0, -0.22, 0.22, -0.26, 0.26, 0.08)], mat='paint_dark')
    g.merge(B.add('frame', fr))
    # outer armour: two plates with a 5 cm panel gap, bolt rows
    g.merge(B.add('plates', _side_plate(HIP, KNEE, -0.12, 0.44, 0.78, 0.72, 0.31)))
    g.merge(B.add('plates', _side_plate(HIP, KNEE, 0.5, 0.86, 0.7, 0.58, 0.31)))
    # inner (body-side) plate: plain, no bolts
    ip = _side_plate(HIP, KNEE, 0.0, 0.8, 0.62, 0.52, 0.3, thick=0.04, bolts=0, segs=1)
    ip.mirror('X').move(2 * (hx + (KNEE[0] - hx) * 0.4), 0, 0)
    g.merge(B.add('plates', ip))
    # front plates (oxide) with a ridge + a small dirty-cream knee cap (the only cream on the leg)
    g.merge(B.add('plates', _front_plate(HIP, KNEE, 0.02, 0.5, 0.56, 0.5, 0.36)))
    g.merge(B.add('plates', _front_plate(HIP, KNEE, 0.56, 0.84, 0.5, 0.44, 0.33, bolts=0)))
    kc = K.plate_world([Vector(KNEE) + Vector((-0.24, -0.33, 0.2)), Vector(KNEE) + Vector((0.24, -0.33, 0.2)),
                        Vector(KNEE) + Vector((0.2, -0.36, -0.1)), Vector(KNEE) + Vector((-0.2, -0.36, -0.1))],
                       0.06, mat='paint_secondary', normal_hint=(0, -1, 0.2), chamfer=0.06, bevel=0.03, segs=1,
                       ridge=0.025, ridge_axis='Y')
    g.merge(B.add('kneecap', kc))
    # outer hip fender (silhouette mass) with the yellow ID strip
    ox = hx + 0.36
    g.merge(B.add('fender', K.plate_world([(ox, hy + 0.44, hz + 0.3), (ox, hy - 0.52, hz + 0.26),
                                           (ox, hy - 0.5, hz - 0.36), (ox, hy + 0.1, hz - 0.5),
                                           (ox, hy + 0.46, hz - 0.2)], 0.06, mat='paint_primary',
                                          normal_hint=(1, 0, 0), chamfer=0.08, bevel=0.03, segs=1, bolts=1,
                                          bolt_r=0.02, bolt_spacing=0.3)))
    g.merge(B.add('fender', K.strip((ox + 0.06, hy - 0.44, hz + 0.16), (ox + 0.06, hy + 0.36, hz + 0.18), 0.12,
                                    0.012, (1, 0, 0), mat='paint_accent')))
    # ram anchor lugs on the thigh (the rams themselves are separate two-part nodes)
    for (ax_, ab, at) in RAM_A:
        p = Vector(HIP).lerp(Vector(KNEE), at) + back * ab + out * ax_
        g.merge(B.add('lugs', P.box((0.1, 0.16, 0.16), bevel=0.012, segs=1, mat='steel_dark').move(*p)))
    # knee drum (joint housing) + cable bundle wrapped around its back
    g.merge(B.add('knee', K.drum(KNEE, (1, 0, 0), 0.28, 0.56, mat='paint_dark', hub=False, segs=24,
                                 profile='ring', accent='paint_dark')))
    g.merge(B.add('knee', P.cylinder(0.12, 0.66, 16, bevel=0.01, bsegs=1, mat='steel').rotate((0, 90, 0))
                  .move(*KNEE)))
    kx, ky, kz = KNEE
    for i, (xo, rr) in enumerate(((-0.12, 0.345), (0.04, 0.36))):
        pts = []
        for k in range(7):
            a = math.radians(-25 + k * 25)   # arc behind the knee (from above to below the drum axis)
            pts.append((kx + xo, ky + math.cos(a) * rr, kz + math.sin(a) * rr + 0.02))
        g.merge(B.add('cables', K.tube(pts, 0.03 - i * 0.006, 6, mat='rubber', collars=False, subdiv=2)))
    B.report()
    return g


def build_shin():
    B = K.Budget('shin')
    g = Geo()
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    d, back, out = _leg_frame(KNEE, ANKLE)
    fr = K.limb(KNEE, ANKLE, [(0.0, -0.24, 0.24, -0.28, 0.28, 0.09), (0.45, -0.26, 0.26, -0.3, 0.32, 0.1),
                              (1.0, -0.2, 0.2, -0.24, 0.24, 0.08)], mat='paint_dark')
    g.merge(B.add('frame', fr))
    g.merge(B.add('plates', _side_plate(KNEE, ANKLE, 0.12, 0.5, 0.66, 0.62, 0.29)))
    g.merge(B.add('plates', _side_plate(KNEE, ANKLE, 0.56, 0.84, 0.6, 0.5, 0.29, bolts=0)))
    ip = _side_plate(KNEE, ANKLE, 0.15, 0.8, 0.55, 0.45, 0.28, thick=0.04, bolts=0, segs=1)
    ip.mirror('X').move(2 * kx + (ax - kx) * 0.47, 0, 0)
    g.merge(B.add('plates', ip))
    # shin guard: front plate with ridge + worn hazard band
    g.merge(B.add('plates', _front_plate(KNEE, ANKLE, 0.16, 0.8, 0.54, 0.46, 0.32)))
    f = -back
    qm = Vector(KNEE).lerp(Vector(ANKLE), 0.7) + f * 0.4
    g.merge(B.add('plates', K.strip(qm + Vector((-0.2, 0, 0)), qm + Vector((0.2, 0, 0)), 0.1, 0.01, f, mat='hazard')))
    for (ax_, ab, at) in RAM_B:
        p = Vector(KNEE).lerp(Vector(ANKLE), at) + back * ab + out * ax_
        g.merge(B.add('lugs', P.box((0.1, 0.16, 0.16), bevel=0.012, segs=1, mat='steel_dark').move(*p)))
    # ankle cheeks
    for sx in (-1, 1):
        g.merge(B.add('cheeks', K.cheek((ax + sx * 0.27, ay, az), sx, 0.22, 0.06, strap_to=(ay + 0.05, az + 0.36),
                                        strap_w=0.26, bolts=0, n=16)))
    B.report()
    return g


def build_foot():
    B = K.Budget('foot')
    g = Geo()
    ax, ay, az = ANKLE
    g.merge(B.add('ankle', K.drum(ANKLE, (1, 0, 0), 0.2, 0.46, mat='paint_dark', hub=False, segs=20,
                                  profile='ring')))
    g.merge(B.add('ankle', P.frustum((0.66, 0.7), (0.44, 0.44), 0.2, bevel=0.018, segs=1, chamfer=0.05,
                                     mat='paint_dark').move(ax, ay, 0.34)))
    # steel sole slab (0.15 m, bevelled) on a rubber tread
    sole = P.box((1.04, 1.5, 0.12), bevel=0.02, segs=2, chamfer=0.1, chamfer_axes='Z', mat='steel_dark')
    g.merge(B.add('sole', sole.move(ax, ay - 0.1, 0.09)))
    for yy, ln in ((ay - 0.55, 0.42), (ay + 0.22, 0.5)):
        g.merge(B.add('tread', P.box((0.98, ln, 0.04), bevel=0.01, segs=1, mat='rubber').move(ax, yy, 0.02)))
    # upper deck (oxide) with a panel groove
    deck = K.shell([(ay - 0.72, -0.46, 0.46, 0.15, 0.3, 0.05), (ay + 0.42, -0.46, 0.46, 0.15, 0.34, 0.06),
                    (ay + 0.62, -0.36, 0.36, 0.15, 0.26, 0.05)], 'Y', bevel=0.02, mat='paint_primary')
    deck.move(ax, 0, 0)
    K.grooves(deck, [(0, 0, 1), (1, 0, 0), (-1, 0, 0)], (ax, ay - 0.2, 0), (0, 1, 0), gap=0.02, depth=0.014)
    g.merge(B.add('deck', deck))
    # split toe: two hinged toe plates with a 7 cm gap, cream caps, hinge barrel
    for sx in (-1, 1):
        xc = ax + sx * 0.235
        toe = P.prism([(ay - 1.18, 0.02), (ay - 1.16, 0.15), (ay - 0.86, 0.28), (ay - 0.66, 0.28), (ay - 0.66, 0.0),
                       (ay - 1.1, 0.0)], 0.38, bevel=0.016, segs=1, mat='paint_primary', axis='X')
        g.merge(B.add('toe', toe.move(xc, 0, 0)))
        g.merge(B.add('toe', K.plate_world([(xc - 0.17, ay - 1.14, 0.15), (xc + 0.17, ay - 1.14, 0.15),
                                            (xc + 0.18, ay - 0.86, 0.27), (xc - 0.18, ay - 0.86, 0.27)], 0.035,
                                           mat='paint_dark', normal_hint=(0, -0.4, 1), chamfer=0.04,
                                           bevel=0.015, segs=1)))
    g.merge(B.add('hinge', P.cylinder(0.07, 0.9, 16, bevel=0.0, bsegs=1, mat='steel').rotate((0, 90, 0))
                  .move(ax, ay - 0.7, 0.16)))
    g.merge(B.add('toe', K.strip((ax - 0.36, ay - 1.17, 0.07), (ax + 0.36, ay - 1.17, 0.07), 0.07, 0.012,
                                 (0, -1, 0), mat='hazard')))
    # heel spur
    g.merge(B.add('heel', P.prism([(ay + 0.55, 0.0), (ay + 0.95, 0.02), (ay + 0.9, 0.14), (ay + 0.56, 0.36)], 0.36,
                                  bevel=0.015, segs=1, mat='paint_dark', axis='X').move(ax, 0, 0)))
    for sx in (-1, 1):
        g.merge(B.add('bolts', P.bolt_row((ax + sx * 0.38, ay - 0.5, 0.315), (ax + sx * 0.38, ay + 0.3, 0.33), 2,
                                          (0, 0, 1), r=0.022)))
    B.report()
    return g


# two knee-spanning rams per leg: (x offset from the leg axis, back offset, fraction along the
# segment) for the thigh anchor (A) and the shin anchor (B)
RAM_A = [(0.44, 0.06, 0.28), (0.0, 0.42, 0.3)]
RAM_B = [(0.42, 0.06, 0.6), (0.0, 0.38, 0.52)]


def ram_anchors(i):
    _, bt, ot = _leg_frame(HIP, KNEE)
    _, bs, os_ = _leg_frame(KNEE, ANKLE)
    xa, ba, ta = RAM_A[i]
    xb, bb, tb = RAM_B[i]
    A = Vector(HIP).lerp(Vector(KNEE), ta) + bt * ba + ot * xa
    Bp = Vector(KNEE).lerp(Vector(ANKLE), tb) + bs * bb + os_ * xb
    return A, Bp


def build_ram_half(i, half):
    """Half of knee ram i (left leg): 'a' = barrel (thigh), 'b' = chrome rod (shin). Geometry
    runs from its own anchor toward the partner anchor (rest pose)."""
    A, Bp = ram_anchors(i)
    d = Bp - A
    L = d.length
    g = Geo()
    r = 0.07 if i == 0 else 0.06
    if half == 'a':
        dn = d.normalized()
        Lb = L * 0.6
        prof = [(0.0, 0.0), (r * 0.8, 0.0), (r, r * 0.35), (r, Lb - r * 0.5), (r * 1.14, Lb - r * 0.45),
                (r * 1.14, Lb), (r * 0.6, Lb), (0.0, Lb)]
        g.merge(P.lathe(prof, 16, 'steel_dark').align(dn, loc=A))
        g.merge(P.cylinder(r * 0.3, r * 0.6, 8, bevel=0.0, bsegs=1, mat='steel', z0=0.0)
                .align((0, 0, 1) if abs(dn.z) < 0.8 else (0, 1, 0), loc=A + dn * (Lb * 0.75)))
        g.merge(P.cylinder(r * 0.9, 0.12, 12, bevel=0.0, bsegs=1, mat='steel_dark').rotate((0, 90, 0)).move(*A))
    else:
        dn = -d.normalized()
        g.merge(P.cylinder(r * 0.45, L * 0.66, 16, bevel=0.0, bsegs=1, mat='chrome', z0=0.0, cap=False)
                .align(dn, loc=Bp))
        g.merge(P.ring(r * 0.66, r * 0.42, 0.05, 12, bevel=0.0, bsegs=1, mat='rubber', z0=0.0)
                .align(dn, loc=Bp + dn * (L * 0.3)))
        g.merge(P.cylinder(r * 0.78, 0.12, 12, bevel=0.0, bsegs=1, mat='steel_dark').rotate((0, 90, 0)).move(*Bp))
    return g


# ============================================================================ debris (death)
def build_debris(k, rng):
    """Armour shard k: a broken, bevelled plate fragment (0.4-1.2 m) in the unit's own paint,
    authored at the origin (models.js launches them from the hull on death)."""
    size = [1.1, 0.9, 0.75, 0.62, 0.55, 0.48, 0.8, 0.42][k]
    mat = ['paint_primary', 'paint_secondary', 'paint_primary', 'paint_primary', 'paint_secondary', 'paint_dark',
           'paint_primary', 'steel_dark'][k]
    n = 5 + (k % 2)
    pts = []
    for j in range(n):
        a = math.tau * j / n + rng.uniform(-0.25, 0.25)
        rr = size * 0.5 * rng.uniform(0.55, 1.0) * (1.0 if j % 2 == 0 else rng.uniform(0.6, 0.9))
        pts.append((math.cos(a) * rr, math.sin(a) * rr * rng.uniform(0.6, 0.9)))
    th = 0.05 + 0.03 * (k % 3)
    g = P.plate(pts, th, bevel=0.012, segs=1, mat=mat, inset=th * 0.5)
    if k in (0, 6):   # bolt pair along the longest remaining edge
        g.merge(P.bolt_row((-size * 0.2, -size * 0.12, th), (size * 0.2, -size * 0.12, th), 2, (0, 0, 1), r=0.022))
    if k in (1, 3):
        g.merge(K.strip((-size * 0.3, size * 0.05, th), (size * 0.3, size * 0.05, th), 0.1, 0.008, (0, 0, 1),
                        mat='paint_accent'))
    g.rotate((rng.uniform(-20, 20), rng.uniform(-20, 20), rng.uniform(0, 180)))
    return g


# ============================================================================ assembly
DEBRIS_N = 8


def debris_home(k):
    """Bake position of shard k: a 'debris yard' beside the unit (no occlusion from the body,
    same height range, so the bake gradients are unchanged). models.js launches them."""
    return (5.5 + (k % 4) * 1.6, -1.5 + (k // 4) * 2.4, 1.2 + (k % 3) * 1.1)


def build(a):
    import random
    a.pivot('hull', (0, 0, 0))
    a.pivot('pelvis', PELVIS, parent='hull')
    a.pivot('turret', TURRET, parent='pelvis')
    a.pivot('eye', EYE, parent='turret', iw_eye_color='#FF2A2A', iw_eye_strength=16.0)
    a.pivot('barrel', TRUNNION, parent='turret')
    a.pivot('beacon', (0.9, 0.95, 5.3), parent='turret', iw_eye_color='#FF3B2F', iw_eye_strength=18.0)
    a.muzzle('muzzle', MUZZLE, fire=(0, -1, 0), parent='barrel')
    for S, m in (('L', lambda p: p), ('R', mx)):
        a.pivot('thigh_' + S, m(HIP), parent='pelvis')
        a.pivot('shin_' + S, m(KNEE), parent='thigh_' + S)
        a.pivot('foot_' + S, m(ANKLE), parent='shin_' + S)
        for i in range(len(RAM_A)):
            A, Bp = ram_anchors(i)
            a.pivot(f'ram_{S}_{i}a', m(tuple(A)), parent='thigh_' + S, iw_ram_to=f'ram_{S}_{i}b')
            a.pivot(f'ram_{S}_{i}b', m(tuple(Bp)), parent='shin_' + S, iw_ram_to=f'ram_{S}_{i}a')
    for k in range(DEBRIS_N):
        a.pivot(f'debris_{k}', debris_home(k), iw_debris=1)
    tris = {}

    def put(name, g, parent):
        g.cull_inside()
        K.drop_hidden(g)
        ob = a.part(name, g, parent=parent)
        tris[name] = iw.tri_count([ob])
        return ob

    with iw.timed('model'):
        put('turret_geo', build_cab(), 'turret')
        put('eye_geo', build_eye(), 'eye')
        put('beacon_geo', build_beacon(), 'beacon')
        put('barrel_geo', build_gun(), 'barrel')
        put('pelvis_geo', build_pelvis(), 'pelvis')
        th, sh, ft = build_thigh(), build_shin(), build_foot()
        rams = [(build_ram_half(i, 'a'), build_ram_half(i, 'b')) for i in range(len(RAM_A))]
        for S in ('L', 'R'):
            gth, gsh, gft = th.copy(), sh.copy(), ft.copy()
            if S == 'R':
                gth.mirror('X')
                gsh.mirror('X')
                gft.mirror('X')
            put(f'thigh_{S}_geo', gth, f'thigh_{S}')
            put(f'shin_{S}_geo', gsh, f'shin_{S}')
            put(f'foot_{S}_geo', gft, f'foot_{S}')
            for i, (ga, gb) in enumerate(rams):
                ga2, gb2 = ga.copy(), gb.copy()
                if S == 'R':
                    ga2.mirror('X')
                    gb2.mirror('X')
                put(f'ram_{S}_{i}a_geo', ga2, f'ram_{S}_{i}a')
                put(f'ram_{S}_{i}b_geo', gb2, f'ram_{S}_{i}b')
        th.free()
        sh.free()
        ft.free()
        rng = random.Random(4077)
        for k in range(DEBRIS_N):
            put(f'debris_{k}_geo', build_debris(k, rng).move(*debris_home(k)), f'debris_{k}')
        for i, x in enumerate((0.36, -0.36)):
            K.nozzle_part(a, f'nozzle_back_{i}', (x, 1.28, 2.0), (0, 1, -0.3), 'pelvis', 0.08, 0.13, 0.22, segs=24,
                          ribs=0, bolts=0)
    return tris


def rust_streaks(w=256, h=512, seed=5, n=9, strength=0.8):
    """Rust run-off streaks (RGBA): thin vertical drips fading downward (under bolt rows)."""
    import numpy as np
    from PIL import Image, ImageFilter
    rng = np.random.default_rng(seed)
    a = np.zeros((h, w), np.float32)
    for _ in range(n):
        x = int(rng.uniform(0.05, 0.95) * w)
        L = int(rng.uniform(0.35, 1.0) * h)
        wd = max(1, int(rng.uniform(0.01, 0.035) * w))
        k = rng.uniform(0.5, 1.0)
        for y in range(L):
            f = (1 - y / L) ** 1.4
            a[y, max(0, x - wd):x + wd] = np.maximum(a[y, max(0, x - wd):x + wd], f * k)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 92, 44, 22
    rgba[..., 3] = np.clip(a * 255 * strength, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA').filter(ImageFilter.GaussianBlur(1.5))


def post_bake(a):
    for k in range(DEBRIS_N):   # the debris yard stays out of the look-dev renders
        ob = a.pivots.get(f'debris_{k}')
        for o in (ob.children if ob else []):
            o.hide_render = True


def add_decals(a):
    C, BK = (189, 179, 154), D.BLACK
    for s in (1, -1):
        x = s * (CAB_HW + 0.075)
        # unit number + ID bars on the cream side skirts (crisp decal cards)
        K.card(a, D.text_decal('P-27', px=320, color=BK, worn=0.3), (x, 0.26, 3.22), (s, 0, 0), up=(0, 0, 1),
               size=(0.64, None), density=640)
        K.card(a, K.id_bars(256, 64, seed=11 + s), (x, 0.3, 2.86), (s, 0, 0), up=(0, 0, 1), size=(0.42, None))
        a.decal(D.text_decal('L' if s > 0 else 'R', px=200, color=BK, worn=0.3), (s * 1.58, 0.32, 2.3), (s, 0, 0),
                up=(0, 0, 1), size=(0.12, None))
        a.decal(D.serial_plate(('PK-2 PICKET  GC-SEC', 'PIER 7 YARD  LOT 3310')), (s * 0.8, -0.72, 2.14), (0, -1, 0),
                up=(0, 0, 1), size=(0.3, None))
        # rust run-off under the side-skirt bolt rows and the glacis corners
        a.decal(rust_streaks(seed=30 + s), (x, 0.2, 3.3), (s, 0, 0), up=(0, 0, 1), size=(0.9, 0.9), depth=0.12)
        a.decal(rust_streaks(seed=40 + s, n=6), (s * 1.0, -1.2, 3.35), (0, -1, 0), up=(0, 0, 1), size=(0.5, 0.5),
                depth=0.3)
    K.card(a, K.grauwerk_mark(512), (CAB_HW + 0.055, 0.92, 3.1), (1, 0, 0), up=(0, 0, 1), size=(0.3, None))
    K.card(a, D.text_decal('GC-SEC', px=200, color=BK, worn=0.3), (-CAB_HW - 0.055, 0.92, 3.1), (-1, 0, 0),
           up=(0, 0, 1), size=(0.34, None))
    p, n = glacis_point(0.0, 0.55, 0.075)
    K.card(a, D.text_decal('27', px=360, color=BK, worn=0.25), tuple(p), tuple(n), up=(0, 0.6, 1), size=(0.6, None),
           density=640)
    a.decal(K.soot(256, 20, 0.85, 1.4), (0.77, 1.35, 4.33), (0, 0, 1), up=(0, 1, 0), size=(0.9, 0.7), depth=0.3)
    a.decal(K.soot(256, 23, 0.8, 1.0), (0.0, 1.08, 2.0), (0, 1, -0.3), size=(1.0, 0.5), depth=0.3)
    K.card(a, D.warning_label('DANGER', '射線注意', ('LINE OF FIRE', '砲口前方立入禁止'), w=720, colors=(D.YELLOW, BK)),
           (-2.1, 0.22, 3.74), (-1, 0, 0), up=(0, 0, 1), size=(0.3, None), parent='barrel')
    K.card(a, D.text_decal(['GK-40', '40x180 HE'], px=140, color=C, worn=0.3), (-1.78, -0.62, 4.1), (0, 0, 1),
           up=(0, -1, 0), size=(0.26, None), parent='barrel')
    K.card(a, D.warning_label('HOT', '高温注意', ('EXHAUST', '排気口 接触厳禁'), w=720), (0.75, 1.78, 3.3), (0, 1, 0),
           up=(0, 0, 1), size=(0.34, None))
    K.card(a, D.text_decal(['MAX 12t', '荷重注意'], px=140, color=BK, worn=0.3), (1.0, 0.25, 4.33), (0, 0, 1),
           up=(0, -1, 0), size=(0.28, None))
    K.card(a, D.arrow_decal(text='LIFT'), (-1.0, 0.2, 4.33), (0, 0, 1), up=(0, -1, 0), size=(0.2, None))


VIEWS = {
    'hero': dict(azimuth=-38, elevation=10, lens=45, distance=15, target=(-0.2, -0.4, 2.6)),
    'front': dict(azimuth=0, elevation=6, lens=50, distance=14, target=(0, -0.4, 2.6)),
    'back': dict(azimuth=150, elevation=18, lens=50, distance=14, target=(0, 0.3, 2.7)),
    'close': dict(azimuth=-28, elevation=8, lens=70, distance=7.5, target=(-0.4, -1.0, 3.6)),
}
CLAY = dict(VIEWS, side=dict(azimuth=-90, elevation=4, lens=50, distance=15, target=(0, -0.6, 2.6)))
COLORS = {'paint_primary': {'color': '#5C2E24', 'rough': 0.52},
          'paint_secondary': {'color': '#B8AE95', 'rough': 0.58, 'grime': 1.5, 'dust': 1.0},
          'paint_accent': {'color': '#D8A31A'}, 'paint_dark': {'color': '#2B2624'},
          'steel_dark': {'color': '#3A3836'}, 'glow': '#FFB347',
          'glass': {'color': '#07090B', 'metal': 0.0, 'rough': 0.05, 'wear': 0.0, 'grime': 0.15, 'rust': 0.0,
                    'dust': 0.1, 'var': 0.0, 'decals': False}}
OBJ_WEIGHT = {'turret_geo': 1.3, 'eye_geo': 1.2, 'barrel_geo': 1.1, 'pelvis_geo': 0.75, 'foot_L_geo': 0.8,
              'foot_R_geo': 0.8, **{f'debris_{k}_geo': 0.45 for k in range(8)},
              **{f'ram_{S}_{i}{h}_geo': 0.6 for S in 'LR' for i in range(2) for h in 'ab'}}
WEATHER = iw.Weathering(edge_wear=1.45, grime=1.6, streaks=1.6, rust=1.0, dust=0.7, chip_threshold=0.54,
                        flat_chips=0.55, macro=0.1, ground_dirt=0.95, ao_in_albedo=0.26)
NEED = ['hull', 'pelvis', 'turret', 'barrel', 'muzzle', 'eye', 'beacon', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R',
        'foot_R', 'ram_L_0a', 'ram_L_0b', 'ram_R_1a', 'debris_0', 'debris_7']


def main():
    K.run(NAME, build, add_decals, NEED, scheme='grauwerk', colors=COLORS, seed=21, obj_weight=OBJ_WEIGHT,
          weathering=WEATHER, views=VIEWS, clay=CLAY, res=2048, sizes={'normal': 2048, 'orm': 768, 'emissive': 256},
          tex_quality={'basecolor': 80, 'normal': 74, 'orm': 64}, post_bake=post_bake)


if __name__ == '__main__':
    main()
    K.finish()
