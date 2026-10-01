"""blender/arena/megakit.py - set-piece buildings, the far kit and sea-wall dressing.

Same conventions as pieces.py / buildings.py: Blender coordinates (Z up), local origin at the
base centre, a piece's FRONT faces local -Y, semantic '<base>:<variant>' materials.

  foundry_hall()        the boss-arena backdrop: multi-bay steel-framed hall with a monitor roof
                        and clerestory glazing, converter tower, lean-to annex with 4 numbered
                        loading bays (canopies, sodium lamps), downpipes every 12 m, flashing,
                        roof ventilators, fume duct, rust/soot run decals from every column head
  sinter_bins()         stepped concrete bin house with hopper skirt, gallery head and ribs
  crane_house(w, d, h)  machinery house for cranes: louvres, door, grated walkway + railing,
                        hazard corners, roof units
  far_complex(seed, sx, sy, h)   far-kit block (400 m - 3 km): stepped setbacks, rooftop stacks
                        and vents, facade pipe racks, lattice gantry, window rows (30 % dark),
                        a roofline that breaks every 10-20 m. 'far' + 'glow' materials only.
  furnace_mega(h)       300 m class blast-furnace silhouette for the horizon (far material)
  jetty(L), pontoon(), dolphin()   irregular sea-wall dressing (outside the bounds)
  ash_drift(L, seed), trench(L), cable_tray(L), bollards(n)   foreground scatter pieces
"""
import math
import random

from mathutils import Matrix, Vector

from akit import P, Geo, TAU
from pieces import V, beacon, beam, bx, bxz, cheap_ladder, flood, merge, quad, rail_line, tube, xbrace


def wall_decal(x0, x1, y, z0, z1, cell, colour, facing=-1):
    """Vertical decal quad on a wall plane y = const, facing -Y (facing=-1) or +Y (facing=1).
    u runs along +X (or -X when facing +Y), v up: run decals hang from their top edge."""
    if facing < 0:
        return quad(V((x0, y, z0)), V((x1, y, z0)), V((x1, y, z1)), V((x0, y, z1)), f'decal:{cell}/{colour}')
    return quad(V((x1, y, z0)), V((x0, y, z0)), V((x0, y, z1)), V((x1, y, z1)), f'decal:{cell}/{colour}')


def side_decal(x, y0, y1, z0, z1, cell, colour, facing=1):
    """Vertical decal quad on a wall plane x = const facing +X (facing=1) or -X."""
    if facing > 0:
        return quad(V((x, y0, z0)), V((x, y1, z0)), V((x, y1, z1)), V((x, y0, z1)), f'decal:{cell}/{colour}')
    return quad(V((x, y1, z0)), V((x, y0, z0)), V((x, y0, z1)), V((x, y1, z1)), f'decal:{cell}/{colour}')


def vent_row(g, x0, x1, y, z, n, r, rnd, mat='steel:galv'):
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n + rnd.uniform(-1.0, 1.0)
        h = rnd.uniform(2.2, 3.4)
        g.merge(P.cylinder(r, h, 12, bevel=0.0, mat=mat, z0=z).move(x, y, 0))
        g.merge(P.cone(r * 1.5, r * 0.3, r * 0.9, 12, bevel=0.0, mat='steel:dark').move(x, y, z + h))


