"""IRONWAKE Blender pipeline proof: a detailed RIGHT forearm of the player rig
(RIG-07 "IRONWAKE") with its mounted rifle (IW-R7) and a forearm thruster pack.

    python3 blender/test_asset.py [--res 2048] [--samples 64] [--no-render] [--quick]

Outputs
  assets/_test/sample.glb          meshopt-compressed GLB (three.js runtime)
  assets/_test/SM_sample.fbx       FBX for Unreal + T_sample_{BC,ORM,N,E}.png
  assets/_test/sample_preview*.png Cycles look-dev renders
  assets/_test/sample_maps.png     texture contact sheet
  assets/_test/sample_report.json  tris / texel density / timings

Coordinates: Blender +Z up, the rig faces -Y, so the rig's RIGHT side is -X.
The forearm points forward (-Y) as in an aiming pose; the elbow pivot is the origin.
Node contract (src/mech/rig.js): root > forearm_R (elbow) > {forearm_R_geo,
hand_R (wrist) > {hand_R_geo, weapon_R > {weapon_R_geo, muzzle_R}},
booster_R > {booster_R_geo, nozzle_R_0 > nozzle_R_0_geo, nozzle_R_1 > nozzle_R_1_geo}}.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import iwkit as iw  # noqa: E402
from iwkit import decals as D  # noqa: E402
from iwkit import prims as P  # noqa: E402
from iwkit.geo import Geo  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), 'assets', '_test')


# =============================================================================== helpers
def pick(g, normal, lo, hi, axis=1, angle=15.0):
    """Largest face of g facing `normal` whose centre coordinate (axis) is in [lo, hi]."""
    fs = [f for f in g.faces_facing(normal, angle) if lo <= f.calc_center_median()[axis] <= hi]
    return max(fs, key=lambda f: f.calc_area()) if fs else None


# =============================================================================== forearm
def build_forearm(rng):
    g = Geo()
    # ---- main housing: lofted, tapered shell with big angular chamfers
    def sec(w, zb, zt, ch_out, ch_in, ch_b):
        hw = w / 2
        return [(-hw, zb, ch_b), (hw, zb, ch_b), (hw, zt, ch_in), (-hw, zt, ch_out)]
    s0 = sec(0.76, -0.30, 0.44, 0.17, 0.09, 0.06)
    s1 = sec(0.74, -0.30, 0.43, 0.17, 0.09, 0.06)
    s2 = sec(0.64, -0.26, 0.36, 0.14, 0.08, 0.05)
    house = P.loft([(s0, -0.30), (s1, -0.9), (s2, -2.02)], bevel=0.014, segs=3, mat='paint_primary',
                   corner=0.1, corner_segs=1)
    for y in (-0.62, -1.12, -1.62):
        faces = house.faces_facing((0, 0, 1), 20) + house.faces_facing((1, 0, 0), 20) + \
            house.faces_facing((-1, 0, 1), 25) + house.faces_facing((-1, 0, 0), 20)
        house.groove_cut(faces, (0, y, 0), (0, 1, 0.05), gap=0.014, depth=0.012)
    # inner side: recessed service bay with greebles
    f = pick(house, (1, 0, 0), -1.6, -1.15)
    if f is not None:
        house.hatch(f, (0.34, -1.37, 0.06), (0.36, 0.3), gap=0.012, recess=0.03, mat='steel_dark', u_axis=(0, 1, 0))
    # top middle: vent hatch
    f = pick(house, (0, 0, 1), -1.1, -0.64, angle=20)
    top_mid = f
    armour = []
    # layered armour: one long ridged bone plate over the two front top segments (it
    # bridges the seam below it), primary plates on the outer side
    f = pick(house, (0, 0, 1), -1.6, -1.14, angle=20)
    if f is not None:
        o, u, v, n, pts = house.face_frame(f, (0, -1, 0))
        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        u0, v0, v1 = min(us), min(vs), max(vs)
        # extend forward to just short of the wrist; local u runs along -Y
        u1 = (-1.97 - o.y) / u.y if abs(u.y) > 1e-6 else max(us)
        ol = P.fillet([(u0 + 0.03, v0 + 0.04, 0.05), (u1, v0 + 0.07, 0.07), (u1, v1 - 0.07, 0.07),
                       (u0 + 0.03, v1 - 0.04, 0.05)], 0.05, 1)
        pl = P.armor_on_face(house, f, thickness=0.045, ridge=0.03, ridge_axis='X', mat='paint_secondary',
                             u_axis=(0, -1, 0), outline=ol, bolts=1, bolt_r=0.013, bolt_spacing=0.2)
        # follow the housing's forward taper (the top drops ~0.05 m toward the wrist)
        pl.transform(Matrix.Translation(o) @ Matrix.Rotation(math.radians(-3.0), 4, 'X') @ Matrix.Translation(-o))
        armour.append(pl)
    for lo, hi in ((-1.6, -1.14), (-2.0, -1.64), (-1.1, -0.64)):
        f = pick(house, (-1, 0, 0), lo, hi)
        if f is not None:
            armour.append(P.armor_on_face(house, f, margin=0.03, thickness=0.04, taper=0.12, chamfer=0.04,
                                          mat='paint_primary', u_axis=(0, -1, 0), bolts=1, bolt_r=0.012))
    f = pick(house, (1, 0, 0), -1.1, -0.64)
    if f is not None:
        armour.append(P.armor_on_face(house, f, margin=0.03, thickness=0.035, taper=0.1, chamfer=0.04,
                                      mat='paint_secondary', u_axis=(0, -1, 0), bolts=1, bolt_r=0.012))
    if top_mid is not None:
        o, u, v, n, pts = house.face_frame(top_mid, (0, -1, 0))
        house.hatch(top_mid, o, (0.3, 0.3), gap=0.012, recess=0.03, mat='steel_dark', u_axis=(0, -1, 0))
        gr = P.grille(0.26, 0.26, bars=9, bar_r=0.007, frame=0.012, depth=0.02, mat='steel_dark', horizontal=True)
        g.merge(gr.move(o.x, o.y, o.z - 0.012))
    g.merge(house, *armour)
    gp = P.greeble_panel(0.3, 0.24, seed=rng.randint(0, 999), density=0.9, height=0.03)
    gp.rotate((0, 90, 0)).rotate((90, 0, 0)).move(0.31, -1.37, 0.06)
    g.merge(gp)
    # lifting shackle + tow lug at the rear of the housing top
    g.merge(P.shackle(0.07).move(0.13, -0.45, 0.44))
    # ---- underside chassis (exposed dark frame) with lightening recesses
    ch = P.box((0.5, 1.72, 0.1), bevel=0.01, segs=2, chamfer=0.03, chamfer_axes='Y', mat='steel_dark')
    ch.move(0, -1.16, -0.33)
    for y in (-0.62, -1.1, -1.58):
        f = ch.largest_face((0, 0, -1), 10)
        ch.hatch(f, (0, y, -0.38), (0.3, 0.26), gap=0.014, recess=0.035, u_axis=(1, 0, 0))
    g.merge(ch)
    # ---- elbow actuator drum: banded lathe (grooves, accent ring), bolted end caps
    hub = P.banded_cylinder([(0.035, 0.25, 'steel_dark'), (0.06, 0.3), (0.02, 0.284, 'steel_dark'), (0.2, 0.306),
                             (0.05, 0.318, 'paint_accent'), (0.2, 0.306), (0.02, 0.284, 'steel_dark'), (0.06, 0.3),
                             (0.035, 0.25, 'steel_dark')], segs=56, step=0.006, mat='paint_dark')
    hub.move(0, 0, -0.34).rotate((0, 90, 0))
    g.merge(hub)
    for sx in (-1, 1):
        cap = P.ring(0.25, 0.12, 0.04, 64, bevel=0.008, mat='steel_dark', z0=0.0)
        cap.merge(P.banded_cylinder([(0.03, 0.12), (0.03, 0.1), (0.04, 0.06)], segs=48, step=0.005, mat='steel'))
        cap.merge(P.bolt_circle((0, 0, 0.04), (0, 0, 1), 0.19, 10, r=0.014))
        cap.align((sx, 0, 0), up=(0, 0, 1), loc=(sx * 0.34, 0, 0))
        g.merge(cap)
        yk = P.prism(P.fillet([(0.02, -0.33, 0.3), (-0.52, -0.3, 0.05), (-0.52, 0.4, 0.05), (0.02, 0.36, 0.3)],
                              0.05, 4), 0.07, bevel=0.01, segs=2, mat='paint_primary', axis='X')
        yk.move(sx * 0.41, 0, 0)
        g.merge(yk)
        g.merge(P.bolt_row((sx * 0.45, -0.25, 0.3), (sx * 0.45, -0.46, 0.3), 3, (sx, 0, 0), r=0.014))
        g.merge(P.bolt_row((sx * 0.45, -0.25, -0.24), (sx * 0.45, -0.46, -0.24), 3, (sx, 0, 0), r=0.014))
    # servo pack on top of the drum, hoses into the housing
    sp = P.box((0.3, 0.2, 0.12), bevel=0.012, segs=3, chamfer=0.03, chamfer_axes='X', mat='paint_primary')
    sp.move(0.0, 0.02, 0.33)
    g.merge(sp)
    g.merge(P.bolt_row((-0.12, -0.075, 0.37), (0.12, -0.075, 0.37), 4, (0, -1, 0), r=0.01))
    for x in (-0.08, 0.08):
        g.merge(P.hose([(x, -0.08, 0.34), (x, -0.2, 0.36), (x * 1.2, -0.34, 0.38)], 0.02, 10, rib_amp=0.003,
                       rib_freq=36.0))
    # ---- exposed hydraulic rams under the forearm (drum lug -> wrist block)
    for sx in (-1, 1):
        x = sx * 0.17
        lug_a = P.box((0.1, 0.16, 0.16), bevel=0.01, segs=2, mat='steel_dark').move(x, -0.28, -0.37)
        lug_b = P.box((0.1, 0.16, 0.18), bevel=0.01, segs=2, mat='steel_dark').move(x, -1.94, -0.36)
        g.merge(lug_a, lug_b)
        g.merge(P.piston((x, -0.28, -0.46), (x, -1.94, -0.45), r_sleeve=0.065, r_rod=0.034, sleeve_frac=0.52,
                         up=(0, 0, 1), segs=32))
    for i, x in enumerate((-0.05, 0.0, 0.05)):
        pts = [(x, -0.25, -0.34), (x * 1.3, -0.6, -0.43 - 0.01 * i), (x * 1.5, -1.2, -0.44 - 0.01 * i),
               (x, -1.8, -0.41), (x * 0.6, -1.98, -0.36)]
        g.merge(P.hose(pts, 0.022, 10, rib_amp=0.003, rib_freq=32.0))
    for y in (-0.9, -1.45):
        g.merge(P.box((0.2, 0.05, 0.035), bevel=0.006, segs=2, mat='steel').move(0, y, -0.47))
    # cable conduit with clamps along the outer-bottom edge
    g.merge(P.pipe_run([(-0.36, -0.36, -0.24), (-0.345, -1.1, -0.235), (-0.3, -1.98, -0.2)], 0.02, bend=0.2, segs=16,
                       mat='steel', flanges=False))
    for y in (-0.55, -0.95, -1.35, -1.75):
        t = (-y - 0.36) / 1.62
        x = -0.36 + 0.06 * t
        g.merge(P.box((0.06, 0.04, 0.06), bevel=0.006, segs=2, mat='steel_dark').move(x + 0.01, y, -0.23))
    # ---- wrist: octagonal collar + rotating ring + bolts
    wr = P.loft([(P.rect(0.6, 0.58, 0, 0.05), -2.02), (P.rect(0.56, 0.54, 0, 0.05), -2.14)], bevel=0.01, segs=2,
                mat='steel_dark', corner=0.12, corner_segs=1)
    g.merge(wr)
    g.merge(P.ring(0.24, 0.12, 0.08, 48, bevel=0.01, mat='steel', z0=0.0).align((0, -1, 0), loc=(0, -2.14, 0.0)))
    g.merge(P.bolt_circle((0, -2.22, 0.0), (0, -1, 0), 0.19, 8, r=0.013))
    return g


# =============================================================================== hand
def build_hand():
    g = Geo()
    # palm block on the outer (-X) side of the grip, back-of-hand armour facing -X
    palm = P.box((0.1, 0.3, 0.38), bevel=0.012, segs=2, chamfer=0.03, chamfer_axes='X', mat='steel_dark')
    palm.move(-0.13, -2.42, -0.2)
    g.merge(palm)
    back = P.plate(P.fillet([(-0.19, -0.15), (0.19, -0.15), (0.17, 0.13), (-0.19, 0.15)], 0.04, 1), 0.035,
                   taper=0.15, bevel=0.007, mat='paint_primary')
    back.rotate((0, -90, 0)).move(-0.18, -2.42, -0.19)
    g.merge(back)
    g.merge(P.bolt_row((-0.215, -2.33, -0.05), (-0.215, -2.52, -0.05), 3, (-1, 0, 0), r=0.01))
    # wrist link from the forearm ring to the palm
    link = P.box((0.2, 0.2, 0.26), bevel=0.012, segs=2, chamfer=0.03, chamfer_axes='Y', mat='steel_dark')
    link.rotate((18, 0, 0)).move(-0.1, -2.25, -0.08)
    g.merge(link)
    g.merge(P.cylinder(0.075, 0.26, 32, bevel=0.01, mat='steel').rotate((0, 90, 0)).move(-0.08, -2.3, -0.03))
    # four fingers wrapping the grip (grip centre x=0, y=-2.48)
    for i, z in enumerate((-0.07, -0.155, -0.24, -0.325)):
        h = 0.07
        p1 = P.box((0.06, 0.14, h), bevel=0.01, segs=2, mat='steel_dark').move(-0.1, -2.58, z)
        k1 = P.cylinder(0.037, h * 1.1, 24, bevel=0.006, mat='steel').move(-0.1, -2.66, z)
        p2 = P.box((0.15, 0.06, h), bevel=0.01, segs=2, mat='paint_primary').move(-0.02, -2.66, z)
        k2 = P.cylinder(0.035, h * 1.1, 24, bevel=0.006, mat='steel').move(0.06, -2.66, z)
        p3 = P.box((0.055, 0.1, h * 0.95), bevel=0.01, segs=2, mat='steel_dark').move(0.075, -2.6, z)
        g.merge(p1, k1, p2, k2, p3)
    # thumb over the top of the grip toward the inner side
    t1 = P.box((0.16, 0.07, 0.07), bevel=0.01, segs=2, mat='paint_primary').move(-0.02, -2.36, 0.0)
    tk = P.cylinder(0.036, 0.08, 24, bevel=0.006, mat='steel').move(0.07, -2.36, 0.0)
    t2 = P.box((0.06, 0.13, 0.065), bevel=0.01, segs=2, mat='steel_dark').move(0.09, -2.44, 0.0)
    g.merge(t1, tk, t2)
    return g


# =============================================================================== rifle
def build_rifle(rng):
    g = Geo()
    y0, y1 = -2.27, -3.55
    # receiver: angular side profile extruded across X, seams, ejection port, armour
    rec = P.prism([(y0, 0.02), (y1, 0.02), (y1, 0.34), (y1 + 0.2, 0.46), (y0 - 0.18, 0.46), (y0, 0.3)], 0.3,
                  bevel=0.014, segs=3, mat='paint_primary', axis='X')
    for y in (-2.62, -3.12):
        faces = rec.faces_facing((1, 0, 0), 5) + rec.faces_facing((-1, 0, 0), 5) + rec.faces_facing((0, 0, 1), 5)
        rec.groove_cut(faces, (0, y, 0), (0, 1, 0), gap=0.012, depth=0.01)
    f = pick(rec, (-1, 0, 0), -3.1, -2.64)
    rec.hatch(f, (-0.15, -2.87, 0.26), (0.3, 0.1), gap=0.01, recess=0.035, mat='steel_dark', u_axis=(0, 1, 0))
    armour = []
    for n in ((-1, 0, 0), (1, 0, 0)):
        f = pick(rec, n, -3.53, -3.14)
        if f is not None:
            armour.append(P.armor_on_face(rec, f, margin=0.025, thickness=0.03, taper=0.12, chamfer=0.035,
                                          mat='paint_primary', u_axis=(0, -1, 0), bolts=1, bolt_r=0.01))
    f = pick(rec, (1, 0, 0), -3.1, -2.64)
    if f is not None:
        armour.append(P.armor_on_face(rec, f, margin=0.025, thickness=0.03, taper=0.12, chamfer=0.035,
                                      mat='paint_secondary', u_axis=(0, -1, 0), bolts=1, bolt_r=0.01))
    g.merge(rec, *armour)
    # lower receiver / trigger housing (dark)
    g.merge(P.box((0.26, 0.62, 0.08), bevel=0.01, segs=2, mat='steel_dark').move(0, -2.7, -0.02))
    # pistol grip into the fist
    grip = P.box((0.13, 0.15, 0.46), bevel=0.02, segs=3, chamfer=0.025, chamfer_axes='Z', mat='rubber')
    grip.rotate((-10, 0, 0)).move(0, -2.47, -0.2)
    g.merge(grip)
    # magazine (angled box mag, ribs, accent base plate)
    mag = P.prism([(-2.83, 0.0), (-3.2, 0.0), (-3.26, -0.46), (-2.93, -0.46)], 0.22, bevel=0.012, segs=2,
                  mat='paint_dark', axis='X')
    for y in (-2.95, -3.02, -3.09):
        f = mag.faces_facing((1, 0, 0), 5) + mag.faces_facing((-1, 0, 0), 5)
        mag.groove_cut(f, (0, y, 0), (0, 1, 0.12), gap=0.012, depth=0.008)
    g.merge(mag)
    g.merge(P.box((0.26, 0.37, 0.04), bevel=0.008, segs=2, mat='paint_accent').move(0, -3.095, -0.475))
    # top rail with cross slots
    g.merge(P.box((0.13, 1.0, 0.035), bevel=0.006, segs=2, mat='steel_dark').move(0, -2.9, 0.478))
    for i in range(16):
        g.merge(P.box((0.15, 0.028, 0.022), bevel=0.004, segs=1, mat='steel_dark').move(0, -2.45 - i * 0.058, 0.5))
    # optic / sensor block on the rail
    sc = P.sensor_cluster(0.26, 0.14, 0.26, lenses=((-0.06, 0.0, 0.036), (0.055, 0.0, 0.026)), slit=True,
                          mat='paint_dark')
    g.merge(sc.move(0, -2.62, 0.6))
    g.merge(P.box((0.18, 0.24, 0.06), bevel=0.008, segs=2, chamfer=0.015, chamfer_axes='Y', mat='steel_dark')
            .move(0, -2.74, 0.52))
    # barrel shroud: octagon with side vent slots, clamp rings, ridged heat shield on top
    oc = [(math.cos(a) * 0.15, math.sin(a) * 0.15 + 0.2) for a in [math.pi / 8 + i * math.pi / 4 for i in range(8)]]
    sh = P.loft([(oc, y1 + 0.02), (oc, -4.62)], bevel=0.01, segs=2, mat='paint_primary')
    for sgn in (-1, 1):
        for k in range(4):
            yy = -3.8 - k * 0.2
            f = sh.largest_face((sgn, 0, 0), 5)
            sh.hatch(f, (sgn * 0.14, yy, 0.2), (0.13, 0.07), gap=0.008, recess=0.03, mat='steel_dark',
                     u_axis=(0, 1, 0))
    g.merge(sh)
    oc2 = [(x * 1.13, (z - 0.2) * 1.13 + 0.2) for x, z in oc]
    for y in (-3.6, -4.55):
        g.merge(P.loft([(oc2, y + 0.03), (oc2, y - 0.03)], bevel=0.006, segs=2, mat='steel_dark'))
        g.merge(P.bolt_row((-0.17, y, 0.2), (-0.17, y, 0.2), 1, (-1, 0, 0), r=0.012))
        g.merge(P.bolt_row((0.17, y, 0.2), (0.17, y, 0.2), 1, (1, 0, 0), r=0.012))
    hs = P.plate(P.fillet([(-0.1, -0.44), (0.1, -0.44), (0.1, 0.44), (-0.1, 0.44)], 0.03, 1), 0.03, taper=0.2,
                 ridge=0.02, ridge_axis='Y', bevel=0.006, mat='paint_secondary')
    g.merge(hs.move(0, -4.08, 0.345))
    # gas / coolant line along the right of the shroud
    g.merge(P.pipe_run([(-0.13, -3.62, 0.33), (-0.13, -4.5, 0.33)], 0.016, segs=16, mat='steel', flanges=True))
    # barrel + radial cooling fins + hazard band + muzzle brake
    g.merge(P.cylinder(0.058, 0.64, 48, bevel=0.006, mat='steel_dark', z0=0.0).align((0, -1, 0), loc=(0, -4.61, 0.2)))
    for k in range(5):
        g.merge(P.ring(0.095, 0.05, 0.014, 48, bevel=0.003, bsegs=1, mat='steel', z0=0.0)
                .align((0, -1, 0), loc=(0, -4.68 - k * 0.045, 0.2)))
    g.merge(P.ring(0.075, 0.05, 0.08, 48, bevel=0.006, mat='hazard', z0=0.0).align((0, -1, 0), loc=(0, -4.95, 0.2)))
    mb = P.box((0.2, 0.3, 0.17), bevel=0.012, segs=2, chamfer=0.03, chamfer_axes='Y', mat='steel_dark')
    mb.move(0, -5.37, 0.2)
    for k in range(3):
        cut = P.box((0.4, 0.045, 0.08), bevel=0.0, segs=1, mat='steel').move(0, -5.28 - k * 0.07, 0.2)
        mb.boolean(cut)
    bore = P.cylinder(0.035, 0.4, 32, bevel=0.0, mat='steel_dark').align((0, -1, 0), loc=(0, -5.3, 0.2))
    mb.boolean(bore)
    g.merge(mb)
    # charging handle, bolts, rear buffer, power cell with feed hose
    g.merge(P.box((0.05, 0.12, 0.05), bevel=0.008, segs=2, mat='steel').move(0.17, -2.5, 0.35))
    g.merge(P.cylinder(0.03, 0.06, 24, bevel=0.006, mat='rubber').rotate((0, 90, 0)).move(0.22, -2.5, 0.35))
    g.merge(P.bolt_row((-0.152, -2.4, 0.1), (-0.152, -3.45, 0.1), 8, (-1, 0, 0), r=0.011))
    g.merge(P.cylinder(0.09, 0.06, 32, bevel=0.01, mat='steel_dark', z0=0.0).align((0, 1, 0), loc=(0, -2.27, 0.2)))
    cell = P.banded_cylinder([(0.03, 0.06, 'steel_dark'), (0.26, 0.072), (0.02, 0.066, 'steel_dark'), (0.06, 0.072, 'hazard'),
                              (0.03, 0.055, 'steel')], segs=40, step=0.005, mat='paint_dark')
    g.merge(cell.align((0, -1, 0), loc=(0.23, -2.66, 0.12)))
    g.merge(P.box((0.08, 0.3, 0.04), bevel=0.006, segs=2, mat='steel_dark').move(0.18, -2.8, 0.12))
    g.merge(P.hose([(0.23, -3.05, 0.12), (0.26, -3.15, 0.2), (0.16, -3.25, 0.27)], 0.018, 10, rib_amp=0.003,
                   rib_freq=40.0))
    return g


# =============================================================================== thruster pack
def build_booster():
    g = Geo()
    x0, x1 = -0.39, -0.75
    xc = (x0 + x1) / 2
    body = P.loft([([(x0, -0.24), (x1, -0.24), (x1, 0.24), (x1 + 0.1, 0.34), (x0, 0.34)], -0.16),
                   ([(x0, -0.22), (x1 + 0.02, -0.22), (x1 + 0.02, 0.22), (x1 + 0.1, 0.3), (x0, 0.3)], -0.98)],
                  bevel=0.014, segs=3, mat='paint_primary', axis='Y')
    body.groove_cut(body.faces_facing((0, 0, 1), 10) + body.faces_facing((-1, 0, 1), 20), (0, -0.33, 0), (0, 1, 0),
                    gap=0.012, depth=0.01)
    top = pick(body, (0, 0, 1), -0.95, -0.36, angle=10)
    if top is not None:
        body.hatch(top, (xc + 0.03, -0.62, 0.33), (0.18, 0.4), gap=0.012, recess=0.03, mat='steel_dark',
                   u_axis=(1, 0, 0))
    front = body.largest_face((0, -1, 0), 10)
    armour = []
    if front is not None:
        armour.append(P.armor_on_face(body, front, margin=0.03, thickness=0.035, taper=0.12, chamfer=0.04,
                                      mat='paint_secondary', u_axis=(1, 0, 0), bolts=1, bolt_r=0.011))
    g.merge(body, *armour)
    gr = P.grille(0.16, 0.36, bars=10, bar_r=0.008, frame=0.012, depth=0.02, mat='steel_dark')
    g.merge(gr.move(xc + 0.03, -0.62, 0.3))
    # heat-shield louvres on the outer face
    lv = P.louvres(0.66, 0.4, count=6, depth=0.05, angle=24, thickness=0.016, mat='steel_dark',
                   side_mat='paint_primary')
    lv.rotate((0, 0, 90)).rotate((0, -90, 0)).move(x1, -0.58, -0.01)
    g.merge(lv)
    # accent stripe along the top-outer chamfer
    g.merge(P.box((0.03, 0.56, 0.03), bevel=0.006, segs=1, mat='paint_accent').move(x1 + 0.06, -0.66, 0.3)
            .rotate((0, 0, 0)))
    # mounting brackets to the forearm
    for y in (-0.3, -0.85):
        br = P.box((0.1, 0.12, 0.34), bevel=0.01, segs=2, chamfer=0.02, chamfer_axes='Y', mat='steel_dark')
        g.merge(br.move(x0 + 0.02, y, 0.02))
        g.merge(P.bolt_row((x0 - 0.035, y, 0.12), (x0 - 0.035, y, -0.08), 3, (-1, 0, 0), r=0.012))
    # rear nozzle plate (heat shield) with bolt frame
    g.merge(P.box((0.38, 0.05, 0.58), bevel=0.012, segs=2, chamfer=0.03, chamfer_axes='Y', mat='steel_dark')
            .move(xc, -0.14, 0.04))
    g.merge(P.bolt_row((xc - 0.16, -0.113, 0.3), (xc + 0.16, -0.113, 0.3), 5, (0, 1, 0), r=0.01))
    g.merge(P.bolt_row((xc - 0.16, -0.113, -0.22), (xc + 0.16, -0.113, -0.22), 5, (0, 1, 0), r=0.01))
    return g


def nozzle_geo():
    nz = P.nozzle(r_throat=0.075, r_exit=0.125, length=0.24, segs=40, wall=0.014, bolts=8, ribs=2, gimbal=True)
    nz.rotate((90, 0, 0))   # exhaust -Z -> +Y (rearward)
    return nz


# =============================================================================== main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=2048)
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--quick', action='store_true', help='1024 atlas, 24 spp previews')
    ap.add_argument('--reuse-bakes', action='store_true')
    ap.add_argument('--seg-scale', type=float, default=0.75, help='round-part resolution (LOD) scale')
    ap.add_argument('--views', default='hero,front,rear,close,hand')
    ap.add_argument('--debug-mask', default='', help="e.g. masks.0 | wear | grime: render that map unlit")
    args = ap.parse_args([a for a in sys.argv[1:] if a != '--'] if '--' not in sys.argv else
                         sys.argv[sys.argv.index('--') + 1:])
    if args.quick:
        args.res, args.samples = 1024, 24
    P.SEG_SCALE = args.seg_scale
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    iw.reset_scene()
    a = iw.Asset('sample', seed=7, scheme='player', res=args.res, kind='mech_part')
    rng = a.rng.fork('greebles')

    # node contract (src/mech/rig.js): forearm_R (elbow) > hand_R (wrist) > weapon_R > muzzle_R
    fa = a.pivot('forearm_R', (0, 0, 0))
    hd = a.pivot('hand_R', (0, -2.2, 0), parent=fa)
    wp = a.pivot('weapon_R', (0, -2.47, -0.2), parent=hd)
    a.muzzle('muzzle_R', (0, -5.55, 0.2), fire=(0, -1, 0), parent=wp)
    bo = a.pivot('booster_R', (-0.57, -0.14, 0.04), parent=fa)
    # nozzle_* nodes at the nozzle EXIT centre; exhaust = local -Z in glTF (rearward here)
    nozzles = [a.nozzle(f'nozzle_R_{i}', (-0.57, 0.10, z), exhaust=(0, 1, 0), parent=bo) for i, z in
               enumerate((0.15, -0.09))]

    with iw.timed('model'):
        g = build_forearm(rng)
        n = g.cull_inside()
        iw.log(f'forearm: culled {n} hidden faces')
        a.part('forearm_R_geo', g, parent=fa)
        h = build_hand()
        h.cull_inside()
        a.part('hand_R_geo', h, parent=hd)
        r = build_rifle(rng)
        n = r.cull_inside()
        iw.log(f'rifle: culled {n} hidden faces')
        a.part('weapon_R_geo', r, parent=wp)
        b = build_booster()
        b.cull_inside()
        a.part('booster_R_geo', b, parent=bo)
        for i, nzp in enumerate(nozzles):
            loc = nzp.matrix_world.translation
            ng = nozzle_geo().move(loc.x, -0.14, loc.z)
            ng.cull_inside()
            a.part(f'nozzle_R_{i}_geo', ng, parent=nzp)

    # decals (baked into the atlas; paint materials only)
    a.decal(D.emblem(), (-0.4, -1.37, 0.05), (-1, 0, 0), up=(0, 0, 1), size=(0.3, 0.3))
    a.decal(D.text_decal('07', px=220, color=D.BLACK, worn=0.35), (0.02, -1.36, 0.5), (0, 0, 1), up=(0, -1, 0),
            size=(0.17, None))
    a.decal(D.text_decal(['MAX 40t', '荷重注意'], px=110, color=D.BONE), (-0.1, -0.47, 0.44), (0, 0, 1),
            up=(0, -1, 0), size=(0.19, None))
    a.decal(D.warning_label('HOT', '高温注意', ('EXHAUST ZONE', '排気口付近立入禁止'), w=720), (-0.57, -1.03, 0.04),
            (0, -1, 0), up=(0, 0, 1), size=(0.24, None))
    a.decal(D.text_decal('R-07', px=160, color=D.BONE, worn=0.3), (-0.39, -1.82, 0.04), (-1, 0, 0), up=(0, 0, 1),
            size=(0.2, None))
    a.decal(D.serial_plate(('RIG-07  FA-R MK3', 'LOT 0417-C  MAX 40t')), (0.45, -0.3, 0.05), (1, 0, 0),
            up=(0, 0, 1), size=(0.2, None))
    a.decal(D.text_decal(['IW-R7', '7.2x80 AP'], px=120, color=D.BONE, worn=0.3), (-0.19, -3.33, 0.2), (-1, 0, 0),
            up=(0, 0, 1), size=(0.18, None))
    a.decal(D.hazard_decal(512, 96), (-0.151, -2.95, 0.4), (-1, 0, 0), up=(0, 0, 1), size=(0.34, None))
    a.decal(D.arrow_decal(text='LIFT'), (0.26, -0.47, 0.44), (0, 0, 1), up=(1, 0, 0), size=(0.14, None))
    a.decal(D.text_decal('DANGER', px=90, color=D.RED, worn=0.2), (-0.4, -0.87, 0.04), (-1, 0, 0), up=(0, 0, 1),
            size=(0.14, None), opacity=0.9)
    a.decal(D.text_decal('07', px=200, color=D.BLACK, worn=0.3), (0.19, -3.33, 0.2), (1, 0, 0), up=(0, 0, 1),
            size=(0.1, None))

    st = a.stats()
    iw.log(f"model: {st['tris']} tris in {st['parts']} parts")
    a.unwrap(angle=60.0)
    cov, ovl = iw.uv.coverage(a.bake_objects(), 512)
    iw.log(f'uv coverage {cov:.1%}, cross-part overlap {ovl:.2%}')
    maps = a.bake(edge=0.03, cavity=0.07, ao_dist=0.7, bevel_radius=0.012, reuse=args.reuse_bakes)
    shutil.copy(os.path.join(a.work, 'sample_maps_sheet.png'), os.path.join(OUT, 'sample_maps.png'))

    glb = os.path.join(OUT, 'sample.glb')
    size = a.export_glb(glb, image_format='JPEG', quality=88, compress=True)
    fbx = a.export_fbx(os.path.join(OUT, 'SM_sample.fbx'))
    rep = iw.export.glb_report(glb)
    need = ['root', 'forearm_R', 'hand_R', 'weapon_R', 'muzzle_R', 'booster_R', 'nozzle_R_0', 'nozzle_R_1']
    missing = [n for n in need if n not in rep['nodes']]
    rep['contract_nodes_missing'] = missing
    iw.log('GLB contract nodes:', 'OK' if not missing else f'MISSING {missing}')
    iw.log('GLB nodes:', rep['nodes'])
    iw.log('GLB ext:', rep['extensionsUsed'], 'images:', rep['images'])

    previews = []
    if args.debug_mask:
        for mname in args.debug_mask.split(','):
            a.show_mask(mname)
            iw.preview.studio(a.parts)
            iw.preview.camera(a.parts, azimuth=-50, elevation=18, lens=50, fill=0.9)
            iw.preview.render(os.path.join(a.work, f'debug_{mname}.png'), res=(1280, 720), samples=8, denoise=False)
        return
    if not args.no_render:
        objs = a.parts
        iw.preview.studio(objs)
        views = {
            'hero': dict(azimuth=-128, elevation=20, lens=50, fill=0.9),
            'front': dict(azimuth=-40, elevation=16, lens=50, fill=0.9),
            'rear': dict(azimuth=140, elevation=26, lens=50, fill=0.9),
            'close': dict(azimuth=-118, elevation=24, lens=70, fill=3.0, target=(-0.35, -0.75, 0.1)),
            'hand': dict(azimuth=-50, elevation=12, lens=70, fill=2.6, target=(0.0, -2.6, 0.05)),
        }
        for name in args.views.split(','):
            v = views[name]
            iw.preview.camera(objs, **v)
            p = os.path.join(OUT, f'sample_preview_{name}.png')
            iw.preview.render(p, res=(1280, 720), samples=args.samples)
            previews.append(p)

    rep_all = a.report({'glb_bytes': size, 'glb': rep, 'fbx': fbx, 'previews': previews,
                        'total_s': round(time.time() - t0, 1)})
    with open(os.path.join(OUT, 'sample_report.json'), 'w') as f:
        json.dump(rep_all, f, indent=1, ensure_ascii=False)
    iw.log('REPORT', json.dumps({k: rep_all[k] for k in ('tris', 'texel_density_px_per_m', 'glb_bytes', 'total_s')}))


if __name__ == '__main__':
    main()
    # bpy 4.2 can segfault while tearing down in background mode; everything is written
    # already, so exit hard with a clean status.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
