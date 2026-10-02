"""blender/arena/build_arena.py - builds assets/arena/arena.glb (+ the ground splat map).

    python3 blender/arena/textures.py            # tiling texture sets -> assets/arena/tex (once)
    python3 blender/arena/build_arena.py [--out assets/arena/arena.glb] [--no-pack]   (~5 s)

HALVARD DEEP FOUNDRY - PIER 7 (AC6_BENCHMARK s5). Layout in GAME coordinates (x, y-up, z),
the player launches from the pad at (0, 0.4, -205) facing +Z (north, toward the sea).
The playable area is a raised pier deck (+/-250 m bounds, parapet edges); outside it the
lower foundry yard sits 9 m below (LOW) and the sea at -14 m (SEA).

  south  lower yard: foundry hall, sinter bins, blast furnace B + casthouse, slag runner,
         torpedo cars, stacks, cooling towers
  west   tank farm (bunds, sphere tanks) + N-S pipe rack at x=-150; more tanks below
  middle open yard (MT squad): container clusters, cover blocks, billets, clutter, rails z=-120
  east   casthouse + slag runner/pit + torpedo spur on the deck; blast furnace A, stoves, stacks below
  north  dock: container stacks, 3 rail-mounted STS gantry cranes, ore stocking bridge over the
         stockpile, quay edge; sea with the half-sunk bulk carrier, breakwater, far shore,
         east peninsula smelters (300 m stacks)
  overhead ore conveyor galleries: dock -> transfer tower -> drive house (kink) -> stockhouse ->
         furnace A top, transfer tower -> south sinter bins
  HERO   Furnace No.6 on the reclaimed ore mole 220-380 m off the quay, on the +Z launch axis
         (rises over the C2 gallery in every gameplay frame)
Kits are hidden-face culled at build time (akit.cull_hidden); out-of-bounds copies of tracks,
hoppers, masts and quay segments use '_lo' kits (place()).
Contracts: COL_* colliders, SPAWN_player, SPAWN_mt_*, SPAWN_drone_*, SPAWN_boss_*, OBJ_relay_*.
Extra (src/world/arena.js): FX_smoke_* (extras r, h, kind) plumes, FX_light_* (r, c, i) light pools.
"""
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import akit as A  # noqa: E402
from akit import G, P  # noqa: E402
import buildings as B  # noqa: E402
import megakit as MK  # noqa: E402
import farkit as FK  # noqa: E402
import pieces as K  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

ROOT = A.ROOT
PI = math.pi
FOOT = []    # footprints for the splat map: (kind, x, z, sx, sz, yaw)
RND = random.Random(707)
LOW = -9.0      # lower foundry yard around the pier deck (outside the bounds)
SEA = -14.0     # sea level
EDGE = 251.2    # deck edge line (bounds are +/-250)


FXN = [0]
UNDER = []   # (x, z, size, yaw) dust/soot decals under clutter piles
SODIUM = (1.0, 0.6, 0.24)
FIRE = (1.0, 0.33, 0.08)


def fx_smoke(x, y, z, r, h, kind=0):
    FXN[0] += 1
    e = A.marker(f'FX_smoke_{FXN[0]}', (x, y, z), 0.0)
    e['r'], e['h'], e['kind'] = float(r), float(h), int(kind)


def fx_shore(x, z, hx, hz, yaw=0.0, r=0.0, k=1.0):
    """Waterline obstacle for the sea shader (src/world/water.js): oriented box in game XZ."""
    FXN[0] += 1
    e = A.marker(f'FX_shore_{FXN[0]}', (x, SEA, z), 0.0)
    e['hx'], e['hz'], e['yaw'], e['r'], e['k'] = float(hx), float(hz), float(yaw), float(r), float(k)


def fx_light(x, y, z, r, color=SODIUM, i=0.35):
    FXN[0] += 1
    e = A.marker(f'FX_light_{FXN[0]}', (x, y, z), 0.0)
    e['r'], e['i'] = float(r), float(i)
    e['c'] = [float(c) for c in color]


STACK_TOP = {'stack120': (121.4, 3.3), 'stack120p': (125.4, 3.1), 'stack200': (201.4, 4.7), 'stack200p': (206.4, 4.3),
             'stack70': (71.4, 2.0), 'stack_steel': (141.0, 3.9), 'twinflue': (168.8, 2.4),
             'fstack0': (191.4, 4.4), 'fstack1': (241.4, 5.6), 'fstack2': (171.0, 5.5), 'fstack3': (216.0, 3.4)}


STACKN = [0]


def stack(name, x, z, y=0.0, kind=None, hmul=1.0, collide=False, zs=1.0, **kw):
    if zs != 1.0:
        kw['scale'] = (1.0, 1.0, zs)
    place(name, x, z, y=y, collide=collide, **kw)
    top, r = STACK_TOP[name]
    top *= zs
    if kind is None:   # stacks: 60 % black smoke, 40 % steam (hot fume only over furnaces / fires)
        kind = (0, 1, 0, 1, 0)[STACKN[0] % 5]
        STACKN[0] += 1
    fx_smoke(x, y + top, z, r, (130 + top * 0.6) * hmul * (1.15 if kind == 1 else 1.0), kind)


def cols_m(M, cols):
    """Colliders given in a piece's local Blender coords, placed with matrix M."""
    for col in cols:
        c, sz = col[0], col[1]
        Rz = Matrix.Rotation(col[2], 4, 'Z') if len(col) > 2 else Matrix.Identity(4)
        A.collider_m(M @ Matrix.Translation(Vector(c)) @ Rz @ Matrix.Diagonal((sz[0] / 2, sz[1] / 2, sz[2] / 2, 1.0)))


def foot(kind, x, z, sx, sz, yaw=0.0):
    FOOT.append((kind, x, z, sx, sz, yaw))


LO_KITS = {'track', 'hopper', 'mast', 'quay'}


def place(name, x, z, yaw=0.0, y=0.0, fk=None, fs=None, **kw):
    if name in LO_KITS and (y < -1.0 or max(abs(x), abs(z)) > 262.0):
        name = name + '_lo'
    A.inst(name, (x, y, z), yaw=yaw, **kw)
    if name in ('mast', 'mast_lo'):
        fx_light(x, y, z, 17.0, SODIUM, 0.17)
    if fk:
        foot(fk, x, z, fs[0], fs[1], yaw)


# ---------------------------------------------------------------------------------- kit
def build_kit():
    t0 = time.time()
    for c in ('c_red', 'c_blue', 'c_green', 'c_grey', 'c_cream', 'c_orange'):
        g, cols = K.container(c)
        A.kit('cont_' + c, g, cols)
    for name, fn in (('barrier', K.block_barrier), ('billets', K.billet_stack), ('spools', K.pipe_spools),
                     ('hopper', K.hopper_wagon), ('ladle', K.ladle_car), ('mast', K.lamp_mast)):
        g, cols = fn()
        A.kit(name, g, cols)
    A.kit('track', K.rail_track(12.0))
    # LODs for the out-of-bounds copies (lower yard, mole, coast): same silhouette, fewer tris
    A.kit('track_lo', K.rail_track(12.0, lo=True))
    A.kit('hopper_lo', K.hopper_wagon(lo=True)[0])
    A.kit('mast_lo', K.lamp_mast(lo=True)[0])
    A.kit('quay_lo', B.quay_seg(20.0, lo=True))
    for i in range(3):
        g, cols = K.rubble(seed=11 + i, s=1.0 + 0.25 * i)
        A.kit(f'rubble{i}', g, [((0, 0, 0.4), (4.4, 4.4, 0.8))])
    for i in range(2):
        g, cols = K.scrap_pile(seed=21 + i)
        A.kit(f'scrap{i}', g, [((0, 0, 0.4), (6.0, 6.0, 0.8))])
    for i in range(2):
        A.kit(f'drums{i}', K.drums(seed=31 + i, n=7 + 4 * i))
    for name, fn in (('cabledrum', K.cable_drum), ('plates', K.plate_stack), ('wreck', K.wreck_hauler), ('transformer', K.transformer)):
        g, cols = fn()
        A.kit(name, g, cols)
    A.kit('jersey', K.jersey_row(5), [((0, 0, 0.55), (20.0, 0.8, 1.1))])
    for h in (24, 32, 40, 48, 56, 64):
        for v, suf in ((0, ''), (1, 'p'), (2, 'c')):
            g, cols = K.trestle(float(h), variant=v)
            A.kit(f'trestle{h}{suf}', g, cols)
    g, cols = K.gallery(24.0)
    A.kit('gallery', g, cols, cull={'grounds': ()})     # elevated: keep the underside
    g, cols = K.pipe_bent()
    A.kit('pipebent', g, cols)
    g, cols = K.tank(14.0, 20.0, 'bone')
    A.kit('tank_big', g, cols)
    g, cols = K.tank(9.0, 14.0, 'grey')
    A.kit('tank_small', g, cols)
    g, cols = K.sphere_tank(9.0)
    A.kit('sphere', g, cols)
    g, cols = K.stove()
    A.kit('stove', g, cols)
    g, cols = K.blast_furnace()
    A.kit('furnace', g, cols)
    g, cols = K.sts_crane()
    A.kit('crane', g, cols)
    g, cols = K.ore_bridge()
    A.kit('orebridge', g, cols)
    # stack profiles (r3: no copy-paste skyline): banded concrete, painted day-mark concrete,
    # plated steel flue with guy wires, twin flues in a lattice tower; random band spacing
    g, cols = K.stack(120.0, 6.0, 3.6, 'dark', segs=28, band_step=11.0, seed=3, cheap_rail=True)
    A.kit('stack120', g, cols)
    g, cols = K.stack(124.0, 6.2, 3.4, 'grey', segs=28, band_step=None, paint=('steel:white', 'steel:red'), plats=(0.55,), seed=4,
                      cheap_rail=True)
    A.kit('stack120p', g, cols)
    g, cols = K.stack(200.0, 9.0, 5.0, 'grey', segs=32, band_step=15.0, seed=1, cheap_rail=True)
    A.kit('stack200', g, cols)
    g, cols = K.stack(205.0, 9.5, 4.6, 'dark', segs=32, band_step=26.0, paint=('steel:red', 'steel:white'), plats=(0.7,), seed=2,
                      cheap_rail=True)
    A.kit('stack200p', g, cols)
    A.kit('stack_steel', K.steel_stack(140.0, 4.2, seed=5))
    A.kit('twinflue', K.twin_flue(160.0, 2.6, seed=6))
    g, cols = K.stack(70.0, 3.2, 2.2, 'dark', segs=32)
    A.kit('stack70', g, cols)
    for i, (st, hh, rr, sd) in enumerate((('taper', 190.0, 8.0, 11), ('taper', 240.0, 10.0, 12), ('steel', 170.0, 6.0, 13),
                                          ('twin', 210.0, 8.0, 14))):
        A.kit(f'fstack{i}', FK.stack_far(st, hh, rr, sd))
    A.kit('cooling', K.cooling_tower())
    g, cols = B.deck_edge(2 * EDGE / 26, -LOW)
    A.kit('edge', g, cols)
    A.kit('quay', B.quay_seg(20.0))
    A.kit('crail', B.crane_rail(20.0))
    A.kit('far_crane', B.far_crane())
    A.kit('casthouse', B.casthouse()[0])
    A.kit('light', B.light_tower())
    # far kit: every block has setbacks, rooftop stacks/vents, pipe racks, a gantry and window rows
    for i, (sx, sy, h) in enumerate(((120, 60, 46), (80, 50, 32), (64, 60, 62), (160, 44, 26), (230, 80, 95), (110, 90, 135))):
        A.kit(f'far_block{i}', FK.works_far(i * 7 + 3, sx, sy, h))
    A.kit('furnace_far', FK.furnace_far(300.0))      # one horizon furnace kit, varied per instance by scale / mirror / yaw
    A.kit('jetty', MK.jetty(62.0))
    A.kit('pontoon', MK.pontoon())
    A.kit('dolphin', MK.dolphin(SEA))
    for i in range(3):
        A.kit(f'drift{i}', MK.ash_drift(12.0 + 4 * i, 2.6 + 0.6 * i, 0.32 + 0.08 * i, seed=40 + i))
    A.kit('trench', MK.trench(24.0))
    A.kit('embers0', MK.embers(9, 3.0))
    A.kit('embers1', MK.embers(10, 4.2))
    for i in range(4):
        A.kit(f'litter{i}', MK.litter(seed=60 + i, s=3.0 + i * 0.8))
    A.kit('ctray', MK.cable_tray(24.0), [((0, 0, 1.75), (24.4, 1.4, 3.5))])
    A.kit('bollards', MK.bollards(6), [((0, 0, 0.65), (16.0, 0.8, 1.3))])
    for i in range(2):
        A.kit(f'cables{i}', MK.ground_cables(22.0 + 8 * i, 3 + i, seed=70 + i))
    for i in range(3):
        A.kit(f'ashpatch{i}', MK.ash_patch(5.0 + 2.5 * i, 3.2 + 1.2 * i, 0.26 + 0.07 * i, seed=80 + i))
    for name, fn in (('slagpots', MK.slag_pots), ('bogie', MK.crane_bogie), ('billets6', MK.billets_tall)):
        g, cols = fn()
        A.kit(name, g, cols)
    print(f'[arena] kit built in {time.time() - t0:.1f}s: ' + ', '.join(f'{k}={v["tris"]}' for k, v in A.KIT.items()))