# ============================================================================ FOUNDRY HALL
def foundry_hall(L=220.0, D=60.0, H=42.0, seed=21):
    r = random.Random(seed)
    g = Geo()
    z0 = 1.6
    g.merge(bxz(L + 1.4, D + 1.4, z0, mat='concrete:dark', bev=0.1))
    # concrete dado band + corrugated cladding above it
    g.merge(bxz(L + 0.3, D + 0.3, 9.0, z0=z0, mat='concrete:grey', bev=0.08))
    g.merge(bxz(L, D, H - 9.0, z0=z0 + 9.0, mat='corr:grey'))
    g.merge(bxz(L + 0.6, D + 0.6, 0.5, z0=z0 + 8.8, mat='steel:dark'))           # dado cap flashing
    # frame columns every 12 m (long faces) + gable columns, girts at 1/3 and 2/3
    bay = 12.0
    nb = int(L / bay)
    xs = [-L / 2 + i * L / nb for i in range(nb + 1)]
    for x in xs:
        for s in (-1, 1):
            g.merge(bxz(1.1, 1.3, H + 0.6, x, s * (D / 2 + 0.45), z0, mat='steel:dark'))
    for s in (-1, 1):
        for zz in (z0 + 20.0, z0 + 31.0):
            g.merge(bxz(L + 0.2, 0.7, 0.45, 0, s * (D / 2 + 0.3), zz, mat='steel:slate'))
    ng = int(D / 10)
    for i in range(ng + 1):
        y = -D / 2 + i * D / ng
        for s in (-1, 1):
            g.merge(bxz(1.3, 1.1, H + 0.6, s * (L / 2 + 0.45), y, z0, mat='steel:dark'))
    # clerestory window band on both long faces (30 % lit bays)
    zw = z0 + 24.0
    for s in (-1, 1):
        g.merge(bxz(L - 0.4, 0.14, 3.2, 0, s * (D / 2 + 0.05), zw, mat='trim:window'))
        for x in xs[:-1]:
            if r.random() < 0.3:
                g.merge(bxz(bay - 1.6, 0.16, 3.2, x + bay / 2, s * (D / 2 + 0.07), zw, mat='trim:window_lit'))
    # eaves flashing + gutters
    ze = z0 + H
    g.merge(bxz(L + 1.8, D + 1.8, 0.8, z0=ze, mat='steel:dark'))
    for s in (-1, 1):
        g.merge(bxz(L + 1.8, 0.6, 0.55, 0, s * (D / 2 + 1.1), ze - 0.1, mat='steel:galv'))
    # pitched roof + ridge monitor with glazing
    rise = D * 0.1
    for s in (-1, 1):
        rf = bx(L + 1.6, D / 2 + 1.4, 0.35, (0, 0, 0), mat='corr:grey')
        rf.transform(Matrix.Translation(V((0, s * D / 4, ze + 0.8 + rise / 2))) @ Matrix.Rotation(s * math.atan2(rise, D / 2), 4, 'X'))
        g.merge(rf)
    mw, mh = D * 0.26, 5.5
    zm = ze + 0.8 + rise * 0.72
    g.merge(bxz(L * 0.9, mw, mh, 0, 0, zm, mat='corr:grey'))
    for s in (-1, 1):
        g.merge(bxz(L * 0.9 - 0.2, 0.14, 3.0, 0, s * (mw / 2 + 0.05), zm + 1.1, mat='trim:window'))
        for k in range(int(L * 0.9 / 9)):
            if r.random() < 0.28:
                g.merge(bxz(7.4, 0.16, 3.0, -L * 0.45 + 4.5 + k * 9.0, s * (mw / 2 + 0.07), zm + 1.1, mat='trim:window_lit'))
    g.merge(bxz(L * 0.9 + 1.2, mw + 1.8, 0.5, 0, 0, zm + mh, mat='steel:dark'))
    # roof ventilators on both slopes + ridge walkway rail
    for s in (-1, 1):
        vent_row(g, -L / 2 + 6, L / 2 - 50, s * D * 0.3, ze + 0.8 + rise * 0.4, 14, 1.1, r)
    g.merge(rail_line([(-L * 0.45, -mw / 2 - 0.9, zm + mh + 0.5), (L * 0.45, -mw / 2 - 0.9, zm + mh + 0.5)], h=1.1, post=3.0, r=0.06))
    # converter tower at the +X end: taller bay, louvre bands, twin stacks, beacons
    cx, cw, cd, chh = L / 2 - 26.0, 44.0, D + 10.0, H + 36.0
    g.merge(bxz(cw, cd, chh, cx, 0, z0, mat='corr:oxide'))
    for s in (-1, 1):
        for x in (cx - cw / 2, cx - cw / 6, cx + cw / 6, cx + cw / 2):
            g.merge(bxz(1.2, 1.4, chh + 0.8, x, s * (cd / 2 + 0.5), z0, mat='steel:dark'))
        for zz in (z0 + 50.0, z0 + 64.0):
            g.merge(bxz(cw - 1.0, 0.14, 4.0, cx, s * (cd / 2 + 0.05), zz, mat='trim:louvre'))
        g.merge(bxz(cw - 1.0, 0.14, 3.0, cx, s * (cd / 2 + 0.06), z0 + 38.0, mat='trim:window'))
    g.merge(bxz(cw + 1.6, cd + 1.6, 0.9, cx, 0, z0 + chh, mat='steel:dark'))
    g.merge(rail_line([(cx - cw / 2, -cd / 2, z0 + chh + 0.9), (cx + cw / 2, -cd / 2, z0 + chh + 0.9),
                       (cx + cw / 2, cd / 2, z0 + chh + 0.9)], h=1.2, post=3.0, r=0.07))
    for (dx, dy, rr, hh) in ((-10.0, 8.0, 2.6, 34.0), (9.0, 12.0, 1.8, 26.0)):
        g.merge(P.lathe([(0.0, 0.0), (rr + 0.4, 0.0), (rr, 2.0), (rr, hh), (rr + 0.3, hh), (rr + 0.3, hh + 0.8), (0.0, hh + 0.8)],
                        20, 'steel:rust').move(cx + dx, dy, z0 + chh + 0.9))
        g.merge(P.lathe([(rr + 0.32, hh - 7.0), (rr + 0.32, hh + 0.82)], 20, 'concrete:soot').move(cx + dx, dy, z0 + chh + 0.9))
        g.merge(beacon(cx + dx + rr * 0.7, dy, z0 + chh + hh + 1.9, 0.8))
    g.merge(beacon(cx - cw / 2 + 1.0, -cd / 2 + 1.0, z0 + chh + 1.8, 0.8))
    # fume duct from the converter roof along the ridge, dropping at the -X end
    duct = [V((cx - cw / 2 + 4, 4.0, z0 + chh + 4.0)), V((cx - cw / 2 - 6, 4.0, z0 + chh + 4.0)),
            V((cx - cw / 2 - 16, 4.0, zm + mh + 4.5)), V((-L / 2 + 18, 4.0, zm + mh + 4.5)), V((-L / 2 - 6, 4.0, zm + mh + 4.5)),
            V((-L / 2 - 6, 4.0, z0 + 6.0))]
    g.merge(P.pipe_run(duct, r=2.2, bend=6.0, segs=20, mat='steel:rust', flanges=False))
    for x in range(int(-L / 2 + 30), int(cx - cw / 2 - 20), 24):
        g.merge(beam((x, 4.0, zm + mh + 0.5), (x, 4.0, zm + mh + 2.4), 0.8, 0.8, 'steel:dark'))
    for k in range(3):
        g.merge(P.ring(2.55, 2.0, 0.6, 20, bevel=0.0, mat='steel:dark').rotate((0, 90, 0)).move(-L / 2 + 30 + k * 60, 4.0, zm + mh + 4.5))
    # lean-to annex along the front (-Y) with 4 numbered loading bays
    aw, ad, ah = L * 0.72, 14.0, 19.0
    ax = -L * 0.1
    ay = -D / 2 - ad / 2
    g.merge(bxz(aw, ad, ah, ax, ay, z0, mat='concrete', bev=0.1))
    g.merge(bxz(aw + 1.2, ad + 1.2, 1.1, ax, ay, z0 + ah, mat='concrete:grey', bev=0.08))
    rf = bx(aw + 1.0, ad + 1.0, 0.3, (0, 0, 0), mat='corr:dark')
    rf.transform(Matrix.Translation(V((ax, ay + 0.4, z0 + ah + 1.6))) @ Matrix.Rotation(-0.12, 4, 'X'))
    g.merge(rf)
    for x in (ax - aw / 2, ax - aw / 4, ax, ax + aw / 4, ax + aw / 2):          # pilasters
        g.merge(bxz(1.4, 0.9, ah, x, ay - ad / 2 - 0.4, z0, mat='concrete', bev=0.08))
    fy = ay - ad / 2
    g.merge(bxz(aw + 0.05, 0.06, 1.4, ax, fy - 0.1, z0 + 0.3, mat='trim:hazard'))
    doors = [ax - aw * 0.375, ax - aw * 0.125, ax + aw * 0.125, ax + aw * 0.375]
    dw, dh = 14.0, 13.5
    for k, dx in enumerate(doors):
        g.merge(bxz(dw + 1.6, 0.8, dh + 1.2, dx, fy - 0.35, z0, mat='steel:dark'))
        hot = k in (1, 2)
        if hot:   # open: dark void + furnace glow floor slit + haze
            g.merge(bxz(dw, 0.5, dh, dx, fy - 0.55, z0, mat='steel:black'))
            # interior furnace light: bright floor band fading upward through the fume (vertex gradient)
            g.merge(quad(V((dx - dw / 2 + 0.3, fy - 0.85, z0)), V((dx + dw / 2 - 0.3, fy - 0.85, z0)),
                         V((dx + dw / 2 - 0.3, fy - 0.85, z0 + dh * 0.85)), V((dx - dw / 2 + 0.3, fy - 0.85, z0 + dh * 0.85)), 'glow:dim_grad'))
            # silhouettes against the glow: a ladle on its car and a hanging chain block
            g.merge(P.cylinder(2.1, 3.0, 16, bevel=0.0, mat='steel:black', z0=z0 + 1.2).move(dx - 2.5, fy - 1.9, 0))
            g.merge(bxz(5.0, 2.6, 1.2, dx - 2.5, fy - 1.9, z0, mat='steel:black'))
            g.merge(bxz(0.25, 0.25, dh * 0.5, dx + 3.2, fy - 1.3, z0 + dh * 0.5, mat='steel:black'))
            g.merge(bxz(1.0, 0.8, 1.2, dx + 3.2, fy - 1.3, z0 + dh * 0.42, mat='steel:black'))
            g.merge(quad(V((dx - dw / 2 + 0.3, fy - 0.87, z0)), V((dx + dw / 2 - 0.3, fy - 0.87, z0)),
                         V((dx + dw / 2 - 0.3, fy - 0.87, z0 + 1.2)), V((dx - dw / 2 + 0.3, fy - 0.87, z0 + 1.2)), 'glow:hot_grad'))
        else:     # closed roller door + hazard frame
            g.merge(bxz(dw, 0.5, dh, dx, fy - 0.55, z0, mat='corr:' + r.choice(['blue', 'oxide', 'grey'])))
        for sx in (-1, 1):
            g.merge(bxz(0.5, 0.1, dh, dx + sx * (dw / 2 + 0.55), fy - 0.8, z0, mat='trim:hazard'))
        # canopy on hangers + sodium lamps + bay number (3 m stencil) above
        g.merge(bxz(dw + 5.0, 6.5, 0.6, dx, fy - 3.6, z0 + dh + 1.6, mat='steel:dark'))
        g.merge(bxz(dw + 5.2, 0.4, 0.9, dx, fy - 6.8, z0 + dh + 1.5, mat='steel:yellow'))
        for sx in (-1, 1):
            g.merge(beam((dx + sx * (dw / 2 + 2.0), fy - 6.6, z0 + dh + 2.1), (dx + sx * (dw / 2 + 2.0), fy - 0.8, z0 + dh + 5.6), 0.25, 0.25, 'steel:dark'))
            g.merge(flood(dx + sx * 4.0, fy - 5.2, z0 + dh + 1.2, 0.0))
        g.merge(wall_decal(dx - 1.7, dx + 1.7, fy - 0.87, z0 + dh + 2.6, z0 + dh + 6.0, f'd{k + 1}', 'white'))
        # tyre / crawler tracks out of each bay
        g.merge(quad(V((dx - 5.5, fy - 1.0, 0.035)), V((dx + 5.5, fy - 1.0, 0.035)), V((dx + 5.5, fy - 45.0, 0.035)), V((dx - 5.5, fy - 45.0, 0.035)),
                     'decal:tracks/soot'))
    # downpipes every 12 m on the front wall + back wall, from the gutter to the dado
    for x in xs[1:-1:1]:
        if x < ax - aw / 2 - 1 or x > ax + aw / 2 + 1:
            g.merge(tube((x + 1.4, -D / 2 - 0.9, z0 + 0.4), (x + 1.4, -D / 2 - 0.9, ze + 0.2), 0.28, 'steel:dark', 8))
        g.merge(tube((x + 1.4, D / 2 + 0.9, z0 + 0.4), (x + 1.4, D / 2 + 0.9, ze + 0.2), 0.28, 'steel:dark', 8))
    # rust / soot runs from every column head and the clerestory sill (20-40 % of the wall)
    for x in xs:
        for s in (-1, 1):
            yf = s * (D / 2 + 0.04)
            L1 = H * r.uniform(0.22, 0.42)
            fac = -1 if s < 0 else 1
            g.merge(wall_decal(x - 3.2, x + 3.2, yf, ze - L1, ze - 0.2, 'curtain', r.choice(['soot', 'stain']), facing=fac))
            L2 = r.uniform(5.0, 11.0)
            g.merge(wall_decal(x + 1.0, x + 4.6, yf + s * 0.01, zw - L2, zw, 'streak', 'rust', facing=fac))
    # big wall stencils: name on the converter tower, hall number on the gable
    g.merge(bxz(34.0, 0.12, 4.6, cx, -cd / 2 - 0.1, z0 + chh - 10.0, mat='trim:stencil@halvard'))
    g.merge(bxz(0.12, 16.0, 4.0, -L / 2 - 0.12, -8.0, z0 + 30.0, mat='trim:stencil@grauwerk'))
    # external stair tower at the -X gable
    sx0 = -L / 2 - 5.0
    g.merge(bxz(7.0, 7.0, H + 4.0, sx0, D / 2 - 8.0, z0, mat='concrete:grey', bev=0.1))
    for k in range(int((H + 2) / 4.0)):
        g.merge(bxz(0.12, 1.0, 2.2, sx0 - 3.52, D / 2 - 8.0, z0 + 3.0 + k * 4.0, mat='trim:window'))
    g.merge(beacon(sx0, D / 2 - 8.0, z0 + H + 5.0, 0.7))
    return g


