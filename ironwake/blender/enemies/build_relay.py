"""RELAY GENERATOR - Grauwerk Consolidated grid relay with a defence gun (stage-2 objective).
(owner: enemy modeler)

Foundry power infrastructure turned into a hardpoint: a chamfered octagonal transformer
housing on a concrete plinth (radiator fin banks on both flanks, a hazard-framed access
door and control box at the front, louvred vents and ground conduits at the back), a
railed top deck with four porcelain bushings around a GLOWING CAPACITOR COLUMN inside a
rotating cage (the objective's focal point, visible from every side), a bolted top cap
carrying a twin-barrel defence gun head with a red sensor, and a lattice antenna mast with
a dish and a blinking aviation beacon.

    python3 blender/enemies/build_relay.py --blockout [--views a,b]
    python3 blender/enemies/build_relay.py [--quick]

Node contract (src/enemies/models.js): root > base > {base_geo, core > core_geo (glow,
rotates, hidden on death), beacon > beacon_geo, head > {head_geo, eye > eye_geo,
barrel > {barrel_geo, muzzle}}}.  Collider (src/enemies/turret.js): a 10 x 8 x 10 m box.
Blender coords: +Z up, faces -Y. Origin at ground level, centre of the plinth.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ekit as K  # noqa: E402
from ekit import D, Geo, P, iw  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

NAME = 'enemy_relay'
K.MAT_WEIGHT.update({'concrete': 0.4})   # plinth concrete: seen at grazing angles, low texel priority
K.UP_WEIGHT = 0.6                        # deck / cap tops: mostly seen from the side at 30-150 m
PLINTH_H = 0.7
HW = 4.0                 # housing half width
HOUSE_Z1 = 6.2           # housing top / deck
DECK_Z = 6.45
CORE_Z0, CORE_Z1 = 6.55, 9.65
CAP_Z = 9.7
HEAD = (0.0, 0.0, 10.25)
# r3: the gun head is authored at its old size and scaled 1.6x about the turntable pivot
# (critic: toy-scale for an emplacement); the turntable ring only grows 1.25x (it sits on the cap)
HEAD_SCALE = 1.6
TRUNNION0 = (0.0, -0.95, 10.95)
MUZZLE0 = (0.0, -3.95, 10.95)


def hs_pt(p):
    return tuple(HEAD[i] + (p[i] - HEAD[i]) * HEAD_SCALE for i in range(3))


def head_scaled(g):
    hx, hy, hz = HEAD
    return g.move(-hx, -hy, -hz).scale(HEAD_SCALE).move(hx, hy, hz)


TRUNNION = hs_pt(TRUNNION0)
MUZZLE = hs_pt(MUZZLE0)
MAST = (-3.1, 3.1)       # back-right corner of the deck
MAST_TOP = 15.6


def octa(hw, c):
    """Octagon (chamfered square) outline, half width hw, chamfer c."""
    return [(-hw + c, -hw), (hw - c, -hw), (hw, -hw + c), (hw, hw - c), (hw - c, hw), (-hw + c, hw), (-hw, hw - c),
            (-hw, -hw + c)]


# ============================================================================ density routing
# The relay is big (10.6 m plinth, 15.6 m mast): the atlas budget goes where the eye goes. Pieces
# are routed by budget label into three meshes under `base`: base_geo (housing shell, plinth,
# deck, cap) at 1x, door_geo (door, control box: the close-up focal point) at 1.9x, and kit_geo
# (radiator fins, lattice mast, rails, ladder, conduits, bushings, vent slats: repetitive, mostly
# seen at range) at 0.45x texel density.
ROUTE = {'door': 'door', 'control': 'door',
         'radiator': 'kit', 'ribs': 'kit', 'mast': 'kit', 'dish': 'kit', 'panels': 'kit', 'rail': 'kit',
         'ladder': 'kit', 'conduit': 'kit', 'bushing': 'kit', 'cables': 'kit', 'vent': 'kit', 'bolts': 'kit'}


class Router(K.Budget):
    def __init__(self, label):
        super().__init__(label)
        self.cats = {'door': Geo(), 'kit': Geo()}

    def add(self, key, g):
        super().add(key, g)
        cat = ROUTE.get(key)
        if cat:
            self.cats[cat].merge(g)
            return Geo()
        return g


# ============================================================================ base (static)
def build_plinth(B):
    g = Geo()
    sl = P.loft([(octa(5.3, 0.9), 0.0), (octa(5.3, 0.9), PLINTH_H - 0.12), (octa(5.18, 0.86), PLINTH_H)], bevel=0.03,
                segs=1, mat='concrete', axis='Z')
    K.mark_hidden(sl, (0, 0, -1))          # bottom sits on the ground
    K.mark_hidden(sl, (0, 0, 1))           # flat top: replaced by a ring (the housing covers the middle)
    g.merge(B.add('plinth', sl))
    outer, inner = octa(5.18, 0.86), octa(HW - 0.06, 0.98)
    verts = [(x, y, PLINTH_H) for x, y in outer] + [(x, y, PLINTH_H) for x, y in inner]
    faces = [(i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i) for i in range(8)]
    ring = Geo.from_pydata(verts, faces, 'concrete')
    ring.fix_normals()
    ring.bm.normal_update()
    if ring.bm.faces[:] and ring.bm.faces[0].normal.z < 0:
        import bmesh
        bmesh.ops.reverse_faces(ring.bm, faces=list(ring.bm.faces))
    g.merge(B.add('plinth', ring))
    # steel kerb angle on the plinth top edge + hazard band round the plinth face
    for i, (a, b) in enumerate(zip(octa(5.24, 0.88), octa(5.24, 0.88)[1:] + octa(5.24, 0.88)[:1])):
        d = Vector((b[0] - a[0], b[1] - a[1], 0))
        n = Vector((d.y, -d.x, 0)).normalized()
        if n.dot(Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0))) < 0:
            n = -n
        p0 = Vector((a[0], a[1], PLINTH_H - 0.3)) + n * 0.06
        p1 = Vector((b[0], b[1], PLINTH_H - 0.3)) + n * 0.06
        g.merge(B.add('plinth', K.strip(p0, p1, 0.28, 0.02, n, mat='hazard')))
    # anchor bolts on the plinth top ring
    for (x, y) in ((4.6, 4.6), (-4.6, 4.6), (4.6, -4.6), (-4.6, -4.6)):
        g.merge(B.add('plinth', P.bolt_row((x * 0.86, y * 0.86 - 0.3 * math.copysign(1, y), PLINTH_H),
                                           (x * 0.86, y * 0.86 + 0.3 * math.copysign(1, y), PLINTH_H), 2, (0, 0, 1),
                                           r=0.06)))
    return g


def build_housing(B):
    g = Geo()
    hs = K.shell([(PLINTH_H, -HW, HW, -HW, HW, 1.0), (HOUSE_Z1 - 0.25, -HW, HW, -HW, HW, 1.0),
                  (HOUSE_Z1, -HW + 0.18, HW - 0.18, -HW + 0.18, HW - 0.18, 0.93)], 'Z', bevel=0.04, mat='paint_primary')
    # horizontal belt seams all round + vertical seams on the chamfer faces
    for z in (2.2, 4.4):
        K.grooves(hs, [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (1, 1, 0), (-1, 1, 0), (1, -1, 0), (-1, -1, 0)],
                  (0, 0, z), (0, 0, 1), gap=0.03, depth=0.03, angle=12)
    # front: big recessed double door, control box; back: vent recess
    K.hatch_at(hs, (0.0, -HW, 2.0), (0, -1, 0), (2.8, 2.6), u_axis=(1, 0, 0), gap=0.03, recess=0.12,
               mat='steel_dark')
    K.hatch_at(hs, (0.0, HW, 3.2), (0, 1, 0), (3.6, 1.6), u_axis=(-1, 0, 0), gap=0.03, recess=0.16, mat='steel_dark')
    for s in (1, -1):   # flank recesses behind the radiator banks
        K.hatch_at(hs, (s * HW, 0.0, 3.4), (s, 0, 0), (4.2, 4.0), u_axis=(0, -1, 0), gap=0.03, recess=0.1,
                   mat='paint_dark')
    K.mark_hidden(hs, (0, 0, -1))          # bottom on the plinth, top under the deck
    K.mark_hidden(hs, (0, 0, 1))
    # cream upper band (Grauwerk two-tone: value contrast that reads at range)
    cm = hs.mi('paint_secondary')
    pm = hs.mi('paint_primary')
    hs.bm.normal_update()
    for f in hs.bm.faces:
        c = f.calc_center_median()
        if f.material_index == pm and c.z > 4.43 and f.normal.z < 0.6:
            f.material_index = cm
    g.merge(B.add('housing', hs))
    # vertical stiffener ribs on the four chamfer faces + bolt rows along the belt seams
    for (sx, sy) in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        n = Vector((sx, sy, 0)).normalized()
        c = Vector((sx * (HW - 0.5), sy * (HW - 0.5), 0)) + n * 0.02
        for off in (-0.28, 0.28):
            t = Vector((-n.y, n.x, 0)) * off
            rib = P.box((0.12, 0.16, HOUSE_Z1 - PLINTH_H - 0.5), bevel=0.015, segs=1, mat='paint_dark')
            rib.rotate((0, 0, math.degrees(math.atan2(n.y, n.x)) + 90))
            g.merge(B.add('ribs', rib.move(c.x + t.x + n.x * 0.08, c.y + t.y + n.y * 0.08,
                                           PLINTH_H + (HOUSE_Z1 - PLINTH_H) / 2 - 0.1)))
    for z in (2.32, 4.52):
        for (a0, a1, nrm) in (((-3.0, -HW - 0.005), (3.0, -HW - 0.005), (0, -1, 0)),
                              ((3.0, HW + 0.005), (-3.0, HW + 0.005), (0, 1, 0))):
            g.merge(B.add('bolts', P.bolt_row((a0[0], a0[1], z), (a1[0], a1[1], z), 7, nrm, r=0.05)))
    # door: two steel leaves in the recess, each with three stiffener ribs, a louvred vent
    # (left) or a vision grille (right), three hinge knuckles on the outer edge, a bar handle and
    # a hazard kick plate; centre astragal; hazard-striped frame round the opening
    yf = -HW + 0.125                       # leaf back face (recess floor)
    for s in (1, -1):
        x0, x1 = s * 0.04, s * 1.36
        g.merge(B.add('door', K.plate_world([(x0, yf, 0.78), (x1, yf, 0.78), (x1, yf, 3.22), (x0, yf, 3.22)][::-s],
                                             0.05, mat='paint_primary', normal_hint=(0, -1, 0), chamfer=0.03,
                                             inset=0.02)))
        xc = (x0 + x1) * 0.5
        for z in (1.25, 2.05, 2.85):
            g.merge(B.add('door', P.box((1.18, 0.06, 0.08), bevel=0.012, segs=1, chamfer=0.02, chamfer_axes='X',
                                        mat='paint_primary').move(xc, yf - 0.08, z)))
        if s > 0:
            lv = P.louvres(0.8, 0.5, count=5, depth=0.05, angle=30, thickness=0.015, mat='steel_dark',
                           side_mat='paint_dark')
            g.merge(B.add('door', lv.rotate((90, 0, 0)).move(xc, yf - 0.06, 2.45)))
        else:
            g.merge(B.add('door', P.grille(0.5, 0.36, bars=4, bar_r=0.012, frame=0.03, depth=0.03, mat='steel_dark')
                          .rotate((90, 0, 0)).move(xc, yf - 0.06, 2.45)))
        for z in (1.0, 2.0, 3.0):   # hinge knuckles
            g.merge(B.add('door', P.cylinder(0.05, 0.22, 12, bevel=0.0, bsegs=1, mat='steel_dark')
                          .move(s * 1.33, yf - 0.1, z)))
            g.merge(B.add('door', P.box((0.14, 0.03, 0.16), bevel=0.006, segs=1, mat='steel_dark')
                          .move(s * 1.26, yf - 0.065, z)))
        # bar handle on stand-offs
        g.merge(B.add('door', P.cylinder(0.024, 0.55, 12, bevel=0.004, bsegs=1, mat='steel').move(s * 0.22, yf - 0.16,
                                                                                               1.95)))
        for z in (1.72, 2.18):
            g.merge(B.add('door', P.box((0.04, 0.12, 0.04), bevel=0.006, segs=1, mat='steel').move(s * 0.22, yf - 0.1, z)))
        g.merge(B.add('door', K.strip((x0 + s * 0.06, yf - 0.05, 0.92), (x1 - s * 0.08, yf - 0.05, 0.92), 0.2, 0.012,
                                      (0, -1, 0), mat='hazard')))
    g.merge(B.add('door', P.box((0.09, 0.07, 2.44), bevel=0.01, segs=1, mat='steel_dark').move(0, yf - 0.08, 2.0)))
    g.merge(B.add('door', P.box((0.24, 0.1, 0.3), bevel=0.012, segs=1, mat='paint_accent').move(0.0, yf - 0.14, 2.0)))
    g.merge(B.add('door', P.cylinder(0.05, 0.14, 12, bevel=0.006, bsegs=1, mat='steel').rotate((90, 0, 0))
                  .move(0.0, yf - 0.22, 2.0)))
    for z in (3.44,):
        g.merge(B.add('door', K.strip((-1.5, -HW - 0.004, z), (1.5, -HW - 0.004, z), 0.2, 0.02, (0, -1, 0),
                                      mat='hazard')))
    for s in (1, -1):
        g.merge(B.add('door', K.strip((s * 1.5, -HW - 0.004, 0.72), (s * 1.5, -HW - 0.004, 3.44), 0.2, 0.02, (0, -1, 0),
                                      mat='hazard')))
    # control box beside the door with indicator lenses (red) + cable into the wall
    cb = P.box((0.9, 0.3, 1.1), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Y', mat='paint_secondary')
    g.merge(B.add('control', cb.move(2.5, -HW - 0.15, 2.4)))
    for i, x in enumerate((2.3, 2.5, 2.7)):
        g.merge(B.add('control', P.dome(0.045, 0.03, 16, 2, mat='lens').rotate((90, 0, 0)).move(x, -HW - 0.31, 2.72)))
    g.merge(B.add('control', P.box((0.6, 0.02, 0.4), bevel=0.004, segs=1, mat='steel_dark').move(2.5, -HW - 0.305, 2.3)))
    g.merge(B.add('control', P.box((0.08, 0.1, 0.28), bevel=0.01, segs=1, mat='paint_accent').move(2.95, -HW - 0.3, 2.0)))
    for z in (2.0, 2.75):
        g.merge(B.add('control', P.cylinder(0.025, 0.14, 12, bevel=0.0, bsegs=1, mat='steel_dark')
                      .move(2.04, -HW - 0.3, z)))
    g.merge(B.add('control', K.tube([(2.5, -HW - 0.1, 1.84), (2.5, -HW - 0.25, 1.5), (2.4, -HW - 0.1, 1.0)], 0.04, 8,
                                    subdiv=3)))
    # radiator fin banks on both flanks (transformer radiators): headers + vertical fins
    for s in (1, -1):
        x = s * (HW + 0.1)
        for z in (1.6, 5.1):
            g.merge(B.add('radiator', P.cylinder(0.12, 3.9, 16, bevel=0.02, bsegs=1, mat='steel_dark')
                          .rotate((90, 0, 0)).move(x + s * 0.18, 0, z)))
        for k in range(13):
            y = -1.8 + k * 0.3
            fin = P.box((0.5, 0.05, 3.3), bevel=0.012, segs=1, mat='paint_primary')
            g.merge(B.add('radiator', fin.move(x + s * 0.28, y, 3.35)))
        for y in (-2.0, 2.0):
            g.merge(B.add('radiator', P.box((0.3, 0.1, 3.9), bevel=0.02, segs=1, mat='steel_dark')
                          .move(x + s * 0.1, y, 3.35)))
        g.merge(B.add('radiator', K.strip((x + s * 0.54, -1.95, 5.34), (x + s * 0.54, 1.95, 5.34), 0.14, 0.02, (s, 0, 0),
                                          mat='paint_accent')))
    # back: louvred vent in the recess, three ground conduits and a cable tray down to the plinth
    lv = P.louvres(3.3, 1.35, count=6, depth=0.1, angle=28, thickness=0.03, mat='steel_dark', side_mat='paint_dark')
    lv.rotate((90, 0, 0)).move(0, HW - 0.2, 3.2)
    g.merge(B.add('vent', lv))
    for i, x in enumerate((-1.2, 0.0, 1.2)):
        g.merge(B.add('conduit', K.tube([(x, HW, 1.6), (x, HW + 0.55, 1.35), (x * 1.1, HW + 0.8, 0.9),
                                         (x * 1.2, HW + 0.9, PLINTH_H - 0.05)], 0.14, 10, mat='steel',
                                        collar_mat='steel_dark', subdiv=3)))
        g.merge(B.add('conduit', P.box((0.42, 0.3, 0.42), bevel=0.02, segs=1, mat='steel_dark').move(x, HW + 0.12, 1.6)))
    # ladder up the front-left chamfer to the deck
    lx, ly = HW - 0.45, -HW + 0.45
    n = Vector((1, -1, 0)).normalized()
    t = Vector((1, 1, 0)).normalized()
    base = Vector((lx, ly, 0)) + n * 0.12
    for sgn in (-1, 1):
        a = base + t * (0.28 * sgn) + n * 0.1
        g.merge(B.add('ladder', P.box((0.06, 0.06, HOUSE_Z1 - PLINTH_H + 1.1), bevel=0.01, segs=1, mat='hazard')
                      .rotate((0, 0, 45)).move(a.x, a.y, PLINTH_H + (HOUSE_Z1 - PLINTH_H + 1.1) / 2)))
    for k in range(17):
        z = PLINTH_H + 0.3 + k * 0.33
        c = base + n * 0.1
        g.merge(B.add('ladder', P.box((0.56, 0.035, 0.035), bevel=0.006, segs=1, mat='steel').rotate((0, 0, 45))
                      .move(c.x, c.y, z)))
    return g


def build_deck(B):
    g = Geo()
    dk = P.loft([(octa(HW - 0.1, 0.95), HOUSE_Z1), (octa(HW - 0.1, 0.95), DECK_Z)], bevel=0.02, segs=1,
                mat='steel_dark', axis='Z')
    K.mark_hidden(dk, (0, 0, -1))
    g.merge(B.add('deck', dk))
    # railing round the deck edge (posts + two rails), gap at the ladder corner
    pts = octa(HW - 0.25, 0.9)
    for i in range(8):
        a, b = Vector((*pts[i], 0)), Vector((*pts[(i + 1) % 8], 0))
        if i == 2:
            continue   # ladder gap (front-left chamfer)
        d = b - a
        L = d.length
        for z in (DECK_Z + 0.55, DECK_Z + 1.1):
            r = P.cylinder(0.03, L, 8, bevel=0.0, mat='hazard').align(d.normalized(), loc=a + Vector((0, 0, z)))
            r.move(*(d * 0.5))
            g.merge(B.add('rail', r))
        for k in range(int(L // 1.6) + 1):
            p = a + d * (k / max(1, int(L // 1.6)))
            g.merge(B.add('rail', P.box((0.06, 0.06, 1.1), bevel=0.008, segs=1, mat='paint_secondary')
                          .move(p.x, p.y, DECK_Z + 0.55)))
    # porcelain bushings (stacked sheds) on the deck corners around the core + cable lugs
    for (x, y) in ((1.9, 1.9), (-1.9, 1.9), (1.9, -1.9), (-1.9, -1.9)):
        prof = [(0.0, 0.0), (0.34, 0.0), (0.34, 0.25), (0.2, 0.3)]
        z = 0.3
        for k in range(4):
            prof += [(0.38, z + 0.06), (0.38, z + 0.11), (0.2, z + 0.22)]
            z += 0.32
        prof += [(0.14, z + 0.05), (0.14, z + 0.3), (0.0, z + 0.3)]
        bu = P.lathe(prof, 12, 'paint_secondary')
        g.merge(B.add('bushing', bu.move(x, y, DECK_Z)))
        g.merge(B.add('bushing', P.box((0.24, 0.24, 0.12), bevel=0.02, segs=1, mat='steel').move(x, y, DECK_Z + z + 0.36)))
        top = Vector((x, y, DECK_Z + z + 0.38))
        cap = Vector((x * 0.48, y * 0.48, CAP_Z + 0.1))
        g.merge(B.add('cables', K.tube([top, top.lerp(cap, 0.5) + Vector((0, 0, -0.35)), cap], 0.05, 8, mat='rubber',
                                       collar_mat='steel', subdiv=4)))
    # four heavy pillars carrying the top cap (the core column stands between them)
    for (x, y) in ((1.05, 1.05), (-1.05, 1.05), (1.05, -1.05), (-1.05, -1.05)):
        pl = K.shell([(DECK_Z, -0.2, 0.2, -0.2, 0.2, 0.06), (CAP_Z, -0.16, 0.16, -0.16, 0.16, 0.05)], 'Z', bevel=0.012,
                     mat='paint_dark')
        g.merge(B.add('pillars', pl.move(x, y, 0)))
        for z in (DECK_Z + 0.9, CAP_Z - 0.5):
            g.merge(B.add('pillars', P.box((0.46, 0.46, 0.14), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Z',
                                           mat='steel_dark').move(x, y, z)))
    # core socket rings (static): bottom on the deck, top under the cap
    g.merge(B.add('socket', P.banded_cylinder([(0.12, 1.2, 'steel_dark'), (0.18, 1.05), (0.06, 0.95, 'steel')], segs=40,
                                              step=0.0, mat='paint_dark').move(0, 0, DECK_Z)))
    g.merge(B.add('socket', P.banded_cylinder([(0.06, 0.95, 'steel'), (0.18, 1.05), (0.12, 1.2, 'steel_dark')], segs=40,
                                              step=0.0, mat='paint_dark').move(0, 0, CORE_Z1 - 0.36)))
    # top cap: octagonal armoured plate with a bolt ring (the gun head's turntable sits on it)
    cap = P.loft([(octa(1.95, 0.62), CAP_Z - 0.05), (octa(2.0, 0.64), CAP_Z + 0.3), (octa(1.85, 0.58), CAP_Z + 0.5)],
                 bevel=0.02, segs=1, mat='paint_primary', axis='Z')
    g.merge(B.add('cap', cap))
    g.merge(B.add('cap', P.bolt_circle((0, 0, CAP_Z + 0.5), (0, 0, 1), 1.68, 12, r=0.05)))
    for s in (1, -1):
        g.merge(B.add('cap', K.strip((-1.25, s * 1.97, CAP_Z + 0.15), (1.25, s * 1.97, CAP_Z + 0.15), 0.16, 0.02,
                                     (0, s, 0), mat='hazard')))
    return g


def build_mast(B):
    g = Geo()
    mx_, my = MAST
    z0, z1 = DECK_Z, MAST_TOP
    base = P.box((0.9, 0.9, 0.3), bevel=0.02, segs=1, chamfer=0.1, chamfer_axes='Z', mat='steel_dark')
    g.merge(B.add('mast', base.move(mx_, my, z0 + 0.15)))
    # three-leg lattice tapering upward
    legs = []
    for k in range(3):
        a = math.radians(90 + k * 120)
        legs.append((a, 0.42, 0.16))
    def leg_pt(a, r0, r1, z):
        t = (z - z0) / (z1 - z0)
        r = r0 + (r1 - r0) * t
        return Vector((mx_ + math.cos(a) * r, my + math.sin(a) * r, z))
    for a, r0, r1 in legs:
        p0, p1 = leg_pt(a, r0, r1, z0 + 0.3), leg_pt(a, r0, r1, z1)
        d = p1 - p0
        g.merge(B.add('mast', P.cylinder(0.045, d.length, 8, bevel=0.0, mat='paint_secondary').align(d.normalized(),
                                                                                                   loc=p0 + d * 0.5)))
    nb = 9
    for i in range(nb):
        za = z0 + 0.3 + (z1 - z0 - 0.3) * i / nb
        zb = z0 + 0.3 + (z1 - z0 - 0.3) * (i + 1) / nb
        for k in range(3):
            a0, r0, r1 = legs[k]
            a1 = legs[(k + 1) % 3][0]
            p = leg_pt(a0, r0, r1, za)
            q = leg_pt(a1, r0, r1, zb)
            d = q - p
            g.merge(B.add('mast', P.box((0.03, 0.03, d.length), bevel=0.0, segs=1, mat='steel_dark')
                          .align(d.normalized(), loc=p + d * 0.5)))
            q2 = leg_pt(a1, r0, r1, za)
            d2 = q2 - p
            g.merge(B.add('mast', P.box((0.03, 0.03, d2.length), bevel=0.0, segs=1, mat='steel_dark')
                          .align(d2.normalized(), loc=p + d2 * 0.5)))
    # relay dish (facing out, back-right) + panel antennas + top whip
    dish = P.dome(0.7, 0.22, 24, 4, mat='paint_secondary', base=False)
    dish.merge(P.ring(0.72, 0.66, 0.06, 24, bevel=0.0, mat='steel_dark', z0=-0.02))
    dish.merge(P.cylinder(0.04, 0.5, 8, bevel=0.0, mat='steel_dark', z0=0.0))
    dish.merge(P.box((0.14, 0.14, 0.16), bevel=0.01, segs=1, mat='steel_dark').move(0, 0, 0.5))
    dish.rotate((180, 0, 0))
    g.merge(B.add('dish', dish.align(Vector((-0.7, 0.5, 0.25)).normalized(), up=(0, 0, 1),
                                     loc=(mx_ - 0.35, my + 0.3, z0 + 6.2))))
    g.merge(B.add('dish', P.box((0.2, 0.2, 0.6), bevel=0.01, segs=1, mat='steel_dark').rotate((0, 0, 45))
                  .move(mx_ - 0.1, my + 0.1, z0 + 6.2)))
    for k in range(3):
        a = math.radians(30 + k * 120)
        p = leg_pt(a, 0.42, 0.16, z0 + 8.4)
        pan = P.box((0.36, 0.08, 1.2), bevel=0.02, segs=1, mat='paint_secondary')
        g.merge(B.add('panels', pan.rotate((0, 0, math.degrees(a) + 90)).move(p.x + math.cos(a) * 0.2,
                                                                               p.y + math.sin(a) * 0.2, p.z)))
    g.merge(B.add('mast', P.box((0.5, 0.5, 0.12), bevel=0.02, segs=1, mat='steel_dark').move(mx_, my, z1)))
    g.merge(B.add('mast', K.whip(1.6, r=0.012, base_r=0.05).move(mx_ + 0.15, my + 0.1, z1 + 0.06)))
    return g


def build_beacon():
    g = Geo()
    mx_, my = MAST
    z = MAST_TOP + 0.06
    g.merge(P.cylinder(0.12, 0.08, 16, bevel=0.01, bsegs=1, mat='steel_dark', z0=z).move(mx_ - 0.12, my - 0.1, 0))
    g.merge(P.dome(0.1, 0.16, 16, 4, mat='lens').move(mx_ - 0.12, my - 0.1, z + 0.08))
    return g


# ============================================================================ core (rotating glow column)
CORE_H = CORE_Z1 - CORE_Z0 - 0.5
CORE_ZB = CORE_Z0 + 0.25


def build_core():
    """Cage, field-emitter rings (glow) and end sockets of the capacitor column (core_geo)."""
    B = K.Budget('core')
    g = Geo()
    h, z0 = CORE_H, CORE_ZB
    # rotating cage: 6 bars + 3 rings
    for k in range(6):
        a = math.radians(k * 60)
        g.merge(B.add('bars', P.box((0.1, 0.07, h + 0.1), bevel=0.012, segs=1, mat='steel_dark')
                      .rotate((0, 0, k * 60)).move(math.cos(a) * 0.8, math.sin(a) * 0.8, z0 + h / 2)))
    for z in (z0 + 0.25, z0 + h / 2, z0 + h - 0.25):
        g.merge(B.add('rings', P.ring(0.9, 0.78, 0.1, 32, bevel=0.0, mat='steel', z0=z - 0.05)))
    # bright field emitters top & bottom (hot spots in the glow)
    for z in (z0 + 0.05, z0 + h - 0.05):
        g.merge(B.add('emit', P.ring(0.76, 0.5, 0.06, 32, bevel=0.0, mat='glow', z0=z - 0.03)))
    B.report()
    return g


def build_filament():
    """r3: what the plasma glass shows inside: a steel electrode rod with insulator collars and
    a white-hot helical filament wound round it (merged into core_geo; glows through the glass)."""
    B = K.Budget('filament')
    g = Geo()
    h, z0 = CORE_H, CORE_ZB
    g.merge(B.add('rod', P.cylinder(0.075, h - 0.1, 12, bevel=0.0, bsegs=1, mat='steel', z0=z0 + 0.05)))
    for z in (z0 + 0.3, z0 + h - 0.3):
        g.merge(B.add('rod', P.cylinder(0.16, 0.12, 12, bevel=0.0, bsegs=1, mat='paint_secondary', z0=z - 0.06)))
    pts = []
    turns, n = 6.5, 42
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        r = 0.3 + 0.04 * math.sin(t * math.pi * 5)
        pts.append((math.cos(a) * r, math.sin(a) * r, z0 + 0.42 + t * (h - 0.84)))
    g.merge(B.add('coil', K.tube(pts, 0.03, 5, mat='filament', collars=False, subdiv=1)))
    for z in (z0 + 0.42, z0 + h - 0.42):   # coil feeds into the electrode collars
        g.merge(B.add('coil', P.box((0.3, 0.05, 0.05), bevel=0.0, segs=1, mat='filament').move(0.15, 0, z)))
    B.report()
    return g


def build_glass():
    """Capacitor glass envelope (core_glass_geo): models.js renders it with the plasma-glass
    shader (scrolling noise bands, fresnel-darkened rim, translucent onto the filament)."""
    h, z0 = CORE_H, CORE_ZB
    return P.cylinder(0.72, h, 40, bevel=0.0, bsegs=1, mat='glass', cap=False).move(0, 0, z0 + h / 2)


# ============================================================================ gun head
def build_head():
    B = K.Budget('head')
    g = Geo()
    hx, hy, hz = HEAD
    # turntable ring: 1.25x radius / 1.6x height (scaled about the pivot with the rest below)
    k = 1.25 / HEAD_SCALE
    g.merge(B.add('ring', P.banded_cylinder([(0.1, 1.2 * k, 'steel_dark'), (0.14, 1.12 * k)], segs=40, step=0.0,
                                            mat='paint_dark').move(hx, hy, hz)))
    # housing: angular wedge (front at -y), lofted along Y
    secs = [(-1.35, -0.8, 0.8, hz + 0.36, hz + 0.95, (0.06, 0.06, 0.12, 0.12)),
            (-0.9, -1.05, 1.05, hz + 0.26, hz + 1.3, (0.12, 0.12, 0.22, 0.22)),
            (0.9, -1.1, 1.1, hz + 0.26, hz + 1.36, (0.12, 0.12, 0.25, 0.25)),
            (1.3, -0.95, 0.95, hz + 0.32, hz + 1.2, (0.1, 0.1, 0.2, 0.2))]
    hs = K.shell(secs, 'Y', bevel=0.02, mat='paint_primary')
    K.grooves(hs, [(1, 0, 0), (-1, 0, 0), (0, 0, 1)], (0, 0.2, 0), (0, 1, 0), gap=0.02, depth=0.018, angle=25)
    K.grooves(hs, [(1, 0, 0), (-1, 0, 0)], (0, 0, hz + 0.62), (0, 0, 1), gap=0.016, depth=0.014, angle=25)
    K.hatch_at(hs, (0, 0.6, hz + 1.36), (0, 0, 1), (0.9, 0.6), u_axis=(1, 0, 0), gap=0.016, raised=0.03,
               mat='paint_primary')
    g.merge(B.add('shell', hs))
    for s in (1, -1):
        x = s * 1.1
        pts = [(x, -0.75, hz + 0.34), (x, 0.8, hz + 0.34), (x, 0.8, hz + 1.26), (x, -0.75, hz + 1.2)]
        g.merge(B.add('armour', K.plate_world(pts[::(1 if s > 0 else -1)], 0.05, mat='paint_secondary',
                                              normal_hint=(s, 0, 0), chamfer=0.07, bolts=1, bolt_r=0.025,
                                              bolt_spacing=0.3)))
        g.merge(B.add('stripe', K.strip((s * 1.16, -0.7, hz + 0.46), (s * 1.16, 0.75, hz + 0.46), 0.12, 0.012,
                                        (s, 0, 0), mat='paint_accent')))
    # sensor block above the gun mantlet (red lens is the eye node)
    g.merge(B.add('sensor', P.box((0.7, 0.36, 0.3), bevel=0.02, segs=1, chamfer=0.05, chamfer_axes='Y',
                                  mat='paint_dark').move(0.62, -1.28, hz + 1.1)))
    g.merge(B.add('sensor', P.box((0.78, 0.2, 0.03), bevel=0.006, segs=1, mat='paint_dark').move(0.62, -1.42, hz + 1.27)))
    # ammo drums at the back + feed
    for s in (1, -1):
        dr = P.banded_cylinder([(0.06, 0.4, 'steel_dark'), (0.5, 0.44), (0.06, 0.4, 'steel_dark')], segs=32, step=0.0,
                               mat='paint_dark')
        g.merge(B.add('drums', dr.rotate((0, 90, 0)).move(s * 0.12, 1.45, hz + 0.72)))
    # power + data cables from the drum bay down into the turntable (slip ring), with clamps
    for x, r in ((-0.62, 0.06), (-0.42, 0.045)):
        g.merge(B.add('cables', K.tube([(x, 1.2, hz + 0.62), (x - 0.04, 1.62, hz + 0.42), (x, 1.5, hz + 0.16),
                                        (x * 0.9, 1.05, hz + 0.08)], r, 8, mat='rubber', collar_mat='steel',
                                       subdiv=3)))
    g.merge(B.add('cables', P.box((0.36, 0.1, 0.1), bevel=0.0, segs=1, mat='steel_dark').move(-0.52, 1.56, hz + 0.32)))
    g.merge(B.add('lug', K.lug(0.12).move(-0.6, 0.3, hz + 1.36)))
    g.merge(B.add('antenna', K.whip(1.0, r=0.01, base_r=0.04).move(-0.8, 0.9, hz + 1.3)))
    B.report()
    return head_scaled(g)


def build_barrels():
    B = K.Budget('barrels')
    g = Geo()
    tx, ty, tz = TRUNNION0
    # mantlet: armoured block on the trunnion
    mt = P.box((1.3, 0.6, 0.72), bevel=0.02, segs=1, chamfer=0.1, chamfer_axes='X', mat='paint_primary')
    g.merge(B.add('mantlet', mt.move(tx, ty - 0.12, tz)))
    g.merge(B.add('mantlet', P.cylinder(0.14, 1.5, 24, bevel=0.02, bsegs=1, mat='steel').rotate((0, 90, 0))
                  .move(tx, ty + 0.1, tz)))
    y0 = ty - 0.42
    # r3: armoured barrel shroud over both jackets: cooling slots, hazard band, bolted top plate
    shr = P.box((1.12, 0.92, 0.44), bevel=0.016, segs=1, chamfer=0.07, chamfer_axes='Y', mat='paint_primary')
    shr.move(tx, y0 - 0.44, tz)
    for s in (1, -1):
        for k in range(3):
            K.hatch_at(shr, (tx + s * 0.56, y0 - 0.2 - k * 0.24, tz), (s, 0, 0), (0.16, 0.2), u_axis=(0, 1, 0),
                       gap=0.008, recess=0.03, mat='steel_dark')
    g.merge(B.add('shroud', shr))
    g.merge(B.add('shroud', K.plate_world([(tx - 0.42, y0 - 0.05, tz + 0.22), (tx + 0.42, y0 - 0.05, tz + 0.22),
                                           (tx + 0.42, y0 - 0.84, tz + 0.22), (tx - 0.42, y0 - 0.84, tz + 0.22)][::-1],
                                          0.03, mat='paint_secondary', normal_hint=(0, 0, 1), chamfer=0.04)))
    g.merge(B.add('shroud', K.strip((tx - 0.565, y0 - 0.86, tz - 0.1), (tx - 0.565, y0 - 0.86, tz + 0.1), 0.1, 0.01,
                                    (-1, 0, 0), mat='hazard')))
    g.merge(B.add('shroud', K.strip((tx + 0.565, y0 - 0.86, tz + 0.1), (tx + 0.565, y0 - 0.86, tz - 0.1), 0.1, 0.01,
                                    (1, 0, 0), mat='hazard')))
    for s in (1, -1):
        x = tx + s * 0.34
        # (the old exposed jackets now live inside the shroud: only a cooling ring shows ahead of it)
        g.merge(B.add('jacket', P.ring(0.15, 0.09, 0.08, 32, bevel=0.0, mat='steel', z0=0.0)
                      .align((0, -1, 0), loc=(x, y0 - 0.9, tz))))
        g.merge(B.add('barrel', P.cylinder(0.085, 1.9, 32, bevel=0.01, bsegs=1, mat='steel_dark', z0=0.0)
                      .align((0, -1, 0), loc=(x, y0 - 0.9, tz))))
        g.merge(B.add('barrel', P.ring(0.12, 0.08, 0.14, 32, bevel=0.0, mat='hazard', z0=0.0)
                      .align((0, -1, 0), loc=(x, y0 - 0.95, tz))))
        mb = P.cylinder(0.12, 0.3, 24, bevel=0.015, bsegs=1, mat='steel_dark', z0=0.0).align((0, -1, 0),
                                                                                          loc=(x, y0 - 2.75, tz))
        g.merge(B.add('brake', mb))
    B.report()
    return head_scaled(g)


EYE_LENS = hs_pt((0.62, -1.47, HEAD[2] + 1.1))
EYE_PIVOT = hs_pt((0.62, -1.47, HEAD[2] + 1.05))


def build_eye(part='all'):
    """Gun-head sensor: black-glass lens with a glowing iris on its own dome faces
    (K.lens_dome; no separate halo node at this viewing range), plus a thin ranging slit."""
    g = Geo()
    lens0 = (0.62, -1.47, HEAD[2] + 1.1)
    g.merge(K.lens_dome(0.11, 0.055, iris=0.38, ring=0.52, ring_mat='steel')
            .align((0, -1, 0), loc=lens0))
    if part != 'rim':
        g.merge(P.box((0.5, 0.03, 0.035), bevel=0.006, segs=1, mat='lens').move(0.62 + 0.0, -1.462, HEAD[2] + 0.98))
    return head_scaled(g)


# ============================================================================ assembly
def build(a):
    a.pivot('base', (0, 0, 0))
    a.pivot('core', (0, 0, (CORE_Z0 + CORE_Z1) / 2), parent='base')
    a.pivot('beacon', (MAST[0], MAST[1], MAST_TOP), parent='base', iw_eye_color='#FF3B2F', iw_eye_strength=10.0)
    a.pivot('head', HEAD, parent='base')
    a.pivot('eye', EYE_PIVOT, parent='head', iw_eye_color='#FF2A2A', iw_eye_strength=9.0)
    a.pivot('barrel', TRUNNION, parent='head')
    a.muzzle('muzzle', MUZZLE, fire=(0, -1, 0), parent='barrel')
    tris = {}

    def put(name, g, parent):
        g.cull_inside()
        K.drop_hidden(g)
        ob = a.part(name, g, parent=parent)
        tris[name] = iw.tri_count([ob])
        return ob

    with iw.timed('model'):
        B = Router('base')
        g = Geo()
        g.merge(build_plinth(B), build_housing(B), build_deck(B), build_mast(B))
        B.report()
        put('base_geo', g, 'base')
        put('door_geo', B.cats['door'], 'base')
        put('kit_geo', B.cats['kit'], 'base')
        put('beacon_geo', build_beacon(), 'beacon')
        cg = build_core()
        cg.merge(build_filament())     # one mesh (no extra draw call): cage + emitters + filament
        put('core_geo', cg, 'core')
        put('core_glass_geo', build_glass(), 'core')
        put('head_geo', build_head(), 'head')
        put('eye_geo', build_eye(), 'eye')
        put('barrel_geo', build_barrels(), 'barrel')
    return tris


def add_decals(a):
    C, BK, Y = (189, 179, 154), D.BLACK, D.YELLOW
    K.card(a, D.warning_label('DANGER', '高電圧', ('HIGH VOLTAGE  66kV', '関係者以外立入禁止'), w=900, colors=(Y, BK)),
           (-2.6, -HW - 0.01, 3.9), (0, -1, 0), up=(0, 0, 1), size=(1.5, None), parent='base', density=300)
    K.card(a, K.grauwerk_mark(512), (-2.6, -HW - 0.01, 2.1), (0, -1, 0), up=(0, 0, 1), size=(1.3, None), parent='base',
           density=260)
    K.card(a, D.text_decal('RELAY R-03', px=260, color=D.BLACK, worn=0.3), (0.0, -HW - 0.01, 5.3), (0, -1, 0),
           up=(0, 0, 1), size=(3.4, None), parent='base', density=260)
    K.card(a, D.text_decal('R-03', px=260, color=D.BLACK, worn=0.3), (0.0, HW + 0.01, 5.35), (0, 1, 0),
           up=(0, 0, 1), size=(1.6, None), parent='base', density=220)
    K.card(a, D.warning_label('DANGER', '高電圧', ('HIGH VOLTAGE', '開扉厳禁'), w=640, colors=(Y, BK)),
           (-0.7, -HW + 0.06, 1.6), (0, -1, 0), up=(0, 0, 1), size=(0.5, None), parent='base', density=420)
    for s in (1, -1):
        K.card(a, D.text_decal('R-03', px=220, color=C, worn=0.3), hs_pt((s * 1.16, -0.1, HEAD[2] + 0.85)), (s, 0, 0),
               up=(0, 0, 1), size=(0.7 * HEAD_SCALE, None), parent='head', density=300)
        K.card(a, D.text_decal(['GRAUWERK GRID DIV.', 'PIER 7 SUBSTATION'], px=110, color=C, worn=0.3),
               (s * (HW + 0.01), -3.1 * s, 5.6), (s, 0, 0), up=(0, 0, 1), size=(1.4, None), parent='base', density=240)
        a.decal(D.serial_plate(('GC-RLY 3  66kV / 2.4MVA', 'LOT 0719  HALVARD DEEP')), (s * 2.9, s * 2.9, 1.3),
                (s, s, 0), up=(0, 0, 1), size=(0.9, None))
        a.decal(K.soot(256, 40 + s, 0.8, 1.8), (s * (HW + 0.02), 0.0, 5.6), (s, 0, 0), size=(3.2, 1.6), depth=0.6,
                opacity=0.7)
    K.card(a, D.warning_label('CAUTION', '回転注意', ('ROTATING CAGE', '接近禁止'), w=640), (2.01, 0.0, CAP_Z + 0.2),
           (1, 0, 0), up=(0, 0, 1), size=(0.7, None), parent='base', density=300)
    a.decal(D.arrow_decal(text='66kV'), (0.0, HW + 0.01, 4.6), (0, 1, 0), up=(0, 0, 1), size=(0.9, None))


VIEWS = {
    'hero': dict(azimuth=-32, elevation=10, lens=40, distance=38, target=(0, 0, 7.5)),
    'front': dict(azimuth=0, elevation=6, lens=45, distance=36, target=(0, 0, 7.5)),
    'back': dict(azimuth=150, elevation=14, lens=45, distance=36, target=(0, 0, 7.5)),
    'close': dict(azimuth=-28, elevation=14, lens=60, distance=16, target=(0, -0.6, 9.2)),
}
CLAY = dict(VIEWS)
COLORS = {'paint_primary': {'color': '#5C2E24', 'rough': 0.54}, 'paint_secondary': {'color': '#BDB39A', 'rough': 0.5},
          'paint_accent': {'color': '#D8A31A'}, 'paint_dark': {'color': '#2B2624'},
          'steel_dark': {'color': '#3A3836'}, 'glow': {'emit': '#7FE0FF', 'emit_strength': 6.5},
          # r3 core: white-hot filament inside a plasma-glass envelope (the glass shader lives in models.js)
          'filament': {'color': '#101414', 'metal': 0.0, 'rough': 0.4, 'wear': 0.0, 'grime': 0.0, 'rust': 0.0,
                       'dust': 0.0, 'var': 0.0, 'emit': '#D8FAFF', 'emit_strength': 6.5, 'decals': False},
          'glass': {'color': '#06080A', 'metal': 0.0, 'rough': 0.05, 'wear': 0.0, 'grime': 0.1, 'rust': 0.0,
                    'dust': 0.05, 'var': 0.0, 'decals': False}}
OBJ_WEIGHT = {'head_geo': 1.0, 'barrel_geo': 0.8, 'core_geo': 0.6, 'eye_geo': 1.0, 'base_geo': 1.0, 'door_geo': 1.8,
              'kit_geo': 0.4, 'core_glass_geo': 0.05}
WEATHER = iw.Weathering(edge_wear=1.3, grime=1.4, streaks=1.7, rust=1.1, dust=0.55, chip_threshold=0.56,
                        flat_chips=0.55, macro=0.1, ground_dirt=0.7, ao_in_albedo=0.26)
NEED = ['base', 'core', 'beacon', 'head', 'eye', 'barrel', 'muzzle']


def main():
    K.run(NAME, build, add_decals, NEED, scheme='grauwerk', colors=COLORS, seed=41, obj_weight=OBJ_WEIGHT,
          weathering=WEATHER, views=VIEWS, clay=CLAY, res=2048, small=0.13,
          sizes={'normal': 1536, 'orm': 768, 'emissive': 256}, card_atlas=1024,
          tex_quality={'basecolor': 70, 'normal': 70, 'orm': 60, 'decals': 76},   # r3: -45 KB, r4b: -30 KB (build budget)
          bake_kw=dict(edge=0.05, cavity=0.12, ao_dist=1.6, bevel_radius=0.02))


if __name__ == '__main__':
    main()
    K.finish()