# ---------------------------------------------------------------------------------- ground / sea
def ground():
    g = A.Geo()

    def tiles(x0, x1, z0, z1, y, step):
        nx, nz = max(1, int(math.ceil((x1 - x0) / step))), max(1, int(math.ceil((z1 - z0) / step)))
        for i in range(nx):
            for j in range(nz):
                a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
                b0, b1 = z0 + (z1 - z0) * j / nz, z0 + (z1 - z0) * (j + 1) / nz
                g.merge(A.Geo.from_pydata([tuple(G(a0, y, b0)), tuple(G(a0, y, b1)), tuple(G(a1, y, b1)), tuple(G(a1, y, b0))],
                                          [(0, 1, 2, 3)], 'ground'))
    tiles(-EDGE, EDGE, -EDGE, 250.0, 0.0, 64.0)                  # pier deck
    tiles(-1600, 1600, -1600, -EDGE - 1.0, LOW, 160.0)           # lower yard south
    tiles(-1600, -EDGE - 1.0, -EDGE - 1.0, 250.0, LOW, 160.0)    # west
    tiles(EDGE + 1.0, 1600, -EDGE - 1.0, 250.0, LOW, 160.0)      # east
    A.unique('ground', g, weighted=False)
    # the sea itself is generated at runtime (src/world/water.js); here only its waterline
    # obstacles: quay front, breakwater, far shore, east peninsula
    fx_shore(10.0, 245.0, 905.0, 7.6)
    fx_shore(-150.0, 680.0, 452.0, 12.7, r=4.0, k=1.3)
    fx_shore(300.0, 690.0, 3.3, 3.3, r=3.2)
    fx_shore(100.0, 1080.0, 1200.0, 320.0, k=1.6)
    fx_shore(1165.0, 675.0, 735.0, 425.0, k=1.6)


TRENCH = []   # (x, z, half x, half z) grating trench footprints (decals never paint across them)


def hits_trench(x, z, w, l):
    r = 0.5 * math.hypot(w, l)
    return any(abs(x - tx) < hx + r and abs(z - tz) < hz + r for (tx, tz, hx, hz) in TRENCH)


def decal_quad(cell, color, x, z, w, l, yaw=0.0, y=0.03):
    """Ground decal: w along the rotated game X, l along game Z. Ground-level decals that would
    cross a grating trench are dropped (paint does not continue over the grate)."""
    if y < 0.1 and hits_trench(x, z, w, l):
        return A.Geo()
    c, s = math.cos(yaw), math.sin(yaw)

    def p(u, v):  # game coords
        return tuple(G(x + u * c + v * s, y, z - u * s + v * c))
    return A.Geo.from_pydata([p(-w / 2, l / 2), p(w / 2, l / 2), p(w / 2, -l / 2), p(-w / 2, -l / 2)], [(0, 1, 2, 3)],
                             f'decal:{cell}/{color}')


# ---------------------------------------------------------------------------------- zones
def launch_pad():
    g = A.Geo()
    g.merge(K.bx(40.0, 40.0, 0.4, tuple(G(0, 0.2, -205)), mat='concrete:grey', bev=0.08))
    for s in (-1, 1):
        g.merge(K.bx(40.4, 0.5, 0.45, tuple(G(0, 0.22, -205 + s * 20)), mat='steel:dark'))
        g.merge(K.bx(0.5, 40.4, 0.45, tuple(G(s * 20, 0.22, -205)), mat='steel:dark'))
    d = A.Geo()
    d.merge(decal_quad('ring', 'white', 0, -205, 26, 26, 0.0, 0.42))
    d.merge(decal_quad('num07', 'yellow', 0, -222.0, 9, 5.5, 0.0, 0.43))
    for s in (-1, 1):
        d.merge(decal_quad('hatch', 'yellow', s * 16.5, -188.5, 5, 5, 0.0, 0.42))
        d.merge(decal_quad('hatch', 'yellow', s * 16.5, -221.5, 5, 5, 0.0, 0.42))
    for k in range(6):
        d.merge(decal_quad('arrow', 'white', 0, -176 + k * 14, 4.5, 4.5, PI))
    for k in range(7):
        d.merge(decal_quad('dash', 'yellow', -14, -178 + k * 13, 0.9, 6.5, 0.0))
        d.merge(decal_quad('dash', 'yellow', 14, -178 + k * 13, 0.9, 6.5, 0.0))
    g.merge(d)
    A.unique('pad', g, cols=[((0, 0.2, -205), (40.0, 0.4, 40.0))])
    for (x, z) in ((-24, -229), (24, -229), (-24, -181), (24, -181)):
        place('mast', x, z)
    foot('pad', 0, -205, 44, 44)