# ============================================================================ SINTER BINS
def sinter_bins(seed=31):
    r = random.Random(seed)
    g = Geo()
    # hopper skirt on columns (0-14 m), bin block (14-44 m), head house (44-56 m), gallery stub
    for x in (-12, -4, 4, 12):
        for y in (-9, 0, 9):
            g.merge(bxz(1.6, 1.6, 14.0, x, y, 0.0, mat='concrete:grey', bev=0.08))
    for x in (-8.0, 0.0, 8.0):
        for y in (-4.5, 4.5):
            fr = P.frustum((6.0, 6.0), (1.4, 1.4), 7.0, bevel=0.0, segs=1, mat='steel:rust')
            fr.transform(Matrix.Translation(V((x, y, 14.0))) @ Matrix.Rotation(math.pi, 4, 'X'))
            g.merge(fr)
    g.merge(bxz(28.0, 22.0, 30.0, 0, 0, 14.0, mat='concrete:dark', bev=0.12))
    for x in (-14.0, -7.0, 0.0, 7.0, 14.0):                                      # ribs
        for s in (-1, 1):
            g.merge(bxz(1.2, 0.9, 30.0, x, s * 11.4, 14.0, mat='concrete', bev=0.06))
    for y in (-11.0, -3.7, 3.7, 11.0):
        for s in (-1, 1):
            g.merge(bxz(0.9, 1.2, 30.0, s * 14.4, y, 14.0, mat='concrete', bev=0.06))
    g.merge(bxz(29.6, 23.6, 1.4, 0, 0, 44.0, mat='concrete:grey', bev=0.1))
    g.merge(bxz(18.0, 14.0, 11.0, -3.0, 2.0, 45.4, mat='corr:blue'))
    g.merge(bxz(18.1, 0.12, 2.0, -3.0, -5.02, 52.0, mat='trim:window'))
    g.merge(bxz(19.0, 15.0, 0.6, -3.0, 2.0, 56.4, mat='steel:dark'))
    for s in (-1, 1):
        g.merge(wall_decal(-14, 14, -11.05, 30.0, 44.0, 'curtain', 'soot'))
    for k in range(5):
        x = -12 + k * 6 + r.uniform(-1, 1)
        g.merge(wall_decal(x, x + 3.0, -11.9, 34.0 - r.uniform(6, 12), 44.0, 'streak', 'rust'))
    g.merge(rail_line([(-14.8, -11.8, 45.4), (14.8, -11.8, 45.4), (14.8, 11.8, 45.4)], h=1.1, post=3.0, r=0.06))
    g.merge(beacon(6.0, 8.0, 57.4, 0.7))
    g.merge(bxz(9.3, 0.12, 3.2, 0, -11.95, 39.0, mat='trim:stencil@hdf07'))
    return g


