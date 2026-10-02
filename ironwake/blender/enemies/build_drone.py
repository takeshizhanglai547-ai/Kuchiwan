"""GNAT - Grauwerk Consolidated Security twin-duct attack drone (owner: enemy modeler).

A ~2.5 m span hornet-bodied drone: an armoured wedge fuselage with ONE big red sensor eye
in a hooded nose bezel (plus two small auxiliary lenses), twin ducted fans on stub pylons
(airfoil duct rings with hazard lips, stators, motor pods, 5-blade rotors), an underslung
pulse emitter with capacitor rings, a battery pack with V-tail stabilisers and a whip
antenna on the back, skid feet underneath.

    python3 blender/enemies/build_drone.py --blockout [--views a,b]
    python3 blender/enemies/build_drone.py [--quick]

Node contract (src/enemies/models.js): root > body > {body_geo, eye > eye_geo, muzzle,
rotor > rotor_geo, rotor_1 > rotor_1_geo}. Every node named rotor* spins about glTF +Y;
rotors carry the extra iw_r (blade radius) for the blur disc.
Blender coords: +Z up, faces -Y, so the drone's RIGHT is -X. Origin = body centre.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ekit as K  # noqa: E402
from ekit import D, Geo, P, iw  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

NAME = 'enemy_drone'
DUCT_X, DUCT_Y, DUCT_Z = 0.80, 0.02, 0.06
DUCT_TILT = 12.0   # deg: both fans pitched forward (intakes face forward-up: attack posture)


def tilted(g, s):
    """Pitch duct/rotor geometry authored level about the duct centre on side s."""
    c = (s * DUCT_X, DUCT_Y, DUCT_Z)
    return g.move(-c[0], -c[1], -c[2]).rotate((DUCT_TILT, 0, 0)).move(*c)
R_IN, R_OUT = 0.40, 0.49
EYE = (0.0, -0.88, 0.0)
MUZZLE = (0.0, -1.2, -0.37)

# fuselage sections along Y: (y, x0, x1, z0, z1, chamfers (bl, br, tr, tl))
BODY = [(-0.86, -0.2, 0.2, -0.13, 0.12, (0.05, 0.05, 0.06, 0.06)),
        (-0.62, -0.33, 0.33, -0.25, 0.23, (0.09, 0.09, 0.11, 0.11)),
        (-0.12, -0.42, 0.42, -0.3, 0.3, (0.12, 0.12, 0.14, 0.14)),
        (0.42, -0.38, 0.38, -0.26, 0.27, (0.11, 0.11, 0.13, 0.13)),
        (0.8, -0.24, 0.24, -0.14, 0.16, (0.06, 0.06, 0.08, 0.08))]


def body_z1(y):
    for i in range(len(BODY) - 1):
        a, b = BODY[i], BODY[i + 1]
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return a[4] + (b[4] - a[4]) * t, a[2] + (b[2] - a[2]) * t
    return BODY[-1][4], BODY[-1][2]


def build_body():
    B = K.Budget('body')
    g = Geo()
    sh = K.shell(BODY, 'Y', bevel=0.014, mat='paint_primary')
    K.grooves(sh, [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (1, 0, 1), (-1, 0, 1)], (0, 0.14, 0), (0, 1, 0), gap=0.012,
              depth=0.01, angle=35)
    K.grooves(sh, [(1, 0, 0), (-1, 0, 0), (0, 0, -1)], (0, -0.4, 0), (0, 1, 0.2), gap=0.012, depth=0.01, angle=35)
    K.hatch_at(sh, (0.0, 0.3, -0.26), (0, 0, -1), (0.3, 0.3), u_axis=(1, 0, 0), gap=0.01, recess=0.02, mat='steel_dark')
    g.merge(B.add('shell', sh))
    # dorsal spine armour (cream, ridged) and side cheek plates (oxide)
    z_a, _ = body_z1(-0.5)
    z_b, _ = body_z1(0.5)
    g.merge(B.add('armour', K.plate_world([(-0.2, -0.52, z_a + 0.004), (0.2, -0.52, z_a + 0.004),
                                           (0.22, 0.46, z_b + 0.004), (-0.22, 0.46, z_b + 0.004)], 0.04,
                                          mat='paint_secondary', normal_hint=(0, 0, 1), chamfer=0.06, ridge=0.025,
                                          ridge_axis='Y', bolts=1, bolt_r=0.012, bolt_spacing=0.24)))
    for s in (1, -1):
        x = s * 0.424
        pts = [(x, -0.08, -0.16), (x, 0.36, -0.14), (x, 0.36, 0.16), (x, -0.08, 0.2)]
        if s < 0:
            pts = pts[::-1]
        g.merge(B.add('armour', K.plate_world(pts, 0.03, mat='paint_secondary', normal_hint=(s, 0, 0), chamfer=0.04,
                                              bolts=1, bolt_r=0.011, bolt_spacing=0.2)))
        # yellow ID flash along the upper cheek (Grauwerk unit band)
        g.merge(B.add('stripe', K.strip((s * 0.36, -0.6, 0.17), (s * 0.41, -0.1, 0.25), 0.09, 0.008,
                                        (s, 0, 0.6), mat='paint_accent')))
        # nose cheek chevrons (hazard) either side of the sensor hood
        g.merge(B.add('stripe', K.strip((s * 0.2, -0.82, -0.02), (s * 0.3, -0.62, 0.14), 0.06, 0.008,
                                        (s, -0.5, 0.3), mat='hazard')))
    # nose bezel: armoured ring around the eye (the lens is the `eye` node), recessed only
    # 4 cm so the lens reads from 45 deg off-axis, under a cream sun hood with the ID stripe
    ex, ey, ez = EYE
    bez = P.ring(0.165, 0.102, 0.1, 40, bevel=0.012, bsegs=1, mat='paint_dark', z0=0.0).align((0, -1, 0),
                                                                                            loc=(ex, ey + 0.015, ez))
    g.merge(B.add('bezel', bez))   # sits proud of the nose cap (y -0.86): the cap is the recess floor
    g.merge(B.add('bezel', P.ring(0.112, 0.094, 0.025, 40, bevel=0.0, mat='steel', z0=0.0)
                  .align((0, -1, 0), loc=(ex, ey + 0.005, ez))))   # bright machined inner lip
    g.merge(B.add('bezel', P.bolt_circle((ex, ey - 0.085, ez), (0, -1, 0), 0.135, 6, r=0.011)))
    hood = P.prism([(-0.12, 0.12), (0.22, 0.2), (0.26, 0.27), (-0.17, 0.205)], 0.44, bevel=0.012, segs=1,
                   mat='paint_secondary', axis='X').move(0, ey - 0.02, ez)
    g.merge(B.add('bezel', hood))
    g.merge(B.add('bezel', K.strip((-0.2, ey - 0.12, ez + 0.214), (0.2, ey - 0.12, ez + 0.214), 0.05, 0.006,
                                   (0, -0.15, 1), mat='paint_accent')))
    for s in (1, -1):   # mandible guards flanking the eye (hornet read, protects the lens)
        md = P.prism([(0.3, 0.1), (-0.14, 0.02), (-0.2, -0.08), (-0.1, -0.16), (0.3, -0.12)], 0.05, bevel=0.008,
                     segs=1, mat='paint_dark', axis='X')
        g.merge(B.add('bezel', md.rotate((0, 0, s * 10)).move(s * 0.2, ey, ez - 0.02)))
    for s in (1, -1):   # auxiliary lens pods
        g.merge(B.add('aux', P.box((0.09, 0.08, 0.08), bevel=0.01, segs=1, mat='paint_dark')
                      .move(s * 0.22, ey + 0.24, ez - 0.1)))
    # ducted-fan pylons: tapered wing stubs from the body sides to the duct rings
    for s in (1, -1):
        py = P.loft([(P.rect(0.34, 0.1), s * 0.3), (P.rect(0.3, 0.08), s * (DUCT_X - R_OUT + 0.04))], bevel=0.01,
                    segs=1, mat='paint_primary', axis='X', corner=0.025, corner_segs=1)
        g.merge(B.add('pylon', py.move(0, DUCT_Y, DUCT_Z - 0.02)))
        g.merge(B.add('pylon', K.tube([(s * 0.36, DUCT_Y + 0.12, DUCT_Z + 0.06), (s * 0.5, DUCT_Y + 0.14, DUCT_Z + 0.08),
                                       (s * (DUCT_X - R_OUT + 0.02), DUCT_Y + 0.12, DUCT_Z + 0.06)], 0.018, 8,
                                      mat='rubber', subdiv=3)))
        g.merge(B.add('duct', build_duct(s)))
        # tilt actuator: drum on the pylon root of the duct (the fan pitches about it) + a link arm
        hx = s * (DUCT_X - R_OUT - 0.05)
        g.merge(B.add('pylon', K.drum((hx, DUCT_Y, DUCT_Z - 0.01), (1, 0, 0), 0.085, 0.09, mat='paint_dark', hub=False,
                                      segs=20, profile='ring', accent='paint_accent')))
        g.merge(B.add('pylon', K.ram((s * 0.36, DUCT_Y + 0.16, DUCT_Z - 0.1), (hx - s * 0.02, DUCT_Y + 0.1, DUCT_Z - 0.06),
                                     r=0.022, frac=0.55, segs=12)))
    # underslung pulse emitter (energy gun): capacitor rings + heat shroud + emitter nozzle
    mx_, my, mz = MUZZLE
    g.merge(B.add('gun', P.box((0.2, 0.44, 0.14), bevel=0.014, segs=1, chamfer=0.03, chamfer_axes='Y',
                               mat='paint_dark').move(0, -0.42, -0.3)))
    g.merge(B.add('gun', P.cylinder(0.07, 0.5, 32, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                  .align((0, -1, 0), loc=(0, -0.62, mz))))
    for k in range(3):
        g.merge(B.add('gun', P.ring(0.09, 0.068, 0.04, 32, bevel=0.0, mat='steel', z0=0.0)
                      .align((0, -1, 0), loc=(0, -0.7 - k * 0.1, mz))))
    g.merge(B.add('gun', P.cone(0.075, 0.05, 0.1, 32, bevel=0.006, mat='steel_dark').align((0, -1, 0),
                                                                                       loc=(0, -1.1, mz))))
    g.merge(B.add('gun', P.ring(0.055, 0.035, 0.03, 32, bevel=0.0, mat='hazard', z0=0.0)
                  .align((0, -1, 0), loc=(0, -1.18, mz))))
    g.merge(B.add('gun', P.cylinder(0.036, 0.02, 16, bevel=0.0, mat='lens', z0=0.0).align((0, -1, 0),
                                                                                       loc=(0, -1.165, mz))))
    # back: battery pack with hazard band, V-tail stabilisers, antenna
    g.merge(B.add('pack', P.box((0.36, 0.3, 0.2), bevel=0.014, segs=1, chamfer=0.04, chamfer_axes='Y',
                                mat='paint_dark').move(0, 0.72, 0.1)))
    g.merge(B.add('pack', K.strip((-0.17, 0.87, 0.06), (0.17, 0.87, 0.06), 0.07, 0.008, (0, 1, 0), mat='hazard')))
    for s in (1, -1):
        fin = P.prism([(0.62, 0.0), (0.98, 0.0), (1.04, 0.34), (0.86, 0.34)], 0.03, bevel=0.006, segs=1,
                      mat='paint_primary', axis='X')
        fin.rotate((0, s * 48, 0)).move(s * 0.14, 0, 0.1)
        g.merge(B.add('fins', fin))
    g.merge(B.add('antenna', K.whip(0.55, r=0.006, base_r=0.022).move(-0.12, 0.62, 0.2)))
    # rear vectoring thrusters (manoeuvre jets) on the battery pack
    for s in (1, -1):
        bl = K.bell(0.045, 0.07, 0.12, segs=24, collar=False, bolts=0, ribs=0)
        g.merge(B.add('jets', bl.align((0, 1, -0.25), up=(0, 0, 1), loc=(s * 0.12, 0.87, 0.06))))
        g.merge(B.add('jets', P.box((0.12, 0.08, 0.12), bevel=0.01, segs=1, mat='steel_dark').move(s * 0.12, 0.86, 0.07)))
    # belly energy cells (hazard-banded canisters) along the lower flanks
    for s in (1, -1):
        cell = P.banded_cylinder([(0.04, 0.07, 'steel_dark'), (0.3, 0.075), (0.05, 0.078, 'hazard'), (0.12, 0.075),
                                  (0.04, 0.06, 'steel')], segs=24, step=0.0, mat='paint_dark')
        g.merge(B.add('cells', cell.align((0, -1, 0), up=(0, 0, 1), loc=(s * 0.25, 0.32, -0.28))))
        for y in (0.2, -0.08):
            g.merge(B.add('cells', P.box((0.18, 0.04, 0.05), bevel=0.006, segs=1, mat='steel_dark')
                          .move(s * 0.25, y, -0.2)))
    # dorsal sensor spine: small mast with two blade antennas
    g.merge(B.add('mast', P.box((0.08, 0.2, 0.1), bevel=0.01, segs=1, chamfer=0.02, chamfer_axes='Y',
                                mat='paint_dark').move(0.12, 0.3, 0.32)))
    for s in (1, -1):
        fin = P.prism([(0.0, 0.0), (0.16, 0.0), (0.04, 0.2)], 0.012, bevel=0.002, segs=1, mat='steel_dark', axis='X')
        g.merge(B.add('mast', fin.move(-0.12 + s * 0.025, 0.36, 0.3)))
    # belly: sensor dome + two skid feet
    g.merge(B.add('belly', P.dome(0.08, 0.06, 24, 4, mat='lens').rotate((180, 0, 0)).move(0, -0.1, -0.3)))
    g.merge(B.add('belly', P.ring(0.1, 0.08, 0.03, 24, bevel=0.0, mat='steel_dark', z0=-0.03).move(0, -0.1, -0.29)))
    for s in (1, -1):
        g.merge(B.add('skids', P.box((0.04, 0.05, 0.2), bevel=0.008, segs=1, mat='steel_dark')
                      .rotate((0, s * 18, 0)).move(s * 0.24, 0.12, -0.36)))
        g.merge(B.add('skids', P.box((0.05, 0.5, 0.035), bevel=0.01, segs=1, mat='rubber')
                      .move(s * 0.28, 0.12, -0.46)))
    B.report()
    return g


def build_duct(s):
    """Airfoil duct ring: rolled inner intake lip, dirty-cream upper skin with hazard chevrons,
    oxide lower skin with stiffener ribs, 8 cambered stator vanes and the motor pod below the
    fan (visible from underneath)."""
    g = Geo()
    prof = [(R_IN + 0.012, -0.15, 0.0), (R_OUT - 0.02, -0.15, 0.02), (R_OUT, -0.1, 0.02), (R_OUT, -0.03, 0.0),
            (R_OUT, 0.035, 0.0), (R_OUT, 0.1, 0.02),
            (R_OUT - 0.03, 0.16, 0.02), (R_IN + 0.06, 0.2, 0.03), (R_IN - 0.005, 0.15, 0.03), (R_IN - 0.012, 0.08, 0.0),
            (R_IN, -0.08, 0.0)]
    pr = P.fillet(prof, 0.025, 2, closed=True)
    pr.append(pr[0])
    duct = P.lathe(pr, 48, 'paint_primary')
    import bmesh
    bmesh.ops.remove_doubles(duct.bm, verts=list(duct.bm.verts), dist=1e-6)
    duct.bm.normal_update()
    hz = duct.mi('hazard')
    sd = duct.mi('steel_dark')
    cr = duct.mi('paint_secondary')
    for f in duct.bm.faces:   # cream upper skin + rolled lip, hazard chevron band, dark inner wall
        c = f.calc_center_median()
        rad = math.hypot(c.x, c.y)
        if rad < R_IN + 0.02 and c.z < 0.12:
            f.material_index = sd
        elif rad > R_OUT - 0.008 and -0.03 < c.z < 0.035:
            f.material_index = hz
        elif c.z > 0.1:
            f.material_index = cr
    duct.move(s * DUCT_X, DUCT_Y, DUCT_Z)
    g.merge(duct)
    # lower outer band
    g.merge(P.ring(R_OUT + 0.012, R_OUT - 0.01, 0.05, 48, bevel=0.0, mat='steel_dark', z0=-0.13)
            .move(s * DUCT_X, DUCT_Y, DUCT_Z))
    # 8 cambered stator vanes below the rotor (straighten the swirl; read from below)
    for k in range(8):
        a = math.radians(22.5 + k * 45)
        st = P.box((R_IN * 0.8, 0.012, 0.09), bevel=0.003, segs=1, mat='steel_dark')
        st.rotate((18, 0, 0)).move(R_IN * 0.52, 0, 0).rotate((0, 0, math.degrees(a)))
        g.merge(st.move(s * DUCT_X, DUCT_Y, DUCT_Z - 0.08))
    # intake guard: parallel bars across the duct mouth
    for k in range(5):
        off = (k - 2) * 0.16
        half = math.sqrt(max(0.0, (R_IN + 0.04) ** 2 - off * off))
        bar = P.cylinder(0.011, half * 2, 8, bevel=0.0, mat='steel_dark').rotate((90, 0, 0))
        g.merge(bar.move(s * DUCT_X + off, DUCT_Y, DUCT_Z + 0.22))
    g.merge(P.ring(R_IN + 0.06, R_IN + 0.03, 0.02, 48, bevel=0.0, mat='steel_dark', z0=DUCT_Z + 0.21)
            .move(s * DUCT_X, DUCT_Y, 0))
    for k in range(8):   # vertical stiffener ribs round the lower (oxide) duct skin
        a = math.radians(k * 45 + 22.5)
        rb = P.box((0.035, 0.05, 0.16), bevel=0.008, segs=1, mat='paint_primary').rotate((0, 0, math.degrees(a) + 90))
        g.merge(rb.move(s * DUCT_X + math.cos(a) * (R_OUT + 0.012), DUCT_Y + math.sin(a) * (R_OUT + 0.012), DUCT_Z - 0.06))
    for k in range(8):
        a = math.radians(k * 45)
        g.merge(P.bolt(0.014, 'hex', 'steel', False).align((math.cos(a), math.sin(a), 0),
                loc=(s * DUCT_X + math.cos(a) * (R_OUT + 0.012), DUCT_Y + math.sin(a) * (R_OUT + 0.012), DUCT_Z - 0.03)))
    # motor pod with cooling fins + a hub cap, hanging from the stators
    pod = P.banded_cylinder([(0.04, 0.07, 'steel_dark'), (0.03, 0.095, 'steel'), (0.03, 0.085), (0.03, 0.095, 'steel'),
                             (0.06, 0.085), (0.03, 0.06, 'hazard')], segs=24, step=0.0, mat='paint_dark')
    g.merge(pod.move(s * DUCT_X, DUCT_Y, DUCT_Z - 0.26))
    return tilted(g, s)


def build_rotor(s):
    """4-blade rotor (wide cambered blades with a root cuff) + spinner at the fan hub."""
    g = Geo()
    cx, cy, cz = s * DUCT_X, DUCT_Y, DUCT_Z + 0.0
    g.merge(P.cylinder(0.08, 0.06, 24, bevel=0.01, bsegs=1, mat='steel_dark').move(cx, cy, cz))
    g.merge(P.cone(0.075, 0.015, 0.08, 24, bevel=0.004, mat='paint_accent').move(cx, cy, cz + 0.03))
    for k in range(4):
        a = k * 90.0 + (0 if s > 0 else 45)
        bl = P.prism([(0.07, -0.05), (0.2, -0.065), (R_IN - 0.02, -0.045), (R_IN - 0.01, 0.03), (0.2, 0.06),
                      (0.07, 0.04)], 0.012, bevel=0.003, segs=1, mat='steel', axis='Z')
        bl.rotate((s * 20, 0, 0)).rotate((0, 0, a))
        g.merge(bl.move(cx, cy, cz))
        cuff = P.box((0.05, 0.07, 0.03), bevel=0.006, segs=1, mat='steel_dark').move(0.085, 0, 0).rotate((0, 0, a))
        g.merge(cuff.move(cx, cy, cz))
    return tilted(g, s)


def build_eye():
    """0.18 m sensor lens recessed in the nose bezel: black glass dome with a small hot red iris
    (about 10 % of the lens), an inner aperture ring, plus two small auxiliary lenses."""
    g = Geo()
    ex, ey, ez = EYE
    g.merge(K.lens_dome(0.092, 0.055, iris=0.36, ring=0.5, core=0.17, part='core', ring_mat='steel')
            .align((0, -1, 0), loc=(ex, ey + 0.015, ez)))
    for s in (1, -1):
        g.merge(K.lens_dome(0.03, 0.016, iris=0.5, ring=0.0, segs=16, rings=3)
                .align((0, -1, 0), loc=(s * 0.22, ey + 0.2, ez - 0.1)))
    return g


def build_eye_rim():
    """Saturated red iris halo around the hot core (own node: deeper, dimmer flat glow)."""
    ex, ey, ez = EYE
    return K.lens_dome(0.092, 0.055, iris=0.36, ring=0.5, core=0.17, part='rim').align((0, -1, 0),
                                                                                       loc=(ex, ey + 0.015, ez))


def build_beacon():
    """Dorsal strobe on the sensor mast (0.48 Hz red blink: readable at range from above)."""
    g = Geo()
    g.merge(P.dome(0.035, 0.05, 16, 2, mat='lens').move(0.12, 0.3, 0.37))
    g.merge(P.ring(0.045, 0.035, 0.012, 16, bevel=0.0, bsegs=1, mat='steel_dark', z0=0.365).move(0.12, 0.3, 0))
    return g


def build(a):
    a.pivot('body', (0, 0, 0))
    a.pivot('eye', EYE, parent='body', iw_eye_color='#FF2A2A', iw_eye_strength=14.0)
    a.pivot('eye_rim', EYE, parent='eye', iw_eye_color='#B8120C', iw_eye_strength=1.9)
    a.pivot('beacon', (0.12, 0.3, 0.4), parent='body', iw_eye_color='#FF3B2F', iw_eye_strength=14.0)
    a.muzzle('muzzle', MUZZLE, fire=(0, -1, 0), parent='body')
    # rotor nodes carry the duct tilt as their rest rotation (they spin about their own +Y)
    a.pivot('rotor', (DUCT_X, DUCT_Y, DUCT_Z), parent='body', rotation=(DUCT_TILT, 0, 0), iw_r=R_IN - 0.01)
    a.pivot('rotor_1', (-DUCT_X, DUCT_Y, DUCT_Z), parent='body', rotation=(DUCT_TILT, 0, 0),
            iw_r=R_IN - 0.01)
    tris = {}

    def put(name, g, parent):
        g.cull_inside()
        K.drop_hidden(g)
        ob = a.part(name, g, parent=parent)
        tris[name] = iw.tri_count([ob])
        return ob

    with iw.timed('model'):
        put('body_geo', build_body(), 'body')
        put('eye_geo', build_eye(), 'eye')
        put('eye_rim_geo', build_eye_rim(), 'eye_rim')
        put('beacon_geo', build_beacon(), 'beacon')
        put('rotor_geo', build_rotor(1), 'rotor')
        put('rotor_1_geo', build_rotor(-1), 'rotor_1')
    return tris


def add_decals(a):
    C, BK = (189, 179, 154), D.BLACK
    z_a, _ = body_z1(-0.1)
    K.card(a, D.text_decal('G-14', px=260, color=BK, worn=0.3), (0.0, -0.1, z_a + 0.05), (0, 0, 1), up=(0, -1, 0),
           size=(0.26, None), parent='body', density=800)
    for s in (1, -1):
        K.card(a, K.grauwerk_mark(256, text=False), (s * 0.46, 0.14, 0.02), (s, 0, 0), up=(0, 0, 1), size=(0.2, None),
               parent='body', density=800)
        K.card(a, D.warning_label('DANGER', '回転翼注意', ('ROTOR', '接近禁止'), w=512),
               (s * (DUCT_X + R_OUT + 0.012), DUCT_Y, DUCT_Z - 0.035), (s, 0, 0), up=(0, 0, 1), size=(0.2, None),
               parent='body', density=800)
        K.card(a, D.text_decal('14', px=200, color=BK, worn=0.3), (s * DUCT_X, DUCT_Y - s * 0.0 - (R_OUT + 0.012),
               DUCT_Z + 0.13), (0, -1, 0), up=(0, 0, 1), size=(0.16, None), parent='body', density=800)
        a.decal(D.text_decal('GNAT', px=120, color=C, worn=0.3), (s * 0.43, 0.62, 0.1), (s, 0, 0), up=(0, 0, 1),
                size=(0.16, None))
    a.decal(K.soot(256, 7, 0.8, 1.0), (0, -1.1, -0.37), (0, -1, 0), size=(0.24, 0.24), depth=0.2)
    for s in (1, -1):   # exhaust soot under the manoeuvre jets
        a.decal(K.soot(256, 9 + s, 0.7, 1.4), (s * 0.12, 0.9, 0.0), (0, 1, 0), size=(0.2, 0.3), depth=0.2)


VIEWS = {
    'hero': dict(azimuth=-38, elevation=6, lens=50, distance=6.0, target=(0, -0.1, 0.0)),
    'front': dict(azimuth=0, elevation=4, lens=50, distance=6.0, target=(0, -0.1, 0.0)),
    'top': dict(azimuth=140, elevation=40, lens=50, distance=6.0, target=(0, 0, 0.0)),
    'close': dict(azimuth=-25, elevation=2, lens=70, distance=3.0, target=(0, -0.7, -0.05)),
}
CLAY = dict(VIEWS)
COLORS = {'paint_primary': {'color': '#5C2E24', 'rough': 0.52}, 'paint_secondary': {'color': '#BDB39A', 'rough': 0.56},
          'paint_accent': {'color': '#D8A31A'}, 'paint_dark': {'color': '#2B2624'},
          'steel_dark': {'color': '#3A3836'},
          'glass': {'color': '#06080A', 'metal': 0.0, 'rough': 0.05, 'wear': 0.0, 'grime': 0.1, 'rust': 0.0,
                    'dust': 0.05, 'var': 0.0, 'decals': False}}
OBJ_WEIGHT = {'body_geo': 1.0, 'eye_geo': 1.3, 'eye_rim_geo': 0.5, 'beacon_geo': 0.6, 'rotor_geo': 0.6, 'rotor_1_geo': 0.6}
WEATHER = iw.Weathering(edge_wear=1.55, grime=1.55, streaks=1.6, rust=0.9, dust=0.45, chip_threshold=0.52,
                        flat_chips=0.5, macro=0.08, ground_dirt=0.25, ao_in_albedo=0.24)
NEED = ['body', 'eye', 'beacon', 'muzzle', 'rotor', 'rotor_1']


def main():
    K.run(NAME, build, add_decals, NEED, scheme='grauwerk', colors=COLORS, seed=31, obj_weight=OBJ_WEIGHT,
          weathering=WEATHER, views=VIEWS, clay=CLAY, res=1024, sizes={'normal': 1024, 'orm': 512, 'emissive': 256},
          bake_kw=dict(edge=0.018, cavity=0.04, ao_dist=0.35, bevel_radius=0.006),
          tex_quality={'basecolor': 80, 'normal': 78, 'orm': 70})


if __name__ == '__main__':
    main()
    K.finish()