def lower_yard():
    """Outside the bounds, 9 m below the deck: fill the E/W/S margins so every outward view
    and the aerial shot read as a continuous industrial district (no dead flat band)."""
    y = LOW
    for (x, z, sx, sy, h, yaw, var, seed) in ((330, -200, 70, 36, 24, 0.0, 'grey', 71), (300, 170, 50, 30, 20, PI / 2, 'blue', 72),
                                              (-320, -250, 80, 40, 28, 0.2, 'oxide', 73), (-300, 230, 60, 30, 22, 0.0, 'grey', 74),
                                              (420, 80, 90, 44, 30, PI / 2, 'oxide', 75), (-420, -60, 90, 40, 26, PI / 2, 'blue', 76)):
        g, _ = B.shed(sx, sy, h, var=var, doors=2, glow_doors=seed % 2 == 0, seed=seed)
        g.transform(Matrix.Translation(G(x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z'))
        A.unique(f'shed_low{seed}', g)
    for (x, z) in ((290, -95), (318, -110), (290, -125), (-290, -330), (-262, -300)):
        place('tank_small', x, z, yaw=RND.uniform(0, 6), y=y, collide=False)
    for zz in (-60.0, 120.0):
        for k in range(22):
            place('track', 262 + k * 12, zz, 0.0, y=y, collide=False)
    for k in range(6):
        place('hopper', 280 + k * 15.2, 120.0, y=y, collide=False)
    for k in range(3):
        place('ladle', 300 + k * 26, -60.0, y=y, collide=False)
    for k in range(18):
        place('track', -262, -240 + k * 12, PI / 2, y=y, collide=False)
    for k in range(5):
        place('hopper', -262, -150 + k * 15.2, PI / 2, y=y, collide=False)
    for (x, z) in ((275, -20), (275, 80), (-275, -120), (-275, 60), (60, -300), (-60, -268)):
        place('mast', x, z, y=y, collide=False)
    g, _ = B.heap(40.0, 26.0, 18.0, 'ore', seed=33)
    g.transform(Matrix.Translation(G(-340, y, 120)))
    A.unique('orepile_low', g)
    g, _ = B.heap(34.0, 22.0, 14.0, 'slag', seed=34)
    g.transform(Matrix.Translation(G(360, y, -300)))
    A.unique('slagheap_low', g)


def edges():
    n = 26
    for i in range(n):
        t = -EDGE + (i + 0.5) * (2 * EDGE / n)
        place('edge', t, -EDGE, PI)                 # south (drop toward -Z)
        if t < 240:
            place('edge', EDGE, t, PI / 2)          # east
            place('edge', -EDGE, t, -PI / 2)        # west
    foot('wall', 0, -EDGE, 2 * EDGE, 4)
    foot('wall', EDGE, 0, 4, 2 * EDGE)
    foot('wall', -EDGE, 0, 4, 2 * EDGE)


def south():
    y = LOW
    # foundry hall (glowing doors toward the pier) + C5 head house
    # foundry hall S-2 on its loading terrace at deck level (the boss-arena backdrop)
    hz = -338.0
    g = MK.foundry_hall(220.0, 60.0, 42.0)
    g.transform(Matrix.Translation(G(100, 0.0, hz)))
    A.unique('hall_s', g)
    t = A.Geo()
    tz0, tz1 = -287.0, -375.0
    t.merge(K.bx(252.0, tz0 - tz1, -LOW, tuple(G(100, LOW / 2, (tz0 + tz1) / 2)), mat='concrete:grey', bev=0.1))
    t.merge(K.bx(252.4, 1.2, 1.0, tuple(G(100, 0.5, tz0 - 0.4)), mat='concrete:grey', bev=0.06))
    t.merge(K.bx(252.5, 0.06, 1.6, tuple(G(100, -1.4, tz0 + 0.03)), mat='trim:hazard2'))
    for k in range(12):
        xx = -24 + k * 22.0
        t.merge(K.bx(1.6, 1.4, -LOW - 1.0, tuple(G(xx, LOW / 2 - 0.5, tz0 + 0.5)), mat='concrete:dark', bev=0.06))
        t.merge(MK.wall_decal(xx + 1.5, xx + 9.0, -tz0 - 0.04, LOW + 0.3, -0.3, 'curtain', RND.choice(['soot', 'stain'])))
    t.merge(K.rail_line([tuple(G(-25, 1.0, tz0 + 0.6)), tuple(G(225, 1.0, tz0 + 0.6))], h=1.1, post=2.5, r=0.05))
    for xx in (8.0, 150.0):   # stairs down to the rail track
        for i in range(12):
            t.merge(K.bx(3.0, 0.8, 0.2, tuple(G(xx + i * 0.8, -i * 0.75, tz0 + 2.0)), mat='trim:grating'))
        t.merge(K.beam(tuple(G(xx, 0.2, tz0 + 3.5)), tuple(G(xx + 9.6, -8.8, tz0 + 3.5)), 0.12, 0.35, 'steel:yellow'))
    A.unique('hall_terrace', t)
    for k in (1, 2):   # the two open (hot) loading bays: furnace light spills onto the terrace
        fx_light(100 - 22 + (-0.375 + 0.25 * k) * 158.4, 0.0, hz + 30 + 14 + 3, 15.0, FIRE, 0.65)
    fx_smoke(100 + 110 - 26 - 10, 1.6 + 78 + 0.9 + 34.0, hz + 8, 2.6, 160.0, 2)
    fx_smoke(100 + 110 - 26 + 9, 1.6 + 78 + 0.9 + 26.0, hz - 12, 1.8, 120.0, 0)
    g = MK.sinter_bins()
    g.transform(Matrix.Translation(G(-100, y, -293)))
    A.unique('bins_s', g)
    # blast furnace B with stoves, casthouse glow, runners toward the pier
    place('furnace', -178, -352, yaw=-PI / 2 + 0.3, y=y, collide=False)
    fx_smoke(-178, y + 90.0, -352, 2.4, 90.0, 2)
    for k in range(3):
        place('stove', -236 + k * 16, -404, y=y, collide=False)
    A.inst('casthouse', (-150, y, -300), yaw=PI * 0.5 + 0.3, collide=False)
    pts = [G(-128, y, -272), G(-70, y, -262), G(40, y, -262), G(130, y, -266)]
    g, cols = B.slag_channel(pts, width=4.0)
    A.unique('runner_s', g)
    for k in range(12):
        t = k / 11.0
        fx_light(-128 + 258 * t, y, -266 + 4 * math.sin(t * 3), 9.0, FIRE, 0.4)
    fx_light(146, y, -270, 18.0, FIRE, 0.5)
    pool = B.slag_pool(10.0, 7.0)
    pool.transform(Matrix.Translation(G(146, y, -270)))
    A.unique('pool_s', pool)
    for i in range(-10, 14):
        place('track', i * 12, -281, 0.0, y=y, collide=False)
    for x in (-60.0, 5.0, 70.0):
        place('ladle', x, -281, y=y, collide=False)
    g, _ = B.heap(30.0, 18.0, 12.0, 'slag', seed=12)
    g.transform(Matrix.Translation(G(236, y, -334)))
    A.unique('slagheap_s', g)
    for (x, z) in ((-40, -270), (60, -272), (160, -290), (-200, -275)):
        place('mast', x, z, y=y, collide=False)
    # stacks, cooling towers, far industry
    stack('stack200', 70, -380, y=y)
    stack('stack_steel', -70, -352, y=y)
    stack('stack120p', 238, -300, y=y)
    place('cooling', -470, -640, y=y, collide=False)
    fx_smoke(-470, LOW + 141.0, -640, 22.0, 120.0, 1)
    place('cooling', -250, -830, yaw=0.5, y=y, collide=False)
    fx_smoke(-250, LOW + 141.0, -830, 22.0, 120.0, 1)
    stack('fstack1', -330, -520, y=y)
    stack('fstack2', 280, -700, y=y)
    stack('fstack3', 480, -900, y=y)
    place('furnace_far', 150, -680, yaw=0.8 + PI, y=y, collide=False)
    fx_smoke(150, y + 270.0, -680, 7.0, 220.0, 2)
    place('far_block0', 200, -480, yaw=0.2, y=y, collide=False)
    place('far_block4', -60, -600, yaw=0.1, y=y, collide=False)
    place('far_block5', 470, -640, yaw=-0.25, y=y, collide=False)
    place('far_block3', 380, -420, yaw=-0.3, y=y, collide=False)
    place('far_block1', -620, -380, yaw=0.5, y=y, collide=False)


def east():
    # casthouse (opening to the west), furnace A outside, stoves, stacks
    A.inst('casthouse', (226, 0, 40), yaw=-PI / 2, collide=False)
    A.collider((226, 13.0, 40), (36.0, 26.0, 48.0))
    foot('bld', 226, 40, 38, 50)
    place('furnace', 300, 30, yaw=PI / 2, y=LOW, scale=1.35, collide=False)
    fx_smoke(300, LOW + 121.0, 30, 3.2, 120.0, 2)
    fx_smoke(226, 30.0, 40, 4.0, 80.0, 1)      # quench steam off the casthouse roof (keeps furnace A readable)
    for dz in (-11.5, 11.5):
        fx_light(204, 0, 40 + dz, 13.0, FIRE, 0.55)
    for k in range(4):
        place('stove', 332 + k * 15, 105 - k * 4, y=LOW, collide=False)
    stack('twinflue', 380, -40, y=LOW)
    stack('stack200p', 330, -150, y=LOW)
    stack('stack70', 236, 100, collide=True)
    stack('stack200', 520, 180, y=LOW, zs=1.2)
    place('cooling', 640, -160, y=LOW, collide=False)
    fx_smoke(640, LOW + 141.0, -160, 22.0, 120.0, 1)
    place('far_block1', 460, 20, yaw=0.4 - PI / 2, y=LOW, collide=False)
    place('far_block4', 640, 160, yaw=-PI / 2 - 0.15, y=SEA + 4.0, collide=False)
    place('furnace_far', 560, -300, yaw=-PI / 2 + 0.4, y=LOW, scale=0.73, collide=False)
    fx_smoke(560, LOW + 200.0, -300, 5.0, 180.0, 2)
    stack('fstack0', 700, 240, y=LOW)
    # slag runner from the casthouse west door to the pit, pit + slag heap
    pts = [G(206, 0, 50), G(150, 0, 50), G(128, 0, 28), G(128, 0, -22)]
    g, cols = B.slag_channel(pts, width=5.0)
    A.unique('slag_runner', g)
    for (c, sz, ang) in cols:
        A.collider_m(Matrix.Translation(c) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Diagonal((sz[0] / 2, sz[1] / 2, sz[2] / 2, 1.0)))
    foot('slag', 170, 50, 80, 16)
    for k in range(6):
        fx_light(200 - k * 11, 0, 50, 9.0, FIRE, 0.4)
    for k in range(5):
        fx_light(128, 0, 24 - k * 10, 9.0, FIRE, 0.4)
    fx_light(128, 0, -30, 20.0, FIRE, 0.55)
    for (xx, zz) in ((190, 50), (150, 50), (128, 10), (128, -30)):   # heat haze / fume over the melt
        fx_smoke(xx, 1.0, zz, 2.2, 26.0, 2)
    foot('slag', 128, 5, 16, 60)
    pool = B.slag_pool(12.0, 8.0)
    pool.transform(Matrix.Translation(G(128, 0, -30)))
    A.unique('slag_pool', pool)
    A.collider((128, 0.5, -38.75), (27.0, 1.0, 1.5))
    A.collider((128, 0.5, -21.25), (27.0, 1.0, 1.5))
    foot('slag', 128, -30, 34, 24)
    g, cols = B.heap(24.0, 16.0, 13.0, 'slag', seed=4)
    g.transform(Matrix.Translation(G(172, 0, -48)))
    A.unique('slagheap', g)
    for c, sz in cols:
        A.collider((172 + c[0], c[2], -48 - c[1]), (sz[0], sz[2], sz[1]))
    foot('heap', 172, -48, 52, 36)
    # torpedo cars on the casthouse spur
    for i in range(-2, 11):
        place('track', 146 + i * 12, 78, 0.0, collide=False)
    place('ladle', 172, 78)
    place('ladle', 196, 78)
    foot('rail', 200, 78, 150, 6)


def west():
    # tank farm with bund walls
    tanks = [('tank_big', -208, -160), ('tank_big', -208, -110), ('tank_small', -178, -62), ('sphere', -214, -40),
             ('sphere', -214, -8), ('tank_big', -206, 60), ('tank_small', -176, 100), ('tank_small', -214, 110)]
    for name, x, z in tanks:
        place(name, x, z, yaw=RND.uniform(0, 6.28), fk='tank', fs=(32, 32))
    for (x0, x1, z0, z1) in ((-236, -168, -186, -84), (-236, -160, 34, 134)):
        g = A.Geo()
        cols = []
        for (ax, az, bx_, bz) in ((x0, z0, x1, z0), (x1, z0, x1, z1), (x1, z1, x0, z1)):
            L = math.hypot(bx_ - ax, bz - az)
            cx, cz = (ax + bx_) / 2, (az + bz) / 2
            w = K.bx(L + 1.2, 1.2, 2.6, (0, 0, 0), mat='concrete:grey', bev=0.08)
            ang = math.atan2(-(bz - az), bx_ - ax)
            w.transform(Matrix.Translation(G(cx, 1.3, cz)) @ Matrix.Rotation(ang, 4, 'Z'))
            g.merge(w)
            g.merge(K.bx(L + 1.2, 0.05, 0.9, (0, 0, 0), mat='trim:hazard2').transform(
                Matrix.Translation(G(cx, 0.9, cz)) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation(Vector((0, 0.62, 0)))) or A.Geo())
            A.collider((cx, 1.3, cz), (L + 1.2 if abs(az - bz) < 1 else 1.2, 2.6, L + 1.2 if abs(ax - bx_) < 1 else 1.2))
        A.unique('bund', g)
    # pipe rack N-S at x=-150 (bents every 10 m, pipes on two levels)
    z0, z1 = -214, 150
    n = int((z1 - z0) / 10)
    for i in range(n + 1):
        place('pipebent', -150, z0 + i * 10, yaw=0.0)
    A.collider((-150, 14.2, (z0 + z1) / 2), (11.6, 5.8, z1 - z0 + 1.0))
    g = A.Geo()
    for (dx, y, r, m) in ((-4.0, 12.8, 0.8, 'steel:galv'), (-2.2, 12.6, 0.55, 'steel:rust'), (-0.6, 12.9, 0.9, 'steel:bone'),
                          (1.3, 12.6, 0.5, 'steel:oxide'), (3.0, 12.7, 0.65, 'steel:galv'), (-3.2, 17.7, 1.2, 'steel:bone'),
                          (0.2, 17.5, 0.6, 'steel:rust'), (2.6, 17.9, 1.4, 'steel:grey')):
        g.merge(K.tube(G(-150 + dx, y, z0 - 4), G(-150 + dx, y, z1 + 4), r, m, 16))
        for zz in range(z0 + 20, z1, 60):      # flange collars (outer face + lips only)
            g.merge(K.band(r, r, -0.25, 0.5, 0.25, 12, 'steel:dark').rotate((90, 0, 0)).move(G(-150 + dx, y, zz)))
    # branch loops to the tanks
    for zz in (-135, -20, 80):
        g.merge(P.pipe_run([G(-154, 12.8, zz), G(-170, 12.8, zz), G(-170, 3.0, zz), G(-190, 3.0, zz)], r=0.7, bend=1.6, segs=16,
                           mat='steel:galv', flanges=False))
        A.collider((-162, 12.8, zz), (16.0, 1.6, 1.6))
        A.collider((-170, 7.9, zz), (1.6, 11.4, 1.6))
        A.collider((-180, 3.0, zz), (20.0, 1.6, 1.6))
        for xx in (-176.0, -186.0):   # pipe sleepers
            g.merge(K.bxz(0.6, 1.8, 2.3, 0, 0, 0, mat='concrete:grey').move(G(xx, 0, zz)))
    A.unique('pipes_w', g)
    foot('rack', -150, (z0 + z1) / 2, 12, z1 - z0)
    # outside west: more tanks, flare stack, far blocks
    for (x, z) in ((-300, -120), (-300, -60), (-330, 20), (-290, 90), (-360, 150)):
        place('tank_big', x, z, yaw=RND.uniform(0, 6), y=LOW, collide=False)
    stack('stack120', -320, -200, y=LOW)
    stack('fstack3', -600, 80, y=LOW, zs=0.85)
    place('far_block1', -520, -150, yaw=0.3 + PI / 2, y=LOW, collide=False)
    place('far_block3', -480, 200, yaw=-0.2 + PI / 2, y=LOW, collide=False)
    place('far_block4', -700, -380, yaw=PI / 2 + 0.2, y=LOW, collide=False)
    place('furnace_far', -720, 380, yaw=PI / 2 - 0.5, y=LOW, scale=(-0.95, 0.95, 0.95), collide=False)
    fx_smoke(-720, LOW + 270.0, 380, 7.0, 220.0, 2)
    place('cooling', -760, 120, y=LOW, collide=False)
    fx_smoke(-760, LOW + 141.0, 120, 22.0, 120.0, 1)


def lower_yard_fill():
    """Dense infrastructure right beyond the E/W deck edges (the view over every railing):
    pipe racks on bents, a 4-track wagon yard, ore/slag stockpiles, lamp masts, sheds."""
    rs = random.Random(616)
    y = LOW
    for side in (-1, 1):
        xr = side * 266.0
        z0, z1 = -236, 236
        for i in range(int((z1 - z0) / 10) + 1):
            place('pipebent', xr, z0 + i * 10, yaw=0.0, y=y, collide=False)
        g = A.Geo()
        for (dx, yy, r, m) in ((-4.0, 12.8, 0.8, 'steel:galv'), (-2.1, 12.6, 0.5, 'steel:rust'), (-0.4, 12.9, 0.95, 'steel:bone'),
                               (1.6, 12.7, 0.6, 'steel:oxide'), (3.3, 12.6, 0.5, 'steel:galv'), (-2.8, 17.8, 1.3, 'steel:grey'),
                               (0.6, 17.6, 0.7, 'steel:rust'), (3.0, 17.9, 1.1, 'steel:bone')):
            g.merge(K.tube(G(xr + dx, y + yy, z0 - 4), G(xr + dx, y + yy, z1 + 4), r, m, 8))
        A.unique('rack_low', g)
        # wagon yard: 4 tracks with hopper / ladle strings
        for t in range(3):
            xt = side * (284.0 + t * 7.0)
            for k in range(36):
                place('track', xt, -210 + k * 12, PI / 2, y=y, collide=False)
            zz = -200 + rs.uniform(0, 60)
            while zz < 200:
                n = rs.randint(3, 6)
                for k in range(n):
                    if zz + k * 15.2 < 205:
                        place('hopper', xt, zz + k * 15.2, PI / 2, y=y, collide=False)
                zz += n * 15.2 + rs.uniform(70, 140)
        for z in (-200, -110, -20, 70, 160):
            place('mast', side * 312.0, z + rs.uniform(-8, 8), y=y, collide=False)
        # stockpiles + small sheds beyond the wagon yard
        for (z, rx, ry, h, var) in ((-150, 26, 16, 12, 'ore'), (40, 30, 18, 14, 'coal'), (170, 22, 14, 10, 'slag')):
            g, _ = B.heap(rx, ry, h, var, seed=int(z) + 900 + side)
            g.transform(Matrix.Translation(G(side * 350.0, y, z)) @ Matrix.Rotation(PI / 2, 4, 'Z'))
            A.unique('heap_low', g)
        for (z, sx, sy, hh, var, seed) in ((-60, 40, 22, 16, 'oxide', 81), (110, 30, 20, 14, 'blue', 82)):
            g, _ = B.shed(sx, sy, hh, var=var, doors=2, glow_doors=seed % 2 == 1, seed=seed + side)
            g.transform(Matrix.Translation(G(side * 344.0, y, z)) @ Matrix.Rotation(-side * PI / 2, 4, 'Z'))
            A.unique('shed_fill', g)


def edge_dressing():
    """Break the clean pier perimeter: huts cantilevered over the E/W deck edges on stilts,
    stair towers down to the lower yard, a container wall and jetties/pontoon/dolphins along
    the sea wall, lamp rows on the far shores (they pin the far districts to the ground)."""
    rs = random.Random(515)
    for (x, z, side, var) in ((EDGE, -175.0, 1, 'blue'), (EDGE, 12.0, 1, 'oxide'), (-EDGE, -250.0 + 60.0, -1, 'grey'),
                              (-EDGE, 180.0, -1, 'cream')):
        # hut: 14 m along the edge, 12 m deep, half over the edge; stilts to the lower yard
        g = A.Geo()
        cx = x + side * 3.0
        g.merge(K.bx(12.0, 14.0, 0.6, tuple(G(cx, 0.3, z)), mat='steel:dark'))
        g.merge(K.bx(11.0, 13.0, 6.0, tuple(G(cx + side * 0.5, 3.6, z)), mat='corr:' + var))
        g.merge(K.bx(11.6, 13.6, 0.4, tuple(G(cx + side * 0.5, 6.8, z)), mat='steel:dark'))
        g.merge(K.bx(0.12, 9.0, 1.2, tuple(G(cx - side * 5.03, 4.6, z)), mat='trim:window'))
        g.merge(K.bx(0.14, 2.2, 3.2, tuple(G(cx - side * 5.05, 2.2, z + 4.5)), mat='steel:dark'))
        for dz in (-6.0, 6.0):
            g.merge(K.bx(0.8, 0.8, -LOW + 0.2, tuple(G(cx + side * 5.5, LOW / 2, z + dz)), mat='steel:dark'))
            g.merge(K.beam(tuple(G(cx + side * 5.5, LOW + 1.0, z + dz)), tuple(G(x, -0.2, z + dz)), 0.4, 0.4, 'steel:dark'))
        g.merge(K.flood(0, 0, 0, 0.0).transform(A.xform((cx - side * 5.2, 6.4, z - 3.0), yaw=-side * PI / 2)) or A.Geo())
        g.merge(K.beacon(0, 0, 0, 0.5).transform(A.xform((cx + side * 4.5, 7.4, z + 5.0))) or A.Geo())
        A.unique('edgehut', g, cull={'grounds': (-9.0,)})
        A.collider((cx, 3.6, z), (12.0, 7.2, 14.0))
        foot('bld', cx, z, 14, 16)
        # stair tower down to the lower yard beside the hut
        g = A.Geo()
        sz0 = z + 14.0
        sx0 = x + side * 4.0
        for i in range(12):
            g.merge(K.bx(3.0, 1.0, 0.2, tuple(G(sx0 + side * 1.5, -0.4 - i * 0.72, sz0 + i * 0.8)), mat='trim:grating'))
        g.merge(K.beam(tuple(G(sx0 + side * 3.1, 0.6, sz0)), tuple(G(sx0 + side * 3.1, LOW + 1.4, sz0 + 9.6)), 0.1, 0.1, 'steel:yellow'))
        for dz in (0.0, 9.6):
            g.merge(K.bx(0.3, 0.3, -LOW, tuple(G(sx0 + side * 3.0, LOW / 2, sz0 + dz)), mat='steel:yellow'))
        A.unique('edgestair', g)
    # container wall along the sea wall west of the cranes (sea-side cover line, tall)
    cc = ['c_red', 'c_blue', 'c_green', 'c_grey', 'c_cream', 'c_orange']
    for i in range(9):
        x = -236 + i * 12.8
        h = rs.choice((2, 3, 3, 4))
        for k in range(h):
            place('cont_' + rs.choice(cc), x + rs.uniform(-0.1, 0.1), 244.0, yaw=rs.uniform(-0.01, 0.01), y=k * 2.59, collide=False)
        A.collider((x, h * 2.59 / 2, 244.0), (12.19, h * 2.59, 2.44))
    foot('cont', -185, 244, 118, 6)
    # jetties, pontoon and dolphins off the quay (outside the bounds)
    for (x, y, L) in ((-178.0, 0.0, 62.0), (372.0, LOW, 62.0), (-452.0, LOW, 62.0)):
        A.inst('jetty', (x, y, 252.2), yaw=0.0, collide=False)
        fx_shore(x, 252.2 + L / 2, 5.4, L / 2, k=0.7)
    A.inst('pontoon', (64.0, 0.0, 285.0), yaw=0.0, collide=False)
    fx_shore(64.0, 285.0, 4.8, 17.2, r=1.0, k=0.9)
    for (x, z) in ((-60.0, 292.0), (-10.0, 292.0), (160.0, 300.0), (250.0, 296.0), (520.0, 300.0), (-300.0, 298.0)):
        A.inst('dolphin', (x, 0.0, z), yaw=rs.uniform(-0.2, 0.2), collide=False)
        fx_shore(x, z, 3.2, 3.2, r=2.6, k=0.8)
    # lamp rows along the far shore and the peninsula edge
    g = A.Geo()
    for i in range(80):
        x = -1080 + i * 30.0
        g.merge(K.bx(0.6, 0.6, 7.0, tuple(G(x, SEA + 7.5, 763.0)), mat='far:dark'))
        g.merge(K.bx(1.8, 1.2, 0.8, tuple(G(x, SEA + 11.4, 763.0)), mat='glow:sodium' if rs.random() < 0.8 else 'glow:dim'))
    for i in range(28):
        z = 270 + i * 30.0
        g.merge(K.bx(0.6, 0.6, 7.0, tuple(G(428.0, SEA + 7.5, z)), mat='far:dark'))
        g.merge(K.bx(1.2, 1.8, 0.8, tuple(G(428.0, SEA + 11.4, z)), mat='glow:sodium' if rs.random() < 0.8 else 'glow:dim'))
    A.unique('farlamps', g, weighted=False, noshadow=True)


TRN = [0]


def conveyor(p0, p1, supports=None, step=24.0):
    """Gallery from p0 to p1 (game coords of the gallery BOTTOM centreline)."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    Lh = math.hypot(d.x, d.z)
    L = d.length
    yaw = math.atan2(d.x, d.z)
    pitch = math.atan2(d.y, Lh)
    n = max(1, int(math.ceil(L / step)))
    s = L / (n * step)
    for i in range(n):
        p = a + d * (i / n)
        A.inst('gallery', (p.x, p.y, p.z), yaw=yaw, pitch=pitch, scale=(1.0, s, 1.0), collide=False)
    # one collider along the whole gallery
    mid = (a + b) * 0.5
    A.collider((mid.x, mid.y + 3.2, mid.z), (7.6, 6.6, L), yaw=yaw, pitch=pitch)
    if supports is None:
        k = max(1, int(L / 48))
        supports = [i / (k + 1) for i in range(1, k + 1)]
    if True:
        for i, t in enumerate(supports):
            p = a + d * t
            gy = 0.0 if max(abs(p.x), abs(p.z)) < EDGE else LOW
            h = p.y - 0.4 - gy
            hs = min((24, 32, 40, 48, 56, 64), key=lambda v: abs(v - h) if v >= h - 3 else 999)
            suf = ('', 'p', 'c', 'p', '', 'c')[(TRN[0] + i) % 6]     # alternate service platforms / risers
            A.inst(f'trestle{hs}{suf}', (p.x, p.y - hs - 0.3 + 0.0, p.z), yaw=yaw + (PI if (TRN[0] + i) % 2 else 0.0), collide=False)
            if gy == 0.0:
                A.collider((p.x, (p.y - 0.3) / 2, p.z), (9.0, p.y - 0.3, 7.0), yaw=yaw)
            foot('trestle', p.x, p.z, 12, 10, yaw)
        TRN[0] += len(supports)


def mole(cx=10.0, cz=550.0, W=340.0, D=160.0):
    """Reclaimed ore mole 220-380 m off the quay carrying the HERO blast furnace (No.6) on the
    launch axis: quay walls with fenders, bollards + hazard band, foam line (FX_shore)."""
    y = SEA + 4.0
    g = A.Geo()
    M0 = Matrix.Translation(G(cx, y, cz))
    g.merge(K.bxz(W, D, 7.0, 0, 0, -7.0, mat='concrete:dark').transform(M0))
    g.merge(K.bxz(W + 1.2, D + 1.2, 0.8, 0, 0, -0.4, mat='concrete:grey', bev=0.06).transform(M0))
    for k in range(int(W / 12)):                      # fenders + bollards along the pier-side face
        x = cx - W / 2 + 6 + k * 12
        g.merge(K.bxz(2.0, 0.8, 4.0, 0, 0, -5.0, mat='steel:black').transform(Matrix.Translation(G(x, y, cz - D / 2 - 0.9))))
        g.merge(K.bxz(0.9, 0.9, 1.0, 0, 0, 0.4, mat='steel:dark').transform(Matrix.Translation(G(x + 3, y, cz - D / 2 + 1.5))))
    g.merge(K.bxz(W, 0.06, 0.8, 0, 0, -0.35, mat='trim:hazard2').transform(Matrix.Translation(G(cx, y, cz - D / 2 - 0.62))))
    A.unique('mole', g)
    fx_shore(cx, cz, W / 2 + 0.6, D / 2 + 0.6, r=2.0, k=1.4)
    # furnace (mirrored near kit x2.6: skip incline runs west, dust catcher east), stoves behind
    hx, hz = cx + 55.0, cz + 18.0
    A.inst('furnace', (hx, y, hz), yaw=0.2, scale=(-2.6, 2.6, 2.6), collide=False)
    for k in range(3):
        A.inst('stove', (hx - 20 + k * 26, y, hz + 58 - k * 4), scale=(2.3, 2.3, 2.0 + 0.15 * k), collide=False)
    # casthouse on the furnace's south-east, tap floor opening toward the WEST (seen obliquely)
    A.inst('casthouse', (hx + 62, y, hz - 52), yaw=-PI / 2 + 0.35, scale=1.8, collide=False)
    stack('stack200p', cx - 120, cz + 45, y=y, kind=0, zs=1.1)
    stack('stack_steel', cx - 95, cz + 60, y=y, kind=1)
    g2, _ = B.heap(30.0, 20.0, 14.0, 'ore', seed=55)
    g2.transform(Matrix.Translation(G(cx - 60, y, cz - 45)))
    A.unique('mole_ore', g2)
    for (x, z) in ((cx - 140, cz - 62), (cx + 140, cz - 64), (cx - 10, cz - 70)):
        place('mast', x, z, y=y, collide=False)
    fx_smoke(hx - 6, y + 230.0, hz + 4, 7.5, 300.0, 2)
    fx_smoke(hx + 62, y + 46.0, hz - 52, 9.0, 160.0, 1)
    for k in range(2):
        fx_light(hx + 40, y, hz - 52 + (k - 0.5) * 30, 20.0, FIRE, 0.5)


def drive_house(x, y, z, yaw):
    """Conveyor drive / transfer house at a gallery kink: clad box on its own tower with a
    walkway, motor room windows, roof vents, beacon (breaks the conveyor's straight bar)."""
    g = A.Geo()
    w, d, hh = 13.0, 11.0, 10.0
    g.merge(K.bxz(w + 2.0, d + 2.0, 0.6, 0, 0, -0.6, mat='steel:dark'))
    g.merge(K.bxz(w, d, hh, 0, 0, 0.0, mat='corr:blue'))
    g.merge(K.bxz(w + 0.6, d + 0.6, 0.5, 0, 0, hh, mat='steel:dark'))
    for s_ in (-1, 1):
        g.merge(K.bxz(w * 0.8, 0.12, 1.8, 0, s_ * (d / 2 + 0.03), hh - 3.2, mat='trim:window'))
        g.merge(K.bxz(2.4, 0.13, 1.6, -2.0 * s_, s_ * (d / 2 + 0.05), hh - 3.1, mat='trim:window_lit'))
        g.merge(K.bxz(0.12, d * 0.6, 1.4, s_ * (w / 2 + 0.03), 0, 2.0, mat='trim:louvre'))
        for c in (-1, 1):
            g.merge(K.bxz(0.5, 0.5, hh, c * (w / 2), s_ * (d / 2), 0.0, mat='steel:yellow'))
    g.merge(MK.wall_decal(-w / 2, w / 2, -d / 2 - 0.05, hh * 0.35, hh, 'curtain', 'soot'))
    g.merge(MK.wall_decal(-w / 2, w / 2, d / 2 + 0.05, hh * 0.4, hh, 'curtain', 'stain', facing=1))
    for i in range(3):
        g.merge(P.cylinder(0.6, 2.6, 12, bevel=0.0, mat='steel:galv', z0=hh + 0.5).move(-3.5 + i * 3.5, 1.5, 0))
    g.merge(K.bxz(4.0, 3.0, 1.8, 3.0, -2.5, hh + 0.5, mat='steel:galv'))
    g.merge(K.rail_line([(-w / 2 - 0.9, -d / 2 - 0.9, -0.0), (w / 2 + 0.9, -d / 2 - 0.9, 0.0), (w / 2 + 0.9, d / 2 + 0.9, 0.0)], h=1.1, post=2.5, r=0.05))
    g.merge(K.beam((w / 2 - 1, d / 2 - 1, hh + 0.5), (w / 2 - 1, d / 2 - 1, hh + 7.0), 0.2, 0.2, 'steel:galv'))
    g.merge(K.beacon(w / 2 - 1, d / 2 - 1, hh + 7.4, 0.6))
    g.merge(K.flood(0, -d / 2 - 0.5, hh - 0.8, 0.0))
    M = Matrix.Translation(G(x, y - 0.6 + 0.6, z)) @ Matrix.Rotation(yaw, 4, 'Z')
    g.transform(M)
    A.unique('drivehouse', g)
    A.collider((x, y + hh / 2, z), (w + 2.0, hh + 1.2, d + 2.0), yaw=yaw)
    hs = 32
    A.inst('trestle32p', (x, y - hs - 0.6, z), yaw=yaw + PI / 2, scale=(1.4, 1.6, 1.0), collide=False)
    A.collider((x, (y - 0.6) / 2, z), (12.0, y - 0.6, 10.5), yaw=yaw)
    foot('trestle', x, z, 14, 13, yaw)


def overhead():
    # transfer tower + stockhouse
    g, cols = B.transfer_tower()
    g.transform(Matrix.Translation(G(-100, 0, 20)))
    A.unique('ttower', g)
    A.collider((-100, 26.0, 20), (22.0, 52.0, 22.0))
    foot('bld', -100, 20, 26, 26)
    g, cols = B.brut_block(30.0, 24.0, 56.0, seed=41, doors=2, windows=True, stair=True)
    M = Matrix.Translation(G(70, 0, 52)) @ Matrix.Rotation(PI / 2, 4, 'Z')
    g.transform(M)
    A.unique('stockhouse', g)
    cols_m(M, cols)
    foot('bld', 70, 52, 30, 40)
    # dock unloader hopper house
    g, _ = B.shed(18.0, 18.0, 26.0, var='blue', monitor=False, doors=1, seed=51)
    g.transform(Matrix.Translation(G(-100, 0, 230)))
    A.unique('unloader', g)
    A.collider((-100, 14.0, 230), (19.2, 28.0, 19.2))
    foot('bld', -100, 230, 22, 22)
    # galleries (bottom centreline)
    conveyor((-100, 30.0, 219), (-100, 38.0, 31))       # C1 dock -> transfer tower
    # C2 transfer tower -> drive house (kink) -> stockhouse: two pitches, the house breaks the bar
    kx, ky, kz = -16.0, 34.5, 37.0
    conveyor((-89, 30.0, 24), (kx - 6.5, ky, kz - 1.2), supports=[0.5])
    conveyor((kx + 6.5, ky + 1.2, kz + 1.2), (53, 48.0, 50), supports=[0.55])
    drive_house(kx, ky, kz, math.atan2(53 - (-89), 50 - 24))
    c3a, c3b = (87, 48.0, 48), (290, 64.0, 31)          # C3 stockhouse -> furnace A top
    conveyor(c3a, c3b, supports=[(x - 87) / 203 for x in (130, 180, 246)])
    conveyor((-100, 34.0, 9), (-100, 37.0, -280), supports=[(9 - z) / 289 for z in (-35, -80, -150, -200, -264)])  # C5
    # ore stockpile by the stockhouse
    g, cols = B.heap(24.0, 16.0, 14.0, 'ore', seed=8)
    g.transform(Matrix.Translation(G(-5, 0, 145)))
    A.unique('orepile', g)
    for c, sz in cols:
        A.collider((-5 + c[0], c[2], 145 - c[1]), (sz[0], sz[2], sz[1]))
    foot('heap', -5, 145, 52, 36)
    # ore stocking bridge straddling the pile, on its own rails (N-S)
    place('orebridge', -10, 150, 0.0)
    for xr in (-74.0, 54.0):
        for k in range(5):
            A.inst('crail', (xr, 0.0, 112 + k * 20), yaw=PI / 2, collide=False)
    foot('rail', -74, 150, 6, 100)
    foot('rail', 54, 150, 6, 100)


def dock():
    # quay edge + crane rails + cranes
    for i in range(-13, 13):
        place('quay', i * 20 + 10, 250.5, 0.0, collide=False)
    for i in list(range(-45, -12)) + list(range(12, 45)):
        place('quay', i * 20 + 10, 250.5, 0.0, y=LOW, collide=False)
    for i in range(-3, 13):
        place('crail', i * 20 + 10, 205, 0.0, collide=False)
        place('crail', i * 20 + 10, 235, 0.0, collide=False)
    for x in (10.0, 115.0, 205.0):
        place('crane', x, 220, 0.0)
    foot('quay', 0, 243, 520, 14)
    # container blocks on the dock
    cols = ['c_red', 'c_blue', 'c_green', 'c_grey', 'c_cream', 'c_orange']
    blocks = [(-215, 165, 6, 2, 3), (-178, 165, 6, 2, 2), (-55, 150, 5, 2, 4), (-55, 180, 5, 2, 3), (60, 150, 4, 3, 2),
              (150, 158, 6, 3, 3), (215, 158, 5, 2, 4), (150, 188, 6, 2, 2)]
    for (bx0, bz0, nrow, ncol, hmax) in blocks:
        for c in range(ncol):
            for r in range(nrow):
                x = bx0 + c * 12.8
                z = bz0 + r * 2.6
                h = RND.randint(1, hmax)
                for k in range(h):
                    place('cont_' + RND.choice(cols), x + RND.uniform(-0.08, 0.08), z, yaw=RND.uniform(-0.01, 0.01),
                          y=k * 2.59, collide=False)
                A.collider((x, h * 2.59 / 2, z), (12.19, h * 2.59, 2.44))
        W, D = ncol * 12.8, nrow * 2.6
        cx, cz = bx0 + (ncol - 1) * 6.4, bz0 + (nrow - 1) * 1.3
        foot('cont', cx, cz, W + 4, D + 4)
    # dock rail + hoppers
    for i in range(-1, 21):
        place('track', i * 12, 105, 0.0, collide=False)
    for k in range(5):
        place('hopper', -10 + k * 15.2, 105)
    for k in range(3):
        place('hopper', 150 + k * 15.2, 105)
    foot('rail', 114, 105, 252, 6)
    # breakwater, light, sunk carrier, far shore
    g = B.breakwater(900.0)
    g.transform(Matrix.Translation(G(-150, SEA, 680)) @ Matrix.Rotation(PI, 4, 'Z'))
    A.unique('breakwater', g, noshadow=True)
    A.inst('light', (300, SEA + 9.5, 690), collide=False)
    g = B.bulk_carrier()
    M = A.xform((150, SEA - 9.5, 345), yaw=2.5, pitch=-0.085, roll=-0.14)
    g.transform(M)
    A.unique('carrier', g, noshadow=True)
    fx_shore(150.0, 345.0, 16.0, 84.0, yaw=2.5, r=10.0, k=1.6)
    for t in (-0.42, -0.2, 0.05, 0.3):       # surf / spray where the swell breaks over the awash bow
        fx_smoke(150 - math.sin(2.5) * 180 * t, SEA + 0.6, 345 - math.cos(2.5) * 180 * t, 2.6, 22.0, 3)
    # spray bursts where the swell breaks on the breakwater armour (every ~30 m)
    for i in range(24):
        x = -585.0 + i * 36.0 + RND.uniform(-8, 8)
        fx_smoke(x, SEA + 1.0, 693.0 + RND.uniform(-2, 3), 3.0, 30.0, 3)
    for (x, z, yaw) in ((-400, 1500, 0.1), (-250, 1520, 0.0), (150, 1480, -0.1), (500, 1550, 0.2), (900, 1400, 0.3)):
        A.inst('far_crane', (x, 0.0, z), yaw=yaw, collide=False)
    for (x, z, n) in ((-700, 1700, 0), (-100, 1750, 2), (300, 1650, 1), (800, 1800, 3), (1200, 1500, 0)):
        A.inst(f'far_block{n}', (x, 0.0, z), yaw=PI + RND.uniform(-0.3, 0.3), collide=False)
    for (x, z, k) in ((-550, 1800, 'fstack1'), (50, 1900, 'fstack0'), (650, 1750, 'fstack3'), (1100, 1650, 'fstack2')):
        A.inst(k, (x, 0.0, z), collide=False)
    # across the bay: pier 5/6 silhouettes at 650-1100 m
    for (x, z, yaw) in ((-620, 820, 0.0), (-470, 830, 0.0), (520, 760, 0.1), (660, 770, 0.1), (820, 790, 0.1)):
        A.inst('crane', (x, SEA + 4.0, z), yaw=yaw, collide=False)
    for (x, z, k, yaw) in ((-760, 880, 0, 0.1), (-300, 900, 2, 0.0), (420, 860, 1, 0.1), (700, 900, 3, 0.0), (1000, 820, 0, 0.3)):
        A.inst(f'far_block{k}', (x, SEA + 4.0, z), yaw=PI + yaw, collide=False)
    for (x, z, k) in ((-560, 930, 'fstack1'), (-200, 980, 'fstack2'), (600, 940, 'fstack0'), (900, 900, 'fstack3')):
        stack(k, x, z, y=SEA + 4.0)
    for (x, z) in ((-380, 900), (320, 880)):
        A.inst('tank_big', (x, SEA + 4.0, z), yaw=0.3, collide=False)
    # the Pier 5 smelter wall: horizon-spanning mass at 1-1.3 km behind the far shore
    for (x, z, k, yaw) in ((-520, 1010, 'far_block4', 0.05), (-10, 1040, 'far_block4', -0.04), (520, 990, 'far_block5', 0.1),
                           (-880, 980, 'far_block5', 0.2), (820, 1010, 'far_block4', -0.1)):
        A.inst(k, (x, SEA + 4.0, z), yaw=PI + yaw, collide=False)
    for (x, z, k, yaw) in ((-250, 960, 'furnace300', 0.3), (290, 960, 'furnace300b', -0.9), (-700, 940, 'furnace220', 0.9)):
        sc = {'furnace300': 1.0, 'furnace300b': (-0.95, 0.95, 0.95)}.get(k, 0.73)
        A.inst('furnace_far', (x, SEA + 4.0, z), yaw=yaw, scale=sc, collide=False)
        fx_smoke(x, SEA + 4.0 + {'furnace300': 270.0, 'furnace300b': 256.0}.get(k, 200.0), z, 7.0, 240.0, 2)
    g = A.Geo()
    for (x0, x1, z0, z1) in ((-1100, 1300, 760, 1400),):
        g.merge(A.Geo.from_pydata([tuple(G(x0, SEA + 4.0, z0)), tuple(G(x0, SEA + 4.0, z1)), tuple(G(x1, SEA + 4.0, z1)), tuple(G(x1, SEA + 4.0, z0))],
                                  [(0, 1, 2, 3)], 'far:dark'))
        g.merge(K.bx(x1 - x0, 4.0, 5.0, tuple(G((x0 + x1) / 2, SEA + 1.5, z0 + 2.0)), mat='far'))
    A.unique('farshore', g, weighted=False, noshadow=True)
    # HERO landmark on the play axis (+Z from the launch pad, rising over the C2 gallery): Furnace
    # No.6 on the reclaimed ore mole 250-330 m off the quay - the near-kit blast furnace at 2.6x
    # (mirrored, own yaw), stoves, casthouse, a stack, ore pile, quay walls with fenders + foam
    mole()
    # east peninsula (Pier 9 smelters): giant stacks + cooling towers read above the haze band
    g = A.Geo()
    g.merge(A.Geo.from_pydata([tuple(G(430, SEA + 4.0, 250)), tuple(G(430, SEA + 4.0, 1100)), tuple(G(1900, SEA + 4.0, 1100)),
                               tuple(G(1900, SEA + 4.0, 250))], [(0, 1, 2, 3)], 'far:dark'))
    g.merge(K.bx(6.0, 850.0, 5.0, tuple(G(432, SEA + 1.5, 675)), mat='far'))
    A.unique('peninsula', g, weighted=False, noshadow=True)
    for (x, z, k, sc) in ((470, 520, 'fstack1', 1.25), (600, 450, 'fstack0', 1.4), (720, 640, 'fstack3', 1.3), (-360, 790, 'fstack2', 1.6)):
        A.inst(k, (x, SEA + 4.0, z), scale=sc, collide=False)
        fx_smoke(x, SEA + 4.0 + STACK_TOP[k][0] * sc, z, STACK_TOP[k][1] * sc, 260.0, 0 if k != 'fstack0' else 1)
    for (x, z) in ((640, 760), (840, 560)):
        A.inst('cooling', (x, SEA + 4.0, z), collide=False)
        fx_smoke(x, SEA + 145.0, z, 22.0, 130.0, 1)
    A.inst('furnace', (520, SEA + 4.0, 690), yaw=1.2, collide=False)
    fx_smoke(520, SEA + 94.0, 690, 2.4, 90.0, 2)
    for (x, z, k) in ((560, 300, 0), (760, 380, 2), (900, 700, 1)):
        A.inst(f'far_block{k}', (x, SEA + 4.0, z), yaw=-PI / 2 + 0.2, collide=False)


def trench_plan():
    for x in (-36.0, -12.0, 12.0, 36.0):
        TRENCH.append((x, -152.0, 12.2, 1.6))
    for x in (-84.0, -60.0, 60.0, 84.0, 108.0):
        TRENCH.append((x, -84.0, 12.2, 1.6))
    for z in (-212.0, -188.0, -164.0):
        TRENCH.append((-64.0, z, 1.6, 12.2))


def yard():
    # main E-W track through the south yard with hopper strings
    for i in range(-12, 21):
        place('track', i * 12 + 6, -120, 0.0, collide=False)
    foot('rail', 53, -120, 396, 6)
    for k in range(3):
        place('hopper', -134 + k * 15.2, -120)
    for k in range(3):
        place('hopper', 70 + k * 15.2, -120)
    place('hopper', -60, -120)
    # container clusters (mid-yard cover)
    clusters = [(-48, -62, [(0, 0, 0), (0, 0, 1), (0, 2.6, 0), (0, 5.2, 0), (0, 5.2, 1)], 0.15),
                (46, -40, [(0, 0, 0), (0, 2.6, 0), (0, 2.6, 1), (0, 2.6, 2)], -0.35),
                (-18, 8, [(0, 0, 0), (12.8, 0, 0), (0, 0, 1), (6.4, 2.6, 0)], 0.05),
                (92, -96, [(0, 0, 0), (0, 2.6, 0), (0, 0, 1)], 0.6),
                (-86, -170, [(0, 0, 0), (0, 2.6, 0), (0, 2.6, 1)], -0.2),
                (58, -186, [(0, 0, 0), (0, 0, 1), (0, 0, 2), (0, 2.6, 0)], 0.3)]
    cc = ['c_red', 'c_blue', 'c_green', 'c_grey', 'c_cream', 'c_orange']
    for (cx, cz, items, yaw) in clusters:
        c, s = math.cos(yaw), math.sin(yaw)
        for (dx, dz, lvl) in items:
            x = cx + dx * c + dz * s
            z = cz - dx * s + dz * c
            A.inst('cont_' + RND.choice(cc), (x, lvl * 2.59, z), yaw=yaw + RND.uniform(-0.03, 0.03), collide=True)
        foot('cont', cx, cz, 18, 12, yaw)
    # low cover: barriers, billets, spools, jersey rows
    for (x, z, yaw) in ((-30, -140, 0.2), (24, -150, -0.3), (-62, -30, 1.3), (28, -4, 0.1), (-8, -84, 0.0), (60, -70, 0.9),
                        (-118, -60, 0.4), (110, -140, -0.2), (-40, 40, 0.0), (152, -30, 0.5), (-68, 128, 0.2),
                        (30, 60, 1.1), (100, 20, 0.3), (-130, 190, 0.0)):
        place('barrier', x, z, yaw, fk='cover', fs=(8, 4))
    for (x, z, yaw) in ((-36, -104, 0.0), (40, -108, 0.05), (-126, -155, 0.3), (160, -150, 0.1)):
        place('billets', x, z, yaw, fk='cover', fs=(11, 6))
    for (x, z, yaw) in ((-70, -142, 0.4), (82, 82, 0.0), (-60, 60, 1.2)):
        place('spools', x, z, yaw, fk='cover', fs=(14, 8))
    for (x, z, yaw) in ((-120, -225, 0.0), (120, -225, 0.0), (40, -230, 0.0), (-40, -230, 0.0)):
        place('jersey', x, z, yaw)
    # buildings in the yard
    for (name, x, z, sx, sy, h, yaw, seed, var) in (('pumphouse', -40, 110, 30.0, 20.0, 14.0, 0.0, 61, ''),
                                                   ('control', 140, -175, 28.0, 20.0, 22.0, 0.25, 62, 'grey'),
                                                   ('substation', -195, -215, 22.0, 14.0, 10.0, 0.0, 63, 'dark'),
                                                   ('workshop', 120, 150, 26.0, 18.0, 16.0, 0.0, 64, 'grey')):
        g, cols = B.brut_block(sx, sy, h, seed=seed, doors=1, var=var, stair=h > 15, cant=name in ('control', 'workshop'))
        M = Matrix.Translation(G(x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Z')
        g.transform(M)
        A.unique(name, g)
        cols_m(M, cols)
        foot('bld', x, z, sx + 14, sy + 8, yaw)
    # blast walls (L) around the relays
    for (x, z, yaw) in ((-128, 128, 0.0), (178, -116, 0.3), (22, 190, PI)):
        g = A.Geo()
        g.merge(K.bxz(22.0, 1.6, 7.0, 0, 0, 0.0, mat='concrete', bev=0.1))
        g.merge(K.bxz(1.6, 14.0, 7.0, -10.2, -7.0, 0.0, mat='concrete', bev=0.1))
        g.merge(K.bxz(22.05, 0.06, 1.4, 0, -0.83, 0.3, mat='trim:hazard'))
        g.merge(K.bxz(22.4, 2.0, 0.6, 0, 0, 7.0, mat='concrete:grey', bev=0.06))
        M = Matrix.Translation(G(x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Z')
        g.transform(M)
        A.unique('blastwall', g)
        for (c, sz) in (((0, 0, 3.8), (22.4, 2.0, 7.6)), ((-10.2, -7.0, 3.8), (1.6, 14.0, 7.6))):
            A.collider_m(M @ Matrix.Translation(Vector(c)) @ Matrix.Diagonal((sz[0] / 2, sz[1] / 2, sz[2] / 2, 1.0)))
        foot('cover', x, z, 24, 16, yaw)
    # lamp masts around the yard
    for (x, z) in ((-60, -95), (60, -95), (-70, 0), (80, 10), (-20, 80), (170, -20), (-130, -110), (40, 130), (-190, 140),
                   (200, 130), (-110, -190), (110, -200)):
        place('mast', x, z)
    # yard decals: lane lines, stains, hatches, stencils
    d = A.Geo()
    for x in range(-130, 240, 13):   # rail-crossing safety lines
        d.merge(decal_quad('line', 'yellow', x, -111.0, 0.8, 13.0, PI / 2))
        d.merge(decal_quad('line', 'yellow', x, -129.0, 0.8, 13.0, PI / 2))
    rs = random.Random(99)
    for i in range(70):
        x, z = rs.uniform(-230, 230), rs.uniform(-230, 230)
        s = rs.uniform(4, 13)
        d.merge(decal_quad(rs.choice(['stain', 'stain', 'scorch']), rs.choice(['stain', 'stain', 'rust', 'soot']), x, z, s, s * rs.uniform(0.6, 1.2),
                           rs.uniform(0, 6.28), 0.025 + i * 0.0002))
    for (x0, z0, x1, z1) in ((-60, 130, 40, 185), (140, 150, 240, 200), (-235, 155, -160, 190), (100, -210, 180, -150)):
        for xx in range(int(x0), int(x1), 13):   # zone boundary boxes (dashed)
            d.merge(decal_quad('dash', 'white', xx + 6.5, z0, 0.7, 6.0, PI / 2, 0.034))
            d.merge(decal_quad('dash', 'white', xx + 6.5, z1, 0.7, 6.0, PI / 2, 0.034))
        for zz in range(int(z0), int(z1), 13):
            d.merge(decal_quad('dash', 'white', x0, zz + 6.5, 0.7, 6.0, 0.0, 0.034))
            d.merge(decal_quad('dash', 'white', x1, zz + 6.5, 0.7, 6.0, 0.0, 0.034))
    for (x, z) in ((10, 192), (115, 192), (205, 192)):   # crane travel lanes: hatch strips along the rails
        for k in range(-3, 4):
            d.merge(decal_quad('hatch', 'yellow', x + k * 9.0, 199.0, 8.0, 4.0, 0.0, 0.036))
    for (x, z, yaw) in ((-150, 60, 0.0), (120, -60, PI / 2), (-40, -170, 0.0), (190, 120, PI)):
        d.merge(decal_quad('p7', 'white', x, z, 12, 12, yaw, 0.037))
    for i in range(60):
        x, z = rs.uniform(-240, 240), rs.uniform(-240, 240)
        sz = rs.uniform(10, 26)
        d.merge(decal_quad('stain', rs.choice(['stain', 'soot']), x, z, sz, sz * rs.uniform(0.5, 1.0), rs.uniform(0, 6.28), 0.026 + i * 0.0002))
    for (x, z, yaw, cell, colr, w, l) in ((0, -150, 0.0, 'p7', 'white', 7, 7), (-100, -30, 0.0, 'hatch', 'yellow', 9, 9),
                                         (95, 105 - 14, 0.0, 'noentry', 'white', 14, 7), (200, 70, PI / 2, 'hatch', 'yellow', 8, 8),
                                         (0, 205, 0.0, 'hatch', 'yellow', 10, 10), (115, 205, 0.0, 'hatch', 'yellow', 10, 10),
                                         (-100, 200, PI, 'noentry', 'yellow', 14, 7), (-20, -40, 0.3, 'ring', 'white', 18, 18)):
        d.merge(decal_quad(cell, colr, x, z, w, l, yaw, 0.035))
    A.unique('decals', d, weighted=False, noshadow=True)


def mid_masses():
    """r3: 60-200 m mid-ground masses on the play axis that keep the LOS lanes to the MT squad
    open: a crib of 6 m billets, a row of slag pots (one tipped), a fallen gantry-crane bogie with
    its snapped leg, a torpedo car derailed beside the yard track. Dust / soot decals under each."""
    for (name, x, z, yaw, sz) in (('billets6', 26.0, 14.0, 0.2, 13.0), ('slagpots', 10.0, 80.0, -0.15, 26.0),
                                  ('bogie', -52.0, 0.0, 0.4, 24.0), ('slagpots', 46.0, -92.0, 0.35, 26.0)):
        place(name, x, z, yaw, fk='clutter', fs=(sz, sz * 0.7))
        UNDER.append((x, z, sz, yaw))
    A.inst('ladle', (50.0, 0.35, -128.5), yaw=0.12, roll=0.3, collide=True)
    foot('clutter', 50.0, -128.5, 26.0, 8.0, 0.12)
    UNDER.append((50.0, -129.5, 24.0, 0.12))


def clutter():
    """Foreground density: rubble, scrap, drums, cable drums, plate stacks, wrecks. Seeded
    rejection sampling against footprints, lanes, rails and spawn/objective clearances."""
    rs = random.Random(4242)
    # toppled lamp mast lying on the west shoulder of the launch lane (low cover, collider)
    my = -PI * 0.6
    mx, mz = -20.0, -84.0
    dx, dz = math.sin(my), math.cos(my)
    A.inst('mast', (mx, 0.75, mz), yaw=my, pitch=-PI / 2 + 0.03, collide=False)
    A.collider((mx + 16.0 * dx, 0.75, mz + 16.0 * dz), (1.6, 1.5, 32.0), yaw=my)
    foot('clutter', mx + 16.0 * dx, mz + 16.0 * dz, 34.0, 5.0, my)
    UNDER.append((mx + 14.0 * dx, mz + 14.0 * dz, 12.0, my))
    keep = [(0, -140, 36, 200), (0, -205, 50, 50)]          # launch lane + pad
    keep += [(0, -120, 520, 9), (114, 105, 260, 9), (200, 78, 160, 9)]   # rails
    clear = [(-40, -40), (-5, -22), (30, -58), (62, -18), (-72, -92), (0, -60), (90, -150), (-80, -150), (-20, 60),
             (130, 100), (-80, 170), (-120, 140), (185, -100), (16, 178)]

    def free(x, z, r, spawn=True):
        if abs(x) > 238 or abs(z) > 238:
            return False
        for (fx, fz, sx, sz) in keep:
            if abs(x - fx) < sx / 2 + r and abs(z - fz) < sz / 2 + r:
                return False
        for (kind, fx, fz, sx, sz, yaw) in FOOT:
            if kind in ('wall',):
                continue
            c, s = math.cos(yaw), math.sin(yaw)
            lx, lz = (x - fx) * c - (z - fz) * s, (x - fx) * s + (z - fz) * c
            if abs(lx) < sx / 2 + r and abs(lz) < sz / 2 + r:
                return False
        return (not spawn) or all(math.hypot(x - cx, z - cz) > 16 + r for (cx, cz) in clear)
    plan = [('rubble0', 5, 4), ('rubble1', 5, 4), ('rubble2', 4, 5), ('scrap0', 4, 5), ('scrap1', 4, 5), ('drums0', 8, 3),
            ('drums1', 6, 3), ('cabledrum', 5, 3), ('plates', 6, 4), ('wreck', 3, 6)]
    for name, n, r in plan:
        done = 0
        for attempt in range(400):
            if done >= n:
                break
            x, z = rs.uniform(-235, 235), rs.uniform(-235, 235)
            if not free(x, z, r):
                continue
            yaw = rs.uniform(0, 6.283)
            place(name, x, z, yaw, fk='clutter', fs=(r * 2, r * 2))
            if name.startswith(('rubble', 'scrap')):
                UNDER.append((x, z, r * 2.6, yaw))
            done += 1
    # hand-placed foreground dressing along the launch lane (gameplay / ground cameras)
    for (name, x, z, yaw) in (('rubble1', -27, -150, 0.3), ('drums0', -24, -128, 0.0), ('plates', 26, -165, 1.4),
                              ('scrap0', 34, -135, 0.2), ('cabledrum', -30, -96, 0.9), ('rubble0', 30, -82, 2.0),
                              ('drums1', 24, -99, 0.5), ('wreck', -48, -142, 0.35)):
        place(name, x, z, yaw, fk='clutter', fs=(8, 8))
        if name.startswith(('rubble', 'scrap')):
            UNDER.append((x, z, 10.0, yaw))
    # launch lane 0-60 m foreground: walk-through ash patches, cable runs, flat debris; a toppled
    # lamp mast and a burnt-out hauler on the shoulders (with colliders), oil / soot under them
    for (k, x, z, yaw) in ((0, -7, -186, 0.4), (1, 9, -160, 1.9), (2, -4, -128, 0.2), (0, 11, -104, 2.6), (1, -12, -78, 0.9),
                           (2, 6, -58, 1.3), (0, -15, -150, 2.2)):
        A.inst(f'ashpatch{k}', (x, 0.0, z), yaw=yaw, collide=False)
    for (k, x, z, yaw) in ((0, 2, -170, 0.25), (1, -6, -112, -0.4), (0, 8, -88, 1.35), (1, -2, -142, 1.5)):
        A.inst(f'cables{k}', (x, 0.0, z), yaw=yaw, collide=False)
    place('wreck', 27.0, -122.0, 2.7, fk='clutter', fs=(10, 10))
    UNDER.append((27.0, -122.0, 12.0, 2.7))
    d = A.Geo()
    for i, (x, z, sz, yaw) in enumerate(UNDER):
        d.merge(decal_quad('stain', 'stain', x, z, sz, sz * 0.85, yaw, 0.03 + i * 0.0003))
    A.unique('decals_under', d, weighted=False, noshadow=True)
    for (x, z) in ((-210, -228), (-203, -228), (-196, -228), (-189, -228)):
        place('transformer', x, z, 0.0)
    dressing(free, rs)


def dressing(free, rs):
    """Walk-through ground dressing for the 0-60 m foreground layer: ash drifts against the
    parapets / walls, grating trenches, flat litter, cable trays (low cover), tyre tracks and
    oil stains. Nothing here blocks a QB lane (drifts/litter/trenches have no collider)."""
    # drifts against the deck parapets (south, east, west inner faces)
    for x in range(-232, 240, 34):
        if abs(x) < 30:
            continue
        k = rs.randint(0, 2)
        dep = 2.6 + 0.6 * k
        A.inst(f'drift{k}', (x + rs.uniform(-5, 5), 0.0, -250.4 + dep / 2), yaw=0.0, collide=False)
    for z in range(-226, 236, 31):
        for (xw, yaw) in ((250.4, -PI / 2), (-250.4, PI / 2)):
            k = rs.randint(0, 2)
            dep = 2.6 + 0.6 * k
            xx = xw - (dep / 2 if xw > 0 else -dep / 2)
            if free(xx, z, 3.0) or abs(z) < 240:
                A.inst(f'drift{k}', (xx, 0.0, z + rs.uniform(-4, 4)), yaw=yaw, collide=False)
    # drifts on the lee side of the relay blast walls, bunds and yard buildings
    for (x, z, yaw, k) in ((-128, 129.2 + 1.8, 0.0, 1), (22, 188.8 - 1.8, PI, 1), (-200, -186 + 1.9, 0.0, 2), (-200, 34 + 1.9, 0.0, 2),
                           (-40, 110 - 11.4, PI, 0), (120, 150 - 10.4, PI, 1), (-195, -215 + 8.4, 0.0, 0), (140, -175 + 11.4, 0.25, 1),
                           (-100, 20 - 13.2, PI, 2), (70, 52 - 16.4, PI, 1)):
        A.inst(f'drift{k}', (x, 0.0, z), yaw=yaw, collide=False)
    # grating trenches: across the launch lane, along the MT yard, beside the tank farm
    for x in (-36.0, -12.0, 12.0, 36.0):
        A.inst('trench', (x, 0.0, -152.0), yaw=0.0, collide=False)
    for x in (-84.0, -60.0, 60.0, 84.0, 108.0):
        A.inst('trench', (x, 0.0, -84.0), yaw=0.0, collide=False)
    for z in (-212.0, -188.0, -164.0):
        A.inst('trench', (-64.0, 0.0, z), yaw=PI / 2, collide=False)
    foot('trench', 0, -152, 96, 3)
    # cable trays (low cover lines, 3.5 m)
    for (x, z, yaw) in ((-128, -12, 0.3), (150, 64, 1.2), (-24, 150, 0.0), (196, -62, PI / 2), (-170, 170, 0.6)):
        if free(x, z, 7.0):
            place('ctray', x, z, yaw, fk='cover', fs=(26, 4))
    # flat litter: launch lane shoulders + scattered over the yard
    for (x, z) in ((-14, -186), (13, -172), (-10, -132), (15, -118), (-16, -74), (9, -58), (-4, -100)):
        A.inst(f'litter{rs.randint(0, 3)}', (x + rs.uniform(-2, 2), 0.0, z), yaw=rs.uniform(0, 6.28), collide=False)
    n = 0
    for attempt in range(900):
        if n >= 70:
            break
        x, z = rs.uniform(-236, 236), rs.uniform(-236, 236)
        if not free(x, z, 3.0):
            continue
        A.inst(f'litter{rs.randint(0, 3)}', (x, 0.0, z), yaw=rs.uniform(0, 6.28), collide=False)
        n += 1
    # burning debris: ember beds + underlit hot smoke + fire light (a derelict, burning foundry)
    nb = 0
    burns = []
    for (x, z) in ((-40, -152), (38, -28), (-88, -64), (62, -122), (-28, 24), (-112, 152), (172, -94), (118, 118), (-176, -128),
                   (150, 184), (18, -196), (-60, 208)):
        if not free(x, z, 4.5, spawn=False):
            continue
        k = nb % 2
        A.inst(f'embers{k}', (x, 0.0, z), yaw=rs.uniform(0, 6.28), collide=False)
        fx_smoke(x, 0.6, z, 1.1 + 0.3 * k, 34.0 + 10 * k, 2)
        fx_light(x, 0.0, z, 11.0 + 3 * k, FIRE, 0.45)
        burns.append((x, z))
        nb += 1
    print(f'[arena] burning debris spots: {nb}')
    # tyre / crawler tracks along the routes, oil stains at the stands
    d = A.Geo()
    for (x0, z0, x1, z1) in ((-8, -186, -8, -40), (9, -186, 12, -40), (-200, -104, 200, -100), (100, -230, 96, 190),
                             (-150, -190, -150, 150), (-60, 60, 180, 70)):
        L = math.hypot(x1 - x0, z1 - z0)
        yaw = math.atan2(x1 - x0, z1 - z0)
        nseg = max(1, int(L / 24))
        for i in range(nseg):
            t = (i + 0.5) / nseg
            x, z = x0 + (x1 - x0) * t + rs.uniform(-0.8, 0.8), z0 + (z1 - z0) * t
            if abs(x) > 238 or abs(z) > 238:
                continue
            d.merge(decal_quad('tracks', rs.choice(['soot', 'stain']), x, z, 6.0, L / nseg + 1.0, yaw + rs.uniform(-0.04, 0.04), 0.028 + i * 0.0003))
    for i in range(40):
        x, z = rs.uniform(-230, 230), rs.uniform(-230, 230)
        sz = rs.uniform(3, 8)
        d.merge(decal_quad('stain', 'soot', x, z, sz, sz * rs.uniform(0.6, 1.0), rs.uniform(0, 6.28), 0.031 + i * 0.0002))
    for i, (x, z) in enumerate(burns):
        d.merge(decal_quad('scorch', 'soot', x, z, 14.0, 12.0, rs.uniform(0, 6.28), 0.033 + i * 0.0003))
    A.unique('decals_tracks', d, weighted=False, noshadow=True)


def markers():
    A.marker('SPAWN_player', (0, 0.4, -205), 0.0)
    for i, (x, z) in enumerate(((-40, -40), (-5, -22), (30, -58), (62, -18), (-72, -92))):
        A.marker(f'SPAWN_mt_{i + 1}', (x, 0, z), PI)
    for i, (x, y, z) in enumerate(((-60, 30, 60), (95, 30, 80), (0, 34, 118), (-40, 34, 200), (60, 36, 200))):
        A.marker(f'SPAWN_drone_{i + 1}', (x, y, z), PI)
    for i, (x, z) in enumerate(((0, -60), (90, -150), (-80, -150), (-20, 60), (130, 100), (-80, 170))):
        A.marker(f'SPAWN_boss_{i + 1}', (x, 0, z), PI)
    for i, (x, z) in enumerate(((-120, 140), (185, -100), (16, 178))):
        A.marker(f'OBJ_relay_{i + 1}', (x, 0, z), PI)


# ---------------------------------------------------------------------------------- splat
def splat(path, n=512):
    """Ground splat (1 px = 1 m over +/-256 m): R = ash/dirt, G = wet (puddles), B = contact soot."""
    import numpy as np
    from texlib import blur, norm01, sstep, spectral, save
    ext = 256.0
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    gx = (x + 0.5) / n * 2 * ext - ext
    gz = ext - (y + 0.5) / n * 2 * ext   # image row 0 = +z (north); three.js flipY maps v=1 to row 0
    Rm = np.zeros((n, n), np.float32)
    S = np.zeros((n, n), np.float32)
    Bm = np.zeros((n, n), np.float32)
    hard = np.zeros((n, n), np.float32)
    Sr = np.zeros((n, n), np.float32)      # footprints that bank ash around them (not the open quay apron)
    for (kind, fx, fz, sx, sz, yaw) in FOOT:
        c, s = math.cos(yaw), math.sin(yaw)
        lx = (gx - fx) * c - (gz - fz) * s
        lz = (gx - fx) * s + (gz - fz) * c
        m = ((np.abs(lx) < sx / 2) & (np.abs(lz) < sz / 2)).astype(np.float32)
        if kind in ('rail', 'slag', 'heap', 'tank', 'rack', 'trestle'):
            Rm = np.maximum(Rm, m)
        if kind == 'pad':
            hard = np.maximum(hard, m)
        else:
            S = np.maximum(S, m)
            if kind != 'quay':
                Sr = np.maximum(Sr, m)
        if kind in ('slag', 'heap'):
            Bm = np.maximum(Bm, m)
    macro = norm01(spectral(n, 5, beta=2.6, fmin=2, fmax=40))
    mid = norm01(spectral(n, 6, beta=2.0, fmin=6, fmax=120))
    fields = sstep(0.42, 0.7, macro) * (0.55 + 0.45 * sstep(0.25, 0.75, mid))

    def seg_dist(ax, az, bx_, bz):
        dx, dz = bx_ - ax, bz - az
        t = np.clip(((gx - ax) * dx + (gz - az) * dz) / max(dx * dx + dz * dz, 1e-6), 0, 1)
        return np.sqrt((gx - ax - t * dx) ** 2 + (gz - az - t * dz) ** 2)
    # ore / ash spillage under the conveyor galleries (ragged strips)
    spill = np.zeros((n, n), np.float32)
    for (ax, az, bx_, bz) in ((-100, 219, -100, 31), (-89, 24, 53, 50), (87, 48, 250, 34), (-100, 9, -100, -250)):
        spill = np.maximum(spill, 1 - sstep(3.0, 9.0, seg_dist(ax, az, bx_, bz) + (mid - 0.5) * 8.0))
    # wind-blown ash banked against the parapets (south / east / west)
    edge = np.maximum(sstep(238.0, 249.0, np.abs(gx)), sstep(-238.0, -249.0, gz))
    R = np.clip(blur(Rm, 3.0) * 1.5 + fields * 0.85 + blur(Sr, 7.0) * 0.5 + spill * 0.8 + edge * (0.5 + 0.5 * mid), 0, 1) * (1 - hard)
    wet = sstep(0.64, 0.74, norm01(spectral(n, 7, beta=2.4, fmin=3, fmax=90))) * (1 - blur(np.maximum(S, Bm), 2.0))
    wet = np.maximum(wet, sstep(0.74, 0.82, mid) * 0.85 * (1 - S))
    # hand-placed standing water beside the launch lane / MT yard (camera foregrounds)
    for (px, pz, rx, rz, a) in ((-26, -118, 9, 5, 0.3), (22, -150, 7, 4, -0.2), (-34, -60, 11, 6, 0.8), (10, -95, 5, 3, 0.0),
                                (40, -20, 9, 5, 1.2), (-8, -176, 4, 2.5, 0.0), (60, -120, 8, 3, 0.1), (-60, -180, 10, 5, 0.5)):
        c, s_ = math.cos(a), math.sin(a)
        lx, lz = (gx - px) * c - (gz - pz) * s_, (gx - px) * s_ + (gz - pz) * c
        wet = np.maximum(wet, 1 - sstep(0.7, 1.15, np.sqrt((lx / rx) ** 2 + (lz / rz) ** 2)))
    wet = wet * (1 - hard * 0.8)
    G_ = np.clip(blur(wet, 0.8), 0, 1)
    # soot: contact shadows of footprints, slag/heap areas, burnt patches, oily traffic lanes
    lanes = np.zeros((n, n), np.float32)
    for (ax, az, bx_, bz) in ((-200, -102, 200, -102), (98, -230, 98, 190), (-150, -190, -150, 150), (0, -190, 0, -40), (-60, 65, 180, 65)):
        lanes = np.maximum(lanes, 1 - sstep(2.0, 7.0, seg_dist(ax, az, bx_, bz)))
    burnt = sstep(0.6, 0.85, norm01(spectral(n, 8, beta=2.2, fmin=3, fmax=60))) * (1 - hard)
    Bc = np.clip(blur(Bm, 4.0) * 1.3 + (blur(S, 2.5) - S) * 1.4 + blur(S, 10.0) * 0.25 + lanes * 0.3 * (0.6 + 0.4 * mid) + burnt * 0.35, 0, 1)
    img = np.stack([R, G_, Bc], -1)
    save(img, path, quality=90)
    print(f'[arena] splat -> {path}')


# ---------------------------------------------------------------------------------- main
def main():
    args = sys.argv[1:]
    out = os.path.join(ROOT, 'assets', 'arena', 'arena.glb')
    if '--out' in args:
        out = os.path.abspath(args[args.index('--out') + 1])
    t0 = time.time()
    A.init()
    build_kit()
    ground()
    launch_pad()
    edges()
    lower_yard()
    south()
    east()
    west()
    overhead()
    dock()
    edge_dressing()
    lower_yard_fill()
    trench_plan()
    yard()
    mid_masses()
    clutter()
    markers()
    print(f'[arena] hidden-face cull: {A.CULL["killed"]} of {A.CULL["faces"]} faces')
    print(f'[arena] layout: {A.STATS["inst"]} objects, ~{A.STATS["tris"] / 1e3:.0f}k tris, {A.STATS["cols"]} colliders, '
          f'{time.time() - t0:.1f}s')
    A.export(out, pack='--no-pack' not in args)
    splat(os.path.join(ROOT, 'assets', 'arena', 'tex', 'splat.webp'))
    print(f'[arena] done in {time.time() - t0:.1f}s')
    sys.stdout.flush()
    os._exit(0)


if __name__ == '__main__':
    main()