# ============================================================================ CRANE HOUSE
def crane_house(w=14.0, d=12.0, h=7.0, var='cream', seed=5, rail_sides=(-1,)):
    """Machinery house (local base centre on the girder deck, door on -Y)."""
    r = random.Random(seed)
    g = Geo()
    g.merge(bxz(w + 3.0, d + 3.0, 0.3, mat='trim:grating'))                       # walkway deck
    g.merge(bxz(w, d, h, z0=0.3, mat='corr:' + var))
    g.merge(bxz(w + 0.5, d + 0.5, 0.45, z0=h + 0.3, mat='steel:dark'))
    for sx in (-1, 1):                                                              # hazard corners
        for sy in (-1, 1):
            g.merge(bxz(0.5, 0.5, h, sx * (w / 2 + 0.05), sy * (d / 2 + 0.05), 0.3, mat='steel:yellow'))
            g.merge(bxz(0.06, 0.56, h * 0.9, sx * (w / 2 + 0.31), sy * (d / 2 + 0.05), 0.5, mat='trim:hazard2'))
    for s in (-1, 1):                                                               # louvre panels
        for k in range(3):
            x = -w / 2 + w * (k + 0.5) / 3
            g.merge(bxz(w / 3 - 1.4, 0.12, 1.6, x, s * (d / 2 + 0.04), h - 2.3, mat='trim:louvre'))
    g.merge(bxz(0.12, d * 0.6, 1.4, w / 2 + 0.04, 0, h - 2.2, mat='trim:louvre'))
    g.merge(bxz(1.6, 0.14, 2.6, -w / 4, -d / 2 - 0.05, 0.3, mat='steel:dark'))      # door + light
    g.merge(bxz(2.2, 0.8, 0.12, -w / 4, -d / 2 - 0.4, 3.1, mat='steel:dark'))
    g.merge(bx(0.5, 0.3, 0.3, (-w / 4, -d / 2 - 0.3, 3.4), mat='glow:sodium'))
    g.merge(bxz(min(w * 0.45, 6.2), 0.1, min(w * 0.45, 6.2) / 2.9, w / 8, -d / 2 - 0.05, h - 1.2 - min(w * 0.45, 6.2) / 2.9, mat='trim:stencil@hdf07'))
    # roof units, exhaust, antenna mast
    for i in range(2):
        g.merge(bxz(2.6, 2.0, 1.2, -w / 4 + i * w / 2, d / 5, h + 0.75, mat='steel:galv'))
        g.merge(bxz(2.2, 0.08, 0.8, -w / 4 + i * w / 2, d / 5 - 1.04, h + 0.95, mat='trim:louvre'))
    g.merge(tube((w / 3, -d / 4, h + 0.75), (w / 3, -d / 4, h + 3.2), 0.3, 'steel:dark', 10))
    g.merge(beam((-w / 2 + 1, d / 2 - 1, h + 0.75), (-w / 2 + 1, d / 2 - 1, h + 6.0), 0.15, 0.15, 'steel:dark'))
    g.merge(beacon(-w / 2 + 1, d / 2 - 1, h + 6.4, 0.5))
    # railing around the walkway
    e = w / 2 + 1.4
    f = d / 2 + 1.4
    g.merge(rail_line([(-e, -f, 0.3), (e, -f, 0.3), (e, f, 0.3), (-e, f, 0.3), (-e, -f, 0.3)], h=1.1, post=2.5, r=0.05))
    # grime: soot curtain under the roof edge, rust runs from the louvres
    g.merge(wall_decal(-w / 2, w / 2, -d / 2 - 0.02, h * 0.45, h + 0.3, 'curtain', 'soot'))
    g.merge(wall_decal(-w / 2, w / 2, d / 2 + 0.02, h * 0.4, h + 0.3, 'curtain', 'soot', facing=1))
    for k in range(3):
        x = -w / 2 + w * (k + 0.5) / 3 + r.uniform(-0.6, 0.6)
        g.merge(wall_decal(x - 0.8, x + 0.8, -d / 2 - 0.03, h - 2.3 - r.uniform(2.0, 3.5), h - 2.3, 'streak', 'rust'))
    return g


# ============================================================================ FAR KIT
def far_complex(seed, sx, sy, h, stacks=True):
    """Silhouette block for 400 m - 3 km. Front = -Y. Every block breaks its roofline every
    10-20 m (setbacks, stacks, vents, gantries) and carries rows of small lit windows."""
    r = random.Random(seed)
    g = Geo()
    mats = ['far', 'far:dark', 'far', 'far:rust']
    # tiers: base mass + 1-3 setbacks, each with a thin parapet lip
    tiers = [(sx, sy, h * r.uniform(0.45, 0.62), 0.0, 0.0)]
    x0, y0, z = 0.0, 0.0, tiers[0][2]
    w, d = sx, sy
    for k in range(r.randint(1, 3)):
        w2, d2 = w * r.uniform(0.45, 0.8), d * r.uniform(0.55, 0.9)
        x0 += r.uniform(-(w - w2) / 2, (w - w2) / 2) * 0.8
        y0 += r.uniform(-(d - d2) / 2, (d - d2) / 2) * 0.5
        hh = (h - z) * r.uniform(0.35, 0.7) if k < 2 else h - z
        tiers.append((w2, d2, hh, x0, y0))
        w, d = w2, d2
    zc = 0.0
    tops = []
    for i, (tw, td, th, tx, ty) in enumerate(tiers):
        g.merge(bxz(tw, td, th, tx, ty, zc, mat=mats[i % 4]))
        g.merge(bxz(tw + 1.2, td + 1.2, 1.2, tx, ty, zc + th, mat='far:dark'))        # parapet lip / flashing
        # facade grid on the front (-Y) and both ends: piers every 7-11 m (0.9 m proud), floor
        # slabs every 4-5 m (0.6 m proud) -> deep inset bays that read in raking light; dark glazing
        # bands inside the bays; LIT windows only in vertical clusters (~12 % of the bays)
        bw = r.uniform(7.0, 11.0)
        fh = r.uniform(4.2, 5.2)
        nfl = max(1, int((th - 2.0) / fh))
        for face in range(3):
            if face == 0:
                W, y0, M = tw, ty - td / 2, None
            else:
                W, y0 = td, None
            nb = max(1, int(W / bw))
            bww = W / nb
            lit_cols = [c for c in range(nb) if r.random() < 0.16]
            for k in range(nb + 1):
                u = -W / 2 + k * bww
                if face == 0:
                    g.merge(bxz(1.1, 0.9, th, tx + u, y0 - 0.45, zc, mat='far:dark'))
                else:
                    sx_ = 1 if face == 1 else -1
                    g.merge(bxz(0.9, 1.1, th, tx + sx_ * (tw / 2 + 0.45), ty + u, zc, mat='far:dark'))
            for f_ in range(nfl):
                zf = zc + 1.5 + f_ * fh
                if face == 0:
                    g.merge(bxz(W, 0.6, 0.5, tx, y0 - 0.3, zf + fh - 0.5, mat='far'))
                    g.merge(bxz(W - 0.4, 0.12, fh * 0.42, tx, y0 - 0.06, zf + fh * 0.22, mat='far:dark'))
                else:
                    sx_ = 1 if face == 1 else -1
                    g.merge(bxz(0.6, W, 0.5, tx + sx_ * (tw / 2 + 0.3), ty, zf + fh - 0.5, mat='far'))
                    g.merge(bxz(0.12, W - 0.4, fh * 0.42, tx + sx_ * (tw / 2 + 0.06), ty, zf + fh * 0.22, mat='far:dark'))
                for c in lit_cols:
                    if r.random() < 0.6:
                        u = -W / 2 + (c + 0.5) * bww
                        lw = bww * r.uniform(0.35, 0.8)
                        gm = 'glow:window' if r.random() < 0.8 else 'glow:dim'
                        if face == 0:
                            g.merge(bxz(lw, 0.2, fh * 0.36, tx + u, y0 - 0.16, zf + fh * 0.25, mat=gm))
                        else:
                            sx_ = 1 if face == 1 else -1
                            g.merge(bxz(0.2, lw, fh * 0.36, tx + sx_ * (tw / 2 + 0.16), ty + u, zf + fh * 0.25, mat=gm))
        zc += th
        tops.append((tw, td, tx, ty, zc))
    # rooftop clutter on every tier top: vents / boxes every 10-20 m
    for (tw, td, tx, ty, zt) in tops:
        n = max(2, int(tw / 14.0))
        for k in range(n):
            x = tx - tw / 2 + (k + r.uniform(0.2, 0.8)) * tw / n
            y = ty + r.uniform(-td / 3, td / 3)
            kind = r.random()
            if kind < 0.45:
                g.merge(bxz(r.uniform(4, 9), r.uniform(4, 8), r.uniform(3, 8), x, y, zt + 1.2, mat='far:dark'))
            elif kind < 0.8:
                rr = r.uniform(0.8, 2.2)
                g.merge(P.cylinder(rr, r.uniform(6, 18), 10, bevel=0.0, mat='far', z0=zt + 1.2).move(x, y, 0))
            else:
                g.merge(P.cylinder(r.uniform(3, 6), r.uniform(4, 9), 14, bevel=0.0, mat='far:rust', z0=zt + 1.2).move(x, y, 0))
    # tall stacks (8-16 per complex on big blocks, fewer on small ones)
    if stacks:
        ns = max(1, int(sx * sy / 2600))
        for k in range(min(ns, 5)):
            (tw, td, tx, ty, zt) = r.choice(tops)
            x, y = tx + r.uniform(-tw / 3, tw / 3), ty + r.uniform(-td / 3, td / 3)
            hs = r.uniform(30, 90)
            rs = r.uniform(1.6, 3.4)
            g.merge(P.lathe([(0.0, 0.0), (rs * 1.4, 0.0), (rs, hs), (rs * 0.85, hs), (0.0, hs - 1)], 12, 'far').move(x, y, zt + 1.2))
            g.merge(P.ring(rs * 1.0, rs * 0.7, 1.2, 12, bevel=0.0, mat='far:dark', z0=zt + hs - 0.6).move(x, y, 0))
            if hs > 50:
                g.merge(beacon(x + rs * 0.6, y, zt + hs + 1.6, 1.0))
    # facade pipe rack across the front + lattice gantry tower
    zp = r.uniform(8.0, 14.0)
    for k in range(3):
        g.merge(tube((-sx / 2 - 2, -sy / 2 - 3.0 - k * 1.3, zp + k * 0.4), (sx / 2 + 2, -sy / 2 - 3.0 - k * 1.3, zp + k * 0.4), 0.7 - k * 0.12,
                     'far:rust', 8))
    for k in range(int(sx / 16) + 1):
        x = -sx / 2 + k * sx / max(1, int(sx / 16))
        g.merge(bxz(0.8, 5.0, 0.6, x, -sy / 2 - 3.8, zp - 0.9, mat='far:dark'))
        g.merge(bxz(0.6, 0.6, zp - 0.9, x, -sy / 2 - 5.8, 0.0, mat='far:dark'))
    gx = r.choice((-1, 1)) * sx * r.uniform(0.25, 0.45)
    gh = h * r.uniform(0.9, 1.35)
    tw_ = 6.0
    for sxx in (-1, 1):
        for syy in (-1, 1):
            g.merge(bxz(0.7, 0.7, gh, gx + sxx * tw_ / 2, -sy / 2 - 9 + syy * tw_ / 2, 0.0, mat='far:dark'))
    for k in range(int(gh / 8)):
        zz = k * 8.0
        g.merge(bxz(tw_, 0.5, 0.5, gx, -sy / 2 - 9 - tw_ / 2, zz + 8.0, mat='far:dark'))
        g.merge(beam((gx - tw_ / 2, -sy / 2 - 9 - tw_ / 2, zz), (gx + tw_ / 2, -sy / 2 - 9 - tw_ / 2, zz + 8.0), 0.35, 0.35, 'far:dark'))
    g.merge(beam((gx, -sy / 2 - 9, gh), (gx + r.choice((-1, 1)) * sx * 0.3, -sy / 2 - 1, h * 0.7), 3.0, 3.0, 'far'))   # conveyor/duct
    g.merge(beacon(gx, -sy / 2 - 9, gh + 0.8, 1.2))
    return g


def furnace_mega(h=300.0, seed=7, stoves=4, mirror=False, skip=1.0):
    """Horizon-scale blast furnace (far material): braced tower, top house, downcomer,
    cowper stoves, glowing casthouse slot. ~70 x 50 m footprint."""
    r = random.Random(seed)
    g = Geo()
    s = h / 100.0
    prof = [(0.0, 0.0), (11 * s, 0.0), (11 * s, 14 * s), (12.5 * s, 20 * s), (9 * s, 52 * s), (5 * s, 60 * s), (0.0, 60 * s)]
    g.merge(P.lathe(prof, 20, 'far:dark'))
    cw = 17 * s
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bxz(2.4 * s, 2.4 * s, 72 * s, sx * cw, sy * cw, 0.0, mat='far'))
    for z in (16, 30, 44, 58, 72):
        g.merge(bxz(2 * cw + 3 * s, 2 * cw + 3 * s, 1.0 * s, 0, 0, z * s, mat='far:dark'))
    for i, (za, zb_) in enumerate(((2, 16), (16, 30), (30, 44), (44, 58), (58, 72))):
        for sx in (-1, 1):
            g.merge(beam((sx * cw, -cw, za * s), (sx * cw, cw, zb_ * s), 0.9 * s, 0.9 * s, 'far'))
        g.merge(beam((-cw, -cw, za * s), (cw, -cw, zb_ * s), 0.9 * s, 0.9 * s, 'far'))
    g.merge(bxz(16 * s, 14 * s, 10 * s, 0, 0, 72 * s, mat='far:rust'))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        p0 = V((math.cos(a) * 3.5 * s, math.sin(a) * 3.5 * s, 60 * s))
        p1 = V((math.cos(a) * 4.5 * s, math.sin(a) * 4.5 * s, 90 * s))
        g.merge(tube(p0, p1, 1.3 * s, 'far', 8))
        g.merge(tube(p1, p1 + V((0, 0, 8 * s)), 0.9 * s, 'far:dark', 8))
    g.merge(tube((0, 0, 92 * s), (-30 * s, 0, 40 * s), 2.0 * s, 'far', 10))
    g.merge(P.lathe([(0.0, 20 * s), (2 * s, 20 * s), (8 * s, 28 * s), (8 * s, 40 * s), (0.0, 44 * s)], 14, 'far').move(-34 * s, 0, 0))
    for k in range(stoves):                                                         # stoves (3-5)
        hs_ = r.uniform(0.85, 1.1)
        g.merge(P.lathe([(0.0, 0.0), (6 * s, 0.0), (6 * s, 44 * s * hs_), (4 * s, 49 * s * hs_), (0.0, 50 * s * hs_)], 14, 'far:dark').move((k - (stoves - 1) / 2) * 14 * s, 34 * s, 0))
        g.merge(P.ring(6.3 * s, 5.9 * s, 0.8 * s, 14, bevel=0.0, mat='far', z0=40 * s * hs_).move((k - (stoves - 1) / 2) * 14 * s, 34 * s, 0))
    g.merge(tube(V(((-(stoves - 1) / 2) * 14 * s, 34 * s - 7 * s, 30 * s)), V((((stoves - 1) / 2) * 14 * s, 34 * s - 7 * s, 30 * s)), 1.6 * s, 'far', 8))
    g.merge(bxz(46 * s, 30 * s, 22 * s, 0, -28 * s, 0.0, mat='far'))                  # casthouse
    g.merge(bxz(30 * s, 0.4, 3 * s, 0, -43 * s - 0.3, 1.0, mat='glow:furnace'))
    g.merge(bxz(26 * s, 0.4, 9 * s, 0, -43 * s - 0.25, 1.0, mat='glow:furnace_grad'))
    top = V((10 * s, 0, 70 * s))
    foot = V((80 * s * skip, 0, 0))
    g.merge(beam(top, foot, 5 * s, 4 * s, 'far:dark'))                              # skip incline
    for t in (0.35, 0.65):
        p_ = top + (foot - top) * t
        g.merge(bxz(2.0 * s, 4.0 * s, p_.z, p_.x, 0, 0.0, mat='far:dark'))
    for z in (14, 30, 44, 58, 72):
        if r.random() < 0.7:
            g.merge(beacon(cw, -cw, z * s + 1.6, 1.2))
    g.merge(beacon(0, 0, 82 * s + 1.0, 1.6))
    if mirror:
        g.mirror('X')
    return g


# ============================================================================ SEA WALL DRESSING
def jetty(L=60.0, w=10.0, deck=0.0, sea=-14.0, seed=3):
    """Piled concrete jetty from the quay out along local -Y: deck, pile bents, fenders,
    bollards, a small pump house at the head, lamp. Deck top at `deck`, piles to `sea`-2."""
    r = random.Random(seed)
    g = Geo()
    g.merge(bxz(w, L, 1.2, 0, -L / 2, deck - 1.2, mat='concrete:grey', bev=0.08))
    g.merge(bxz(w + 0.4, L, 0.6, 0, -L / 2, deck - 1.9, mat='concrete:dark'))
    for k in range(int(L / 8) + 1):
        y = -k * L / int(L / 8)
        for sx in (-1, 1):
            g.merge(P.cylinder(0.55, deck - sea + 2.0, 10, bevel=0.0, mat='concrete:soot', z0=sea - 2.0).move(sx * (w / 2 - 1.0), y, 0))
        g.merge(bxz(w, 0.9, 1.0, 0, y, deck - 2.8, mat='concrete:dark'))
    for sx in (-1, 1):
        for k in range(int(L / 12)):
            y = -6 - k * 12
            g.merge(bxz(0.6, 1.8, 3.4, sx * (w / 2 + 0.3), y, sea + 0.4, mat='steel:black'))
            b = P.lathe([(0.0, 0.0), (0.5, 0.0), (0.4, 0.5), (0.36, 0.8), (0.6, 0.95), (0.6, 1.1), (0.0, 1.15)], 14, 'steel:dark')
            g.merge(b.move(sx * (w / 2 - 0.9), y, deck))
        g.merge(rail_line([(sx * (w / 2 - 0.2), -2.0, deck), (sx * (w / 2 - 0.2), -L + 0.5, deck)], h=1.1, post=2.5, r=0.05))
    g.merge(bxz(w + 0.05, 0.06, 0.8, 0, -L - 0.02, deck - 1.0, mat='trim:hazard2'))
    # head: pump house + lamp mast + mooring winch
    g.merge(bxz(7.0, 6.0, 5.0, 0, -L + 4.0, deck, mat='corr:' + r.choice(['blue', 'oxide', 'cream'])))
    g.merge(bxz(7.6, 6.6, 0.4, 0, -L + 4.0, deck + 5.0, mat='steel:dark'))
    g.merge(bxz(2.0, 0.1, 2.6, -1.5, -L + 0.95, deck, mat='steel:dark'))
    g.merge(wall_decal(-3.5, 3.5, -L + 0.93, deck + 2.0, deck + 5.0, 'curtain', 'soot'))
    g.merge(beam((w / 2 - 1.0, -L + 1.5, deck), (w / 2 - 1.0, -L + 1.5, deck + 14.0), 0.35, 0.35, 'steel:galv'))
    g.merge(flood(w / 2 - 1.0, -L + 1.0, deck + 14.0, 0.0))
    g.merge(beacon(-w / 2 + 0.8, -L + 0.8, deck + 1.0, 0.5))
    return g


def pontoon(L=34.0, w=9.0, sea=-14.0):
    """Floating steel pontoon with a gangway ramp up to the quay (+Y end)."""
    g = Geo()
    g.merge(bxz(w, L, 2.4, 0, 0, sea - 1.2, mat='steel:dark'))
    g.merge(bxz(w + 0.2, L + 0.2, 0.4, 0, 0, sea + 1.0, mat='steel:oxide'))
    for sx in (-1, 1):
        g.merge(bxz(0.8, L, 0.6, sx * (w / 2 + 0.2), 0, sea + 0.2, mat='steel:black'))
    for y in (-L / 3, L / 3):
        g.merge(P.cylinder(0.9, 20.0, 12, bevel=0.0, mat='steel:rust', z0=sea - 4.0).move(-w / 2 - 1.4, y, 0))
    ramp = bx(3.0, 18.0, 0.3, (0, 0, 0), mat='trim:grating')
    ramp.transform(Matrix.Translation(V((0, L / 2 + 8.0, sea + 7.5))) @ Matrix.Rotation(math.atan2(13.0, 18.0), 4, 'X'))
    g.merge(ramp)
    g.merge(bxz(4.0, 3.0, 2.6, 0, -L / 4, sea + 1.4, mat='corr:cream'))
    return g


def dolphin(sea=-14.0):
    """Mooring dolphin: concrete cap on a pile cluster, bollard, fenders."""
    g = Geo()
    for (x, y) in ((-2.2, -2.2), (2.2, -2.2), (-2.2, 2.2), (2.2, 2.2), (0, 0)):
        g.merge(P.cylinder(0.7, 16.0, 10, bevel=0.0, mat='concrete:soot', z0=sea - 4.0).move(x, y, 0))
    g.merge(bxz(7.5, 7.5, 2.2, 0, 0, sea + 4.0, mat='concrete:grey', bev=0.1))
    g.merge(bxz(0.6, 7.5, 3.0, 3.9, 0, sea + 1.2, mat='steel:black'))
    b = P.lathe([(0.0, 0.0), (0.6, 0.0), (0.5, 0.6), (0.45, 1.0), (0.75, 1.2), (0.75, 1.4), (0.0, 1.45)], 14, 'steel:dark')
    g.merge(b.move(0, 0, sea + 6.2))
    return g


# ============================================================================ FOREGROUND SCATTER
def ash_drift(L=14.0, depth=3.0, h=0.4, seed=1):
    """Low wind-blown ash drift against a wall along X (wall on +Y side)."""
    r = random.Random(seed)
    nx, ny = 14, 4
    verts, faces = [], []
    ph = [r.uniform(0, TAU) for _ in range(3)]
    for j in range(ny + 1):
        t = j / ny
        for i in range(nx + 1):
            u = i / nx
            x = -L / 2 + u * L
            env = math.sin(math.pi * u) ** 0.6
            dep = depth * env * (0.75 + 0.25 * math.sin(3 * u * TAU + ph[0]))
            y = depth / 2 - dep * (1 - t) - 0.02
            z = h * env * (t ** 1.4) * (0.8 + 0.2 * math.sin(5 * u * TAU + ph[1])) if j > 0 else -0.03
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    return Geo.from_pydata(verts, faces, 'heap:dust')


def trench(L=24.0, w=2.2):
    """Covered cable/drain trench: kerbs + grating covers (grating trim reads as depth)."""
    g = Geo()
    for s in (-1, 1):
        g.merge(bxz(L, 0.35, 0.16, 0, s * (w / 2 + 0.17), 0.0, mat='steel:dark'))
    g.merge(bxz(L, w, 0.08, 0, 0, 0.02, mat='trim:grating'))
    for k in range(int(L / 3.0)):
        g.merge(bxz(0.12, w, 0.1, -L / 2 + (k + 0.5) * L / int(L / 3.0), 0, 0.02, mat='steel:dark'))
    return g


def cable_tray(L=24.0, h=3.2, seed=2):
    """Cable tray on T-posts along X (mech knee height), cables sagging between posts."""
    g = Geo()
    n = int(L / 6.0)
    for k in range(n + 1):
        x = -L / 2 + k * L / n
        g.merge(bxz(0.25, 0.25, h, x, 0, 0.0, mat='steel:galv'))
        g.merge(bxz(0.3, 1.4, 0.2, x, 0, h, mat='steel:galv'))
        g.merge(bxz(0.6, 0.6, 0.3, x, 0, 0.0, mat='concrete:grey'))
    g.merge(bxz(L, 1.2, 0.12, 0, 0, h + 0.2, mat='trim:grating'))
    for s in (-1, 1):
        g.merge(bxz(L, 0.06, 0.3, 0, s * 0.6, h + 0.2, mat='steel:galv'))
    for k in range(n):
        x0, x1 = -L / 2 + k * L / n, -L / 2 + (k + 1) * L / n
        g.merge(P.cable((x0, 0.2, h + 0.35), (x1, 0.2, h + 0.35), sag=0.0, radius=0.09, segs=6, mat='steel:black', n=4))
    return g


def bollards(n=6, gap=3.0):
    g = Geo()
    for k in range(n):
        x = (k - (n - 1) / 2) * gap
        g.merge(P.cylinder(0.35, 1.3, 12, bevel=0.0, mat='steel:yellow', z0=0.0).move(x, 0, 0))
        g.merge(P.cylinder(0.37, 0.25, 12, bevel=0.0, mat='steel:black', z0=0.7).move(x, 0, 0))
    return g


def litter(seed=1, s=4.0):
    """Flat walk-through debris (<0.45 m): cut plates, sheet offcuts, pipe and beam stubs,
    bolts, a slag crust. No collider (mechs stride over it)."""
    r = random.Random(seed)
    g = Geo()
    for i in range(r.randint(7, 12)):
        a = r.uniform(0, TAU)
        rr = r.uniform(0, s)
        x, y = math.cos(a) * rr, math.sin(a) * rr
        k = r.random()
        if k < 0.35:
            b = bx(r.uniform(0.6, 2.2), r.uniform(0.4, 1.6), r.uniform(0.03, 0.08), mat=r.choice(['steel:rust', 'steel:oxide', 'steel:dark']))
            b.transform(Matrix.Translation(V((x, y, 0.06))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(r.uniform(-0.12, 0.12), 4, 'X'))
        elif k < 0.6:
            L = r.uniform(1.0, 3.2)
            b = P.lathe([(0.16, -L / 2), (0.2, -L / 2), (0.2, L / 2), (0.16, L / 2), (0.16, -L / 2)], 10, r.choice(['steel:rust', 'steel:galv', 'steel:bone']))
            b.transform(Matrix.Translation(V((x, y, 0.2))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        elif k < 0.78:
            b = P.girder_i(r.uniform(1.2, 3.0), h=0.3, w=0.18, mat='steel:rust')
            b.transform(Matrix.Translation(V((x, y, 0.09))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
        elif k < 0.9:
            b = bx(r.uniform(0.3, 0.7), r.uniform(0.3, 0.6), r.uniform(0.2, 0.4), mat=r.choice(['concrete', 'concrete:dark']), bev=0.04)
            b.transform(Matrix.Translation(V((x, y, 0.1))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(r.uniform(-0.3, 0.3), 4, 'X'))
        else:
            b = P.dome(r.uniform(0.8, 1.6), r.uniform(0.1, 0.22), segs=10, rings=3, mat='heap:slag')
            b.transform(Matrix.Translation(V((x, y, -0.02))) @ Matrix.Diagonal((1.0, r.uniform(0.6, 1.0), 1.0, 1.0)))
        g.merge(b)
    return g


def embers(seed=9, s=3.0):
    """Burning debris bed: charred plates and beams over glowing embers (pair with a hot
    smoke plume + a FIRE light pool in the layout)."""
    r = random.Random(seed)
    g = Geo()
    for i in range(14):
        a = r.uniform(0, TAU)
        rr = r.uniform(0, s)
        b = bx(r.uniform(0.3, 1.1), r.uniform(0.3, 0.9), r.uniform(0.15, 0.4), mat=r.choice(['glow:ember', 'glow:ember', 'glow:furnace', 'glow:hot']))
        b.transform(Matrix.Translation(V((math.cos(a) * rr, math.sin(a) * rr, 0.08))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z'))
        g.merge(b)
    for i in range(10):
        a = r.uniform(0, TAU)
        rr = r.uniform(0, s * 1.1)
        k = r.random()
        if k < 0.6:
            b = bx(r.uniform(1.0, 3.0), r.uniform(0.6, 1.8), 0.08, mat='steel:black')
            b.transform(Matrix.Translation(V((math.cos(a) * rr, math.sin(a) * rr, r.uniform(0.3, 1.2)))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @
                        Matrix.Rotation(r.uniform(-0.8, 0.8), 4, 'X'))
        else:
            b = P.girder_i(r.uniform(2, 4.5), h=0.4, w=0.25, mat='steel:black')
            b.transform(Matrix.Translation(V((math.cos(a) * rr, math.sin(a) * rr, r.uniform(0.4, 1.4)))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @
                        Matrix.Rotation(r.uniform(-0.5, 0.5), 4, 'Y'))
        g.merge(b)
    g.merge(P.dome(s * 1.3, 0.3, segs=14, rings=3, mat='heap:coal'))
    return g


def ground_cables(L=26.0, n=4, seed=3):
    """Heavy power cables snaking across the deck (walk-through, < 0.25 m), a cable junction box
    and a cable reel stand at the ends. Local run along X."""
    r = random.Random(seed)
    g = Geo()
    for i in range(n):
        y0 = (i - (n - 1) / 2) * 0.55 + r.uniform(-0.2, 0.2)
        pts = []
        for k in range(9):
            x = -L / 2 + L * k / 8
            pts.append(V((x, y0 + math.sin(k * 0.9 + i * 1.7 + r.uniform(0, 1)) * r.uniform(0.6, 2.2), 0.09 + 0.03 * i)))
        g.merge(P.sweep(pts, r.uniform(0.07, 0.12), 6, mat=r.choice(['steel:black', 'steel:black', 'steel:dark']), smooth_path=True, subdiv=3))
    g.merge(bxz(1.6, 1.2, 1.1, -L / 2 - 0.6, 0, 0.0, mat='steel:yellow'))
    g.merge(bxz(1.62, 0.06, 0.3, -L / 2 - 0.6, -0.62, 0.6, mat='trim:hazard2'))
    g.merge(bxz(1.4, 1.4, 0.15, L / 2 + 0.4, 0, 0.0, mat='steel:dark'))
    return g


def ash_patch(rx=6.0, ry=4.0, h=0.32, seed=1):
    """Low wind-shaped ash / ore-dust mound on open ground (walk-through)."""
    r = random.Random(seed)
    verts, faces = [], []
    rings, segs = 4, 18
    ph = [r.uniform(0, TAU) for _ in range(3)]
    for i in range(rings + 1):
        t = i / rings
        for j in range(segs):
            a = TAU * j / segs
            wob = 1 + 0.18 * math.sin(2 * a + ph[0]) + 0.1 * math.sin(5 * a + ph[1])
            rr = (1 - t) * wob
            z = h * (1 - (1 - t) ** 2) * (0.85 + 0.15 * math.sin(3 * a + ph[2])) if i > 0 else -0.04
            verts.append((math.cos(a) * rx * rr, math.sin(a) * ry * rr, z))
    top = len(verts)
    verts.append((0.0, 0.0, h))
    for i in range(rings):
        for j in range(segs):
            j2 = (j + 1) % segs
            a_, b_, c_, d_ = i * segs + j, i * segs + j2, (i + 1) * segs + j2, (i + 1) * segs + j
            faces.append((a_, b_, top) if i == rings - 1 else (a_, b_, c_, d_))
    return Geo.from_pydata(verts, faces, 'heap:dust')
