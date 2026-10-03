"""blender/arena/farkit.py - the far / horizon kit (r3): silhouette-led set pieces for 400 m - 3 km.

Same conventions as pieces.py (Blender coords, Z up, local origin at the base centre, front = -Y,
semantic materials). Everything here uses the single 'far' material (one draw call, procedural
weathering in src/world/materials.js SURF.far) whose variant ALPHA selects the surface class:
    far / far:pale / far:dark       concrete (lift joints, rain wash, soot streaks)
    far:steel / sdark / rust / oxide plated steel (stiffener rings, faceted plates, rust bleed)
    far:shell / red / white          slip-formed stack shells (faint lifts, soot from the lip)
    far:frame / fdark / soot         plain members (lattice, pipes, braces)
plus glow:* emitters (windows, furnace slots, beacons).

  furnace_far(h, seed, stoves, mirror, skip)  horizon blast furnace: banded shell, bustle main,
                                    4-column tower with X-braced bays + deck fascias, shell
                                    platforms, top house, uptakes/downcomer/dust catcher, gas main,
                                    banded stoves with platforms + ladder cages, hot-blast main,
                                    lattice skip incline, casthouse with monitor roof + glow slots
  stack_far(style, h, r0, seed)     3 profiles: 'taper' (concrete, random band spacing/colour),
                                    'steel' (plated, platforms, guy wires), 'twin' (two flues in a
                                    braced lattice tower)
  works_far(seed, sx, sy, h)        far industrial block: sawtooth / monitor roof hall + plant tower,
                                    2-3 trim bands, downpipes, aligned window rows (50 %), a conveyor
                                    gallery tying the roof to a transfer tower, roof vents
"""
import math
import random

from mathutils import Matrix, Vector

from akit import P, Geo, TAU
from pieces import V, beacon, beam, bx, bxz, tube, xbrace


def _rings(g, prof_r, z0, z1, step, h, out, mat, segs):
    """Stiffener / band rings along a lathe: prof_r(z) gives the shell radius."""
    z = z0
    while z < z1:
        r = prof_r(z)
        g.merge(P.lathe([(r - 0.02, z), (r + out, z), (prof_r(z + h) + out, z + h), (prof_r(z + h) - 0.02, z + h)], segs, mat))
        z += step


def _platform(g, r_in, r_out, z, s, segs, mat='far:fdark', deck=True, nbr=4):
    """Circular platform: deck ring + a kick-plate fascia (reads as a thin bright lip in raking
    light) + brackets."""
    if deck:
        g.merge(P.ring(r_out, r_in, 0.35 * s, segs, bevel=0.0, mat=mat, z0=z))
    g.merge(P.ring(r_out + 0.05 * s, r_out - 0.1 * s, 0.7 * s, segs, bevel=0.0, mat='far:frame', z0=z + (0.35 * s if deck else 0.0)))
    for k in range(nbr):
        a = TAU * k / nbr + 0.2
        c, si = math.cos(a), math.sin(a)
        g.merge(beam((c * r_in, si * r_in, z - 1.4 * s), (c * r_out * 0.95, si * r_out * 0.95, z), 0.25 * s, 0.25 * s, 'far:frame'))


def _truss2(g, a, b, height, depth, bays, chord, member, mat='far:frame'):
    """Cheap box truss from a to b (plain boxes: 2 side faces braced, top + bottom chords,
    portal ties) - the far-kit stand-in for iwkit's bevelled truss."""
    a, b = V(a), V(b)
    d = b - a
    ex = d.normalized()
    ey = V((0, 0, 1)).cross(ex).normalized()
    ez = ex.cross(ey).normalized()
    hy, hz = depth / 2, height / 2
    for sy in (-1, 1):
        for sz in (-1, 1):
            o = ey * (sy * hy) + ez * (sz * hz)
            g.merge(beam(a + o, b + o, chord, chord, mat))
    for i in range(bays + 1):
        p = a + d * (i / bays)
        for sy in (-1, 1):
            g.merge(beam(p + ey * (sy * hy) - ez * hz, p + ey * (sy * hy) + ez * hz, member, member, mat))
        if i % 2 == 0:
            g.merge(beam(p - ey * hy + ez * hz, p + ey * hy + ez * hz, member, member, mat))
        if i < bays:
            q = a + d * ((i + 1) / bays)
            for sy in (-1, 1):
                lo, hi = (-hz, hz) if i % 2 == 0 else (hz, -hz)
                g.merge(beam(p + ey * (sy * hy) + ez * lo, q + ey * (sy * hy) + ez * hi, member * 0.85, member * 0.85, mat))


def _gallery(g, a, b, w, h, member=0.4, bay=6.0, mat='far:frame'):
    """Conveyor gallery a -> b (bottom centreline): braced truss side frames in ~6 m bays, a
    corrugated roof slab and a floor slab (r4: replaces the plain extruded box ramps)."""
    a, b = V(a), V(b)
    up = V((0, 0, h / 2))
    n = max(2, int((b - a).length / bay))
    _truss2(g, a + up, b + up, h, w, n, member * 1.2, member, mat=mat)
    g.merge(beam(a + up * 2 + V((0, 0, 0.25)), b + up * 2 + V((0, 0, 0.25)), w + 1.0, 0.4, 'far:sdark'))
    g.merge(beam(a + V((0, 0, 0.15)), b + V((0, 0, 0.15)), w, 0.3, 'far:fdark'))


def _cage(g, x, y, z0, z1, s, facing=0.0, hoops=True):
    """Caged ladder strip (two stiles + a cage hoop band every 3 m, all as thin members)."""
    m = Matrix.Translation(V((x, y, 0))) @ Matrix.Rotation(facing, 4, 'Z')
    c = Geo()
    w = 0.45 * s
    for sx in (-w, w):
        c.merge(bx(0.12 * s, 0.12 * s, z1 - z0, (sx, -0.35 * s, (z0 + z1) / 2), mat='far:fdark'))
    zz = z0 + 2.5 * s
    while hoops and zz < z1:
        c.merge(bx(2 * w + 0.2 * s, 0.1 * s, 0.1 * s, (0, -0.8 * s, zz), mat='far:fdark'))
        zz += 2.6 * s
    c.transform(m)
    g.merge(c)


def _far_bins(g, x0, y0, s):
    """Stock-house at the skip foot: bin block on a column skirt with hopper cones, concrete ribs,
    a clad head house, a gallery stub and a roof edge band (never a plain box)."""
    W, D = 22 * s, 16 * s
    for i in range(4):                                                     # column skirt 0-5*s
        for j in range(3):
            g.merge(bxz(1.0 * s, 1.0 * s, 5 * s, x0 - W * 0.42 + i * W * 0.28, y0 - D * 0.38 + j * D * 0.38, 0.0, mat='far'))
    for i in range(3):
        for j in range(2):
            fr = P.frustum((5.4 * s, 5.4 * s), (1.2 * s, 1.2 * s), 3.0 * s, bevel=0.0, segs=1, mat='far:sdark')
            fr.transform(Matrix.Translation(V((x0 - W * 0.3 + i * W * 0.3, y0 - D * 0.2 + j * D * 0.4, 5.6 * s))) @ Matrix.Rotation(math.pi, 4, 'X'))
            g.merge(fr)
    g.merge(bxz(W, D, 8 * s, x0, y0, 5.6 * s, mat='far:dark'))            # bin block
    for k in range(6):                                                     # ribs
        x = x0 - W / 2 + k * W / 5
        for sy in (-1, 1):
            g.merge(bxz(0.8 * s, 0.6 * s, 8 * s, x, y0 + sy * (D / 2 + 0.3 * s), 5.6 * s, mat='far'))
    for k in range(4):
        y = y0 - D / 2 + k * D / 3
        for sx in (-1, 1):
            g.merge(bxz(0.6 * s, 0.8 * s, 8 * s, x0 + sx * (W / 2 + 0.3 * s), y, 5.6 * s, mat='far'))
    g.merge(bxz(W + 1.4 * s, D + 1.4 * s, 0.7 * s, x0, y0, 13.6 * s, mat='far:pale'))
    g.merge(bxz(W * 0.6, D * 0.6, 4 * s, x0 - W * 0.12, y0 + D * 0.1, 14.3 * s, mat='far:oxide'))   # head house
    g.merge(bxz(W * 0.6 + 0.6 * s, D * 0.6 + 0.6 * s, 0.4 * s, x0 - W * 0.12, y0 + D * 0.1, 18.3 * s, mat='far:fdark'))
    g.merge(bxz(W * 0.55, 0.3 * s, 1.0 * s, x0 - W * 0.12, y0 + D * 0.1 - D * 0.3 - 0.1 * s, 16.2 * s, mat='far:soot'))
    g.merge(bxz(W * 0.95, 0.3 * s, 1.6 * s, x0, y0 - D / 2 - 0.5 * s, 10.5 * s, mat='far:soot'))
    a_, b_ = V((x0 + W * 0.15, y0 + D * 0.1, 16.5 * s)), V((x0 + W * 0.15 + 24 * s, y0 + D * 0.1 + 6 * s, 4.0 * s))
    _gallery(g, a_ - V((0, 0, 1.3 * s)), b_ - V((0, 0, 1.3 * s)), 3.0 * s, 2.6 * s, member=0.3 * s, bay=2.4 * s)   # conveyor gallery to the yard
    m_ = (a_ + b_) * 0.5
    for sy in (-1, 1):
        g.merge(bxz(0.6 * s, 0.6 * s, m_.z - 1.3 * s, m_.x, m_.y + sy * 1.4 * s, 0.0, mat='far:frame'))
    g.merge(beacon(x0 - W * 0.12 + W * 0.25, y0, 18.9 * s, 1.2))


# ============================================================================ FURNACE
def furnace_far(h=300.0, seed=7, stoves=4, mirror=False, skip=1.0):
    r = random.Random(seed)
    g = Geo()
    s = h / 100.0
    SG = 24
    # --- shell (hearth, bosh, stack, throat) + stiffener bands + bustle main + tuyere stocks
    prof = [(0.0, 0.0), (9.5 * s, 0.0), (9.5 * s, 12 * s), (11 * s, 17 * s), (11 * s, 20 * s), (7.6 * s, 46 * s), (6.4 * s, 50 * s),
            (4.2 * s, 55 * s), (3.2 * s, 58 * s), (0.0, 58 * s)]
    g.merge(P.lathe(prof, SG, 'far:sdark'))

    def shell_r(z):
        zz = z / s
        if zz < 12:
            return 9.5 * s
        if zz < 17:
            return (9.5 + 1.5 * (zz - 12) / 5) * s
        if zz < 20:
            return 11 * s
        if zz < 46:
            return (11 - 3.4 * (zz - 20) / 26) * s
        return (7.6 - 1.2 * (zz - 46) / 4) * s
    _rings(g, shell_r, 3 * s, 11.5 * s, 5.0 * s, 0.7 * s, 0.25 * s, 'far:rust', SG)
    _rings(g, shell_r, 24 * s, 45 * s, 9.0 * s, 0.5 * s, 0.22 * s, 'far:steel', SG)
    g.merge(P.torus(13.5 * s, 1.4 * s, SG, 6, mat='far:rust').move(0, 0, 19.5 * s))
    for i in range(8):
        a = TAU * i / 8
        c, si = math.cos(a), math.sin(a)
        g.merge(beam((c * 13.2 * s, si * 13.2 * s, 18.6 * s), (c * 9.8 * s, si * 9.8 * s, 14 * s), 0.7 * s, 0.7 * s, 'far:fdark'))
    _platform(g, shell_r(26 * s), shell_r(26 * s) + 4.5 * s, 26 * s, s, SG)
    _platform(g, shell_r(40 * s), shell_r(40 * s) + 4.0 * s, 40 * s, s, SG, deck=False)
    # --- 4-column tower: X-braced bays on all four faces, deck slabs with fascias
    cw = 17 * s
    zs = [0.0, 14.0, 26.0, 38.0, 50.0, 62.0, 72.0]
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bxz(2.4 * s, 2.4 * s, 74 * s, sx * cw, sy * cw, 0.0, mat='far:frame'))
            g.merge(bxz(4.0 * s, 4.0 * s, 2.0 * s, sx * cw, sy * cw, 0.0, mat='far'))
    for z in zs[1:]:
        zz = z * s
        for k in range(4):
            a = k * math.pi / 2
            c, si = round(math.cos(a)), round(math.sin(a))
            L = 2 * cw + 3 * s
            g.merge(bxz(L if c == 0 else 1.6 * s, L if si == 0 else 1.6 * s, 1.3 * s, c * cw, si * cw, zz - 1.3 * s, mat='far:fdark'))
    for i in range(len(zs) - 1):
        z0, z1 = zs[i] * s + 1.0 * s, zs[i + 1] * s - 1.3 * s
        m = 0.7 * s
        for sx in (-1, 1):
            x = sx * cw
            g.merge(xbrace(V((x, -cw, z0)), V((x, cw, z0)), V((x, cw, z1)), V((x, -cw, z1)), m, 'far:frame'))
        for sy in (-1, 1):
            y = sy * cw
            if sy < 0 and i == 0:
                continue          # casthouse side stays open at the tap floor
            g.merge(xbrace(V((-cw, y, z0)), V((cw, y, z0)), V((cw, y, z1)), V((-cw, y, z1)), m, 'far:frame'))
    _cage(g, cw + 1.6 * s, -cw + 3 * s, 0.0, 72 * s, s, facing=-math.pi / 2)
    # --- top house + charging gear + louvre band
    g.merge(bxz(16 * s, 14 * s, 9 * s, 0, 0, 72 * s, mat='far:oxide'))
    g.merge(bxz(16.8 * s, 14.8 * s, 0.8 * s, 0, 0, 81 * s, mat='far:fdark'))
    for sy in (-1, 1):
        g.merge(bxz(15 * s, 0.3 * s, 1.6 * s, 0, sy * 7.05 * s, 76 * s, mat='far:soot'))
    g.merge(bxz(7 * s, 6 * s, 5 * s, -3 * s, 2 * s, 81.8 * s, mat='far:steel'))
    # --- uptakes, bleeders, downcomer, dust catcher, gas main
    hub = V((-2.0 * s, 0.0, 92 * s))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        p0 = V((math.cos(a) * 3.5 * s, math.sin(a) * 3.5 * s, 58 * s))
        p1 = V((math.cos(a) * 4.6 * s, math.sin(a) * 4.6 * s, 88 * s))
        g.merge(tube(p0, p1, 1.3 * s, 'far:sdark', 8))
        g.merge(tube(p1, hub, 1.1 * s, 'far:sdark', 8))
        g.merge(tube(p1, p1 + V((0, 0, 9 * s)), 0.8 * s, 'far:fdark', 8))
        g.merge(P.cylinder(1.4 * s, 0.8 * s, 8, bevel=0.0, mat='far:fdark').move(p1 + V((0, 0, 9.2 * s))))
    dcx = -38 * s
    g.merge(P.sweep([hub, V((-12 * s, 0, 90 * s)), V((-24 * s, 0, 78 * s)), V((dcx + 3 * s, 0, 40 * s))], 2.1 * s, 10,
                    mat='far:sdark', smooth_path=True, subdiv=4))
    g.merge(P.lathe([(0.0, 14 * s), (2.2 * s, 14 * s), (8 * s, 22 * s), (8 * s, 35 * s), (5.5 * s, 39 * s), (0.0, 40 * s)], 16,
                    'far:steel').move(dcx, 0, 0))
    _rings(g, lambda z: 8 * s, 24 * s, 35 * s, 7.0 * s, 0.5 * s, 0.2 * s, 'far:rust', 16)
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bxz(1.2 * s, 1.2 * s, 22 * s, dcx + sx * 5.6 * s, sy * 5.6 * s, 0.0, mat='far:frame'))
        g.merge(beam((dcx + sx * 5.6 * s, -5.6 * s, 2 * s), (dcx + sx * 5.6 * s, 5.6 * s, 13 * s), 0.5 * s, 0.5 * s, 'far:frame'))
    g.merge(tube((dcx, 0, 18 * s), (dcx, 26 * s, 18 * s), 1.7 * s, 'far:sdark', 8))
    g.merge(tube((dcx, 26 * s, 18 * s), (dcx, 26 * s, 0.0), 1.7 * s, 'far:sdark', 8))
    # --- cowper stoves in a row behind (+Y): banded shells, two platforms, ladder cage, domes
    sy0 = 36 * s
    xs = [(k - (stoves - 1) / 2) * 15 * s for k in range(stoves)]
    for k, x in enumerate(xs):
        hs = (44 + r.uniform(-3, 4)) * s
        rr = 6.2 * s
        prof = [(0.0, 0.0), (rr + 0.6 * s, 0.0), (rr + 0.6 * s, 1.4 * s), (rr, 1.8 * s), (rr, hs)]
        for i in range(1, 6):
            a = (math.pi / 2) * i / 5
            prof.append((rr * math.cos(a), hs + rr * 0.85 * math.sin(a)))
        prof[-1] = (0.0, hs + rr * 0.85)
        st = Geo()
        st.merge(P.lathe(prof, 14, 'far:steel'))
        _rings(st, lambda z: rr, 6 * s, hs - 1 * s, r.uniform(7.0, 9.0) * s, 0.9 * s, 0.18 * s, 'far:sdark', 14)
        _platform(st, rr, rr + 2.4 * s, hs * 0.45, s, 12, deck=False, nbr=3)
        _platform(st, rr, rr + 2.2 * s, hs - 1.5 * s, s, 12, deck=False, nbr=3)
        _cage(st, 0.0, -rr - 0.2 * s, 0.0, hs - 1.5 * s, s, hoops=False)
        st.merge(P.cylinder(1.0 * s, 1.0 * s, 8, bevel=0.0, mat='far:fdark', z0=hs + rr * 0.85 - 0.4 * s))
        st.merge(tube((0, -rr + 0.4 * s, 16 * s), (0, -rr - 4 * s, 16 * s), 1.2 * s, 'far:sdark', 8))   # hot-blast valve stub
        st.merge(bxz(2.6 * s, 2.4 * s, 2.6 * s, 0, -rr - 3.2 * s, 14.8 * s, mat='far:fdark'))
        st.move(x, sy0, 0)
        g.merge(st)
    hb = 16 * s
    g.merge(tube((xs[0] - 6 * s, sy0 - 10.5 * s, hb), (xs[-1] + 6 * s, sy0 - 10.5 * s, hb), 1.7 * s, 'far:rust', 8))   # hot-blast main
    g.merge(tube((0, sy0 - 10.5 * s, hb), (0, 13.5 * s, 19.5 * s), 1.5 * s, 'far:rust', 8))                              # to the bustle
    for x in xs + [xs[0] - 6 * s, xs[-1] + 6 * s]:
        g.merge(bxz(1.0 * s, 1.0 * s, hb - 1.6 * s, x, sy0 - 10.5 * s, 0.0, mat='far:frame'))
    g.merge(tube((dcx, 26 * s, 6 * s), (xs[-1] + 9 * s if not mirror else xs[0] - 9 * s, 26 * s, 6 * s), 1.4 * s, 'far:sdark', 8))  # gas main
    # --- casthouse (-Y): plated hall on a concrete dado, pitched roof with a glazed monitor and a
    # row of roof ventilators, vertical frame ribs every ~8*s, two dark louvre / window bands, a
    # runner-hood box over the tap floor, end annexes of different heights + a stair tower,
    # downpipes, glowing tap-floor slots (nothing reads as a plain box at 300-800 m)
    chx, chy, cw2, cd2, chh = 0.0, -30 * s, 50 * s, 30 * s, 18 * s
    fy = chy - cd2 / 2
    g.merge(bxz(cw2 + 0.6 * s, cd2 + 0.6 * s, 5 * s, chx, chy, 0.0, mat='far:pale'))                 # concrete dado
    g.merge(bxz(cw2, cd2, chh - 5 * s, chx, chy, 5 * s, mat='far:steel'))
    rise = cd2 * 0.12
    for sy in (-1, 1):                                                                              # pitched roof
        rf = bx(cw2 + 1.0 * s, cd2 / 2 + 0.8 * s, 0.4 * s, (0, 0, 0), mat='far:sdark')
        rf.transform(Matrix.Translation(V((chx, chy + sy * cd2 / 4, chh + rise / 2))) @ Matrix.Rotation(sy * math.atan2(rise, cd2 / 2), 4, 'X'))
        g.merge(rf)
    g.merge(bxz(cw2 * 0.8, cd2 * 0.22, 3.5 * s, chx, chy, chh + rise * 0.8, mat='far:steel'))      # monitor
    g.merge(bxz(cw2 * 0.8 + 0.2 * s, cd2 * 0.22 + 0.3 * s, 1.4 * s, chx, chy, chh + rise * 0.8 + 1.2 * s, mat='far:soot'))
    g.merge(bxz(cw2 * 0.8 + 1.0 * s, cd2 * 0.22 + 1.2 * s, 0.5 * s, chx, chy, chh + rise * 0.8 + 3.5 * s, mat='far:fdark'))
    for k in range(7):                                                                              # roof ventilators
        x = chx - cw2 * 0.42 + k * cw2 * 0.14
        for sy in (-1, 1):
            z = chh + rise * 0.35
            g.merge(P.cylinder(0.9 * s, 1.4 * s, 8, bevel=0.0, mat='far:frame', z0=z).move(x, chy + sy * cd2 * 0.3, 0))
            g.merge(P.cylinder(1.3 * s, 0.3 * s, 8, bevel=0.0, mat='far:fdark', z0=z + 1.6 * s).move(x, chy + sy * cd2 * 0.3, 0))
    nb = 6
    for k in range(nb + 1):                                                                         # frame ribs (front + ends)
        x = chx - cw2 / 2 + k * cw2 / nb
        g.merge(bxz(0.9 * s, 0.7 * s, chh, x, fy - 0.3 * s, 0.0, mat='far:fdark'))
    for sx in (-1, 1):
        for k in range(4):
            y = chy - cd2 / 2 + k * cd2 / 3
            g.merge(bxz(0.7 * s, 0.9 * s, chh, chx + sx * (cw2 / 2 + 0.3 * s), y, 0.0, mat='far:fdark'))
    for zb, hb in ((9.5 * s, 1.8 * s), (14.5 * s, 1.4 * s)):                                        # louvre / window bands
        g.merge(bxz(cw2 - 1.0 * s, 0.4 * s, hb, chx, fy - 0.15 * s, zb, mat='far:soot'))
        for sx in (-1, 1):
            g.merge(bxz(0.4 * s, cd2 - 1.0 * s, hb, chx + sx * (cw2 / 2 + 0.15 * s), chy, zb, mat='far:soot'))
    for k in range(nb):                                                                             # downpipes
        x = chx - cw2 / 2 + (k + 0.5) * cw2 / nb + 2.0 * s
        g.merge(bxz(0.35 * s, 0.35 * s, chh - 1.0 * s, x, fy - 0.5 * s, 0.0, mat='far:fdark'))
    g.merge(bxz(30 * s, 6 * s, 4 * s, chx, fy - 3 * s, 8 * s, mat='far:sdark'))                      # runner hood
    g.merge(tube((chx - 8 * s, fy - 3 * s, 12 * s), (chx - 8 * s, fy + 4 * s, chh + rise + 4 * s), 1.1 * s, 'far:rust', 8))
    g.merge(tube((chx + 8 * s, fy - 3 * s, 12 * s), (chx + 8 * s, fy + 4 * s, chh + rise + 4 * s), 1.1 * s, 'far:rust', 8))
    for sx, aw_, ah_ in ((-1, 10 * s, 11 * s), (1, 8 * s, 14 * s)):                                   # end annexes
        ax_ = chx + sx * (cw2 / 2 + aw_ / 2)
        g.merge(bxz(aw_, cd2 * 0.8, ah_, ax_, chy + cd2 * 0.05, 0.0, mat='far:oxide' if sx < 0 else 'far:pale'))
        g.merge(bxz(aw_ + 0.6 * s, cd2 * 0.8 + 0.6 * s, 0.5 * s, ax_, chy + cd2 * 0.05, ah_, mat='far:fdark'))
        g.merge(bxz(aw_ - 1.0 * s, 0.3 * s, 1.2 * s, ax_, chy - cd2 * 0.35 - 0.1 * s, ah_ - 3.5 * s, mat='far:soot'))
    stx = chx - cw2 / 2 - 10 * s - 3 * s
    g.merge(bxz(5 * s, 5 * s, chh + 8 * s, stx, fy + 4 * s, 0.0, mat='far:pale'))                     # stair tower
    g.merge(bxz(5.6 * s, 5.6 * s, 0.6 * s, stx, fy + 4 * s, chh + 8 * s, mat='far:fdark'))
    g.merge(bxz(0.3 * s, 1.0 * s, chh + 4 * s, stx, fy + 1.4 * s, 2 * s, mat='far:soot'))
    g.merge(beacon(stx, fy + 4 * s, chh + 9.4 * s, 1.2))
    g.merge(bxz(32 * s, 0.4, 3 * s, chx, fy - 0.4, 1.0, mat='glow:furnace'))
    g.merge(bxz(28 * s, 0.4, 9 * s, chx, fy - 0.35, 1.0, mat='glow:furnace_grad'))
    # --- skip incline: lattice truss from the top to the stock-house at the foot, on 2 trestles
    top = V((10 * s, 0.0, 72 * s))
    foot = V((80 * s * skip, 0.0, 6 * s))
    d = foot - top
    _truss2(g, top, foot, 5 * s, 6 * s, 10, 0.8 * s, 0.45 * s)
    for t in (0.38, 0.7):
        p_ = top + d * t
        for sy in (-1, 1):
            g.merge(bxz(1.0 * s, 1.0 * s, p_.z - 2.5 * s, p_.x, sy * 3 * s, 0.0, mat='far:frame'))
        g.merge(xbrace(V((p_.x, -3 * s, 2 * s)), V((p_.x, 3 * s, 2 * s)), V((p_.x, 3 * s, p_.z - 4 * s)), V((p_.x, -3 * s, p_.z - 4 * s)),
                       0.4 * s, 'far:frame'))
    _far_bins(g, foot.x + 8 * s, 0.0, s)                                                          # stock-house / bins
    # --- beacons
    for z in (26, 50, 72):
        g.merge(beacon(cw, -cw, z * s + 1.6, 1.2))
    g.merge(beacon(0, 0, 92 * s + 2.0, 1.6))
    if mirror:
        g.mirror('X')
    return g


# ============================================================================ STACKS
def stack_far(style='taper', h=200.0, r0=8.0, seed=1):
    """Three horizon stack profiles (far material). Local origin at the base."""
    r = random.Random(seed)
    g = Geo()
    SG = 16
    if style == 'taper':
        r1 = r0 * r.uniform(0.5, 0.62)
        prof = [(0.0, 0.0), (r0 + 0.8, 0.0), (r0 + 0.8, 2.0), (r0, 2.5), (r1, h), (r1 + 0.4, h), (r1 + 0.4, h + 1.4), (r1 - 0.3, h + 1.4), (r1 - 0.3, h - 2.0)]
        g.merge(P.lathe(prof, SG, 'far:shell'))
        band = r.choice(('red', 'white', 'none', 'red'))
        step = r.uniform(6.0, 14.0)
        if band != 'none':      # painted day-mark bands in the top third
            z = h - 3.0
            n = 0
            while z > h * 0.62 and n < 7:
                rr = r0 + (r1 - r0) * (z / h)
                g.merge(P.ring(rr + 0.12, rr - 0.1, step * 0.5, SG, bevel=0.0, mat='far:' + (band if n % 2 == 0 else 'shell'), z0=z - step * 0.5))
                z -= step
                n += 1
        g.merge(P.lathe([(r1 + 0.45, h - 12.0), (r1 + 0.45, h + 0.02)], SG, 'far:soot'))
        for zf in (0.5, 0.86):
            z = h * zf
            rr = r0 + (r1 - r0) * zf
            g.merge(P.ring(rr + 2.0, rr - 0.05, 0.4, SG, bevel=0.0, mat='far:fdark', z0=z))
            g.merge(P.ring(rr + 2.05, rr + 1.9, 1.1, SG, bevel=0.0, mat='far:frame', z0=z + 0.4))
        g.merge(beacon(r1 * 0.7, 0, h + 2.2, max(1.0, r1 * 0.22)))
        g.merge(beacon(-(r0 + (r1 - r0) * 0.5) - 1.0, 0, h * 0.5 + 1.8, 0.9))
    elif style == 'steel':
        r1 = r0 * 0.92
        prof = [(0.0, 0.0), (r0 + 1.2, 0.0), (r0 + 1.2, 3.0), (r0, 4.0), (r1, h), (r1 + 0.3, h), (r1 + 0.3, h + 1.0), (r1 - 0.2, h + 1.0),
                (r1 - 0.2, h - 2.0)]
        g.merge(P.lathe(prof, SG, 'far:steel'))
        _rings(g, lambda z: r0 + (r1 - r0) * z / h, 6.0, h - 2.0, r.uniform(12.0, 16.0), 0.6, 0.25, 'far:rust', SG)
        for zf in (0.3, 0.55, 0.8, 0.97):
            z = h * zf
            rr = r0 + (r1 - r0) * zf
            _platform(g, rr, rr + 2.2, z, 1.0, SG)
        # (r4) no guy wires (sub-pixel, dotted); a heavy base ring instead
        g.merge(P.ring(r0 + 3.0, r0 + 1.0, 3.0, SG, bevel=0.0, mat='far', z0=0.0))
        g.merge(P.lathe([(r1 + 0.32, h - 8.0), (r1 + 0.32, h + 0.02)], SG, 'far:soot'))
        g.merge(beacon(r1 * 0.6, 0, h + 1.8, 1.0))
    else:   # 'twin': two flues inside a braced 4-leg lattice tower
        rf = r0 * 0.42
        tw = r0 * 1.15
        for sx in (-1, 1):
            g.merge(P.lathe([(0.0, 0.0), (rf, 0.0), (rf, h + 6.0), (rf * 0.8, h + 6.0), (rf * 0.8, h + 4.0), (0.0, h + 4.0)], 12,
                            'far:steel').move(sx * rf * 1.25, 0, 0))
            g.merge(P.lathe([(rf + 0.25, h - 4.0), (rf + 0.25, h + 6.02)], 12, 'far:soot').move(sx * rf * 1.25, 0, 0))
        for sx in (-1, 1):
            for sy in (-1, 1):
                g.merge(beam((sx * tw * 1.5, sy * tw * 1.5, 0.0), (sx * tw, sy * tw, h), 1.0, 1.0, 'far:frame'))
        nb = int(h / 22)
        for i in range(nb):
            z0, z1 = h * i / nb, h * (i + 1) / nb
            t0, t1 = 1.5 - 0.5 * (i / nb), 1.5 - 0.5 * ((i + 1) / nb)
            a0, a1 = tw * t0, tw * t1
            for k in range(4):
                c0 = [(-1, -1), (1, -1), (1, 1), (-1, 1)][k]
                c1 = [(-1, -1), (1, -1), (1, 1), (-1, 1)][(k + 1) % 4]
                g.merge(xbrace(V((c0[0] * a0, c0[1] * a0, z0)), V((c1[0] * a0, c1[1] * a0, z0)), V((c1[0] * a1, c1[1] * a1, z1)),
                               V((c0[0] * a1, c0[1] * a1, z1)), 0.45, 'far:frame'))
            g.merge(bxz(2 * a1 + 1.0, 2 * a1 + 1.0, 0.5, 0, 0, z1 - 0.5, mat='far:fdark'))
        g.merge(beacon(tw, tw, h + 1.0, 1.0))
        g.merge(beacon(-tw, -tw, h * 0.5, 0.9))
    return g


# ============================================================================ FAR WORKS (blocks)
def works_far(seed, sx, sy, h):
    """Silhouette-led far industrial block (front = -Y): a long hall with a sawtooth or monitor
    roof, a taller plant tower on one end with a stepped head house, 2-3 trim bands, downpipes,
    window rows aligned in strips with every other bay lit (50 %), a conveyor gallery from the
    hall roof to a transfer tower, rooftop vents and a stack or two."""
    r = random.Random(seed)
    g = Geo()
    hall_h = h * r.uniform(0.32, 0.45)
    tw = sx * r.uniform(0.26, 0.36)
    tx = r.choice((-1, 1)) * (sx / 2 - tw / 2)
    hx0, hx1 = (-sx / 2, tx - tw / 2) if tx > 0 else (tx + tw / 2, sx / 2)
    hl = hx1 - hx0
    hcx = (hx0 + hx1) / 2
    wall = r.choice(('far', 'far:pale', 'far:steel', 'far:oxide'))
    # hall body + plinth band
    g.merge(bxz(hl, sy, hall_h, hcx, 0, 0.0, mat=wall))
    g.merge(bxz(hl + 0.6, sy + 0.6, 4.0, hcx, 0, 0.0, mat='far:dark'))
    roof = r.choice(('saw', 'saw', 'monitor'))
    if roof == 'saw':
        n = max(3, int(hl / 12.0))
        tooth = hl / n
        th = r.uniform(4.0, 6.0)
        for k in range(n):
            x0 = hx0 + k * tooth
            # steep glazed north face (toward +Y) + sloping solid back
            v = [V((x0, -sy / 2, hall_h)), V((x0 + tooth, -sy / 2, hall_h)), V((x0 + tooth, sy / 2, hall_h)), V((x0, sy / 2, hall_h)),
                 V((x0 + tooth * 0.82, -sy / 2, hall_h + th)), V((x0 + tooth * 0.82, sy / 2, hall_h + th))]
            gg = Geo.from_pydata([tuple(p) for p in v], [(0, 4, 5, 3), (4, 1, 2, 5), (0, 1, 4), (3, 5, 2)], 'far:fdark')
            g.merge(gg)
            g.merge(bxz(tooth * 0.16, sy - 1.0, th * 0.55, x0 + tooth * 0.9, 0, hall_h + th * 0.2, mat='far:soot'))  # glazing (dark)
    else:
        g.merge(bxz(hl + 1.0, sy + 1.0, 0.8, hcx, 0, hall_h, mat='far:fdark'))
        g.merge(bxz(hl * 0.85, sy * 0.3, 5.0, hcx, 0, hall_h + 0.8, mat=wall))
        g.merge(bxz(hl * 0.85, sy * 0.3 + 0.3, 1.6, hcx, 0, hall_h + 2.6, mat='far:soot'))
        g.merge(bxz(hl * 0.85 + 1.0, sy * 0.3 + 1.6, 0.6, hcx, 0, hall_h + 5.8, mat='far:fdark'))
    # trim bands (2-3) + aligned window strips on the hall front
    nb = r.randint(2, 3)
    for k in range(nb):
        z = hall_h * (k + 1) / (nb + 1)
        g.merge(bxz(hl + 0.8, 1.0, 0.9, hcx, -sy / 2 - 0.4, z, mat='far:dark'))
        if k == nb - 1:
            g.merge(bxz(hl - 2.0, 0.4, 2.6, hcx, -sy / 2 - 0.1, z + 1.4, mat='far:soot'))
            bay = r.uniform(7.0, 10.0)
            nbay = max(2, int((hl - 2.0) / bay))
            ph = r.randint(0, 1)
            for i in range(nbay):
                if (i + ph) % 2 == 0:
                    x = hx0 + 1.0 + (i + 0.5) * (hl - 2.0) / nbay
                    g.merge(bxz((hl - 2.0) / nbay * 0.7, 0.45, 1.5, x, -sy / 2 - 0.15, z + 1.9, mat='glow:window'))
    # downpipes every ~12 m + pilasters
    for i in range(int(hl / 12.0) + 1):
        x = hx0 + i * hl / max(1, int(hl / 12.0))
        g.merge(bxz(0.8, 0.8, hall_h, x, -sy / 2 - 0.5, 0.0, mat='far:dark'))
        g.merge(bxz(0.35, 0.35, hall_h - 1.0, x + 1.4, -sy / 2 - 0.8, 0.0, mat='far:fdark'))
    # plant tower + stepped head house + louvre bands + aligned lit rows
    tdp = sy * r.uniform(0.7, 1.0)
    g.merge(bxz(tw, tdp, h * 0.8, tx, 0, 0.0, mat='far:pale' if wall != 'far:pale' else 'far'))
    g.merge(bxz(tw + 1.0, tdp + 1.0, 1.0, tx, 0, h * 0.8, mat='far:fdark'))
    g.merge(bxz(tw * 0.6, tdp * 0.6, h * 0.2, tx + tw * 0.12, 0, h * 0.8 + 1.0, mat='far:steel'))
    g.merge(bxz(tw * 0.6 + 0.8, tdp * 0.6 + 0.8, 0.8, tx + tw * 0.12, 0, h + 1.0, mat='far:fdark'))
    fl = r.uniform(5.0, 6.0)
    nfl = int(h * 0.8 / fl)
    lit_rows = set(r.sample(range(1, max(2, nfl)), min(max(1, nfl - 1), r.randint(1, 3))))
    for f in range(1, nfl):
        z = f * fl
        g.merge(bxz(tw + 0.4, 0.5, 0.5, tx, -tdp / 2 - 0.2, z, mat='far:dark'))
        if f % 3 == 0:
            g.merge(bxz(tw - 1.0, 0.3, 1.6, tx, -tdp / 2 - 0.1, z + 1.4, mat='far:soot'))     # louvre band
        if f in lit_rows:
            nb2 = max(2, int(tw / 4.5))
            for i in range(nb2):
                if i % 2 == f % 2:
                    x = tx - tw / 2 + (i + 0.5) * tw / nb2
                    g.merge(bxz(tw / nb2 * 0.6, 0.4, 1.4, x, -tdp / 2 - 0.15, z + 1.6, mat='glow:window'))
    # (r4) structural bays on the tower: pilasters every ~6 m on the front and both ends, and
    # pilasters on the hall's end walls (3 detail frequencies: bays / bands+louvres / pipes+stairs)
    npil = max(2, int(tw / 6.0))
    for i in range(npil + 1):
        x = tx - tw / 2 + i * tw / npil
        g.merge(bxz(0.7, 0.6, h * 0.8, x, -tdp / 2 - 0.3, 0.0, mat='far:dark'))
    for sx2 in (-1, 1):
        nd = max(2, int(tdp / 6.0))
        for i in range(nd + 1):
            y = -tdp / 2 + i * tdp / nd
            g.merge(bxz(0.6, 0.7, h * 0.8, tx + sx2 * (tw / 2 + 0.3), y, 0.0, mat='far:dark'))
        ne = max(2, int(sy / 7.0))
        for i in range(1, ne):
            y = -sy / 2 + i * sy / ne
            xe = (hx0 if sx2 < 0 else hx1)
            g.merge(bxz(0.6, 0.7, hall_h, xe + sx2 * 0.3, y, 0.0, mat='far:dark'))
    for k in range(2):                                                               # pipe runs up the end wall
        y = -tdp / 4 + k * 1.8
        xe = tx + (tw / 2 + 1.2) * (1 if tx < 0 else -1) * -1
        g.merge(bxz(0.9, 0.9, h * 0.8 - 2.0, xe, y, 0.0, mat='far:rust' if k == 0 else 'far:steel'))
    # risers up the tower face + an external lattice stair tower on its outer end
    for k in range(2):
        x = tx - tw * 0.3 + k * 2.4
        g.merge(bxz(1.1, 1.1, h * 0.8 + 3.0, x, -tdp / 2 - 1.2, 0.0, mat='far:rust' if k == 0 else 'far:frame'))
    sx_ = tx + (tw / 2 + 3.5) * (1 if tx > 0 else -1)
    for c in ((-2.5, -2.5), (2.5, -2.5), (2.5, 2.5), (-2.5, 2.5)):
        g.merge(bxz(0.6, 0.6, h * 0.75, sx_ + c[0], c[1], 0.0, mat='far:frame'))
    for k in range(int(h * 0.75 / 9.0)):
        z0 = k * 9.0
        g.merge(xbrace(V((sx_ - 2.5, -2.5, z0)), V((sx_ + 2.5, -2.5, z0)), V((sx_ + 2.5, -2.5, z0 + 9.0)), V((sx_ - 2.5, -2.5, z0 + 9.0)), 0.3, 'far:frame'))
        g.merge(bxz(5.6, 5.6, 0.4, sx_, 0, z0 + 9.0, mat='far:fdark'))
    # conveyor gallery from the transfer tower to the hall roof
    gx = hcx + (hl * 0.3 if tx < 0 else -hl * 0.3)
    ttx = gx + (-1 if tx > 0 else 1) * 0.0
    tty = -sy / 2 - 26.0
    th_ = hall_h + r.uniform(12.0, 22.0)
    g.merge(bxz(9.0, 9.0, th_, ttx, tty, 0.0, mat='far:steel'))
    g.merge(bxz(10.0, 10.0, 0.8, ttx, tty, th_, mat='far:fdark'))
    for k in range(int(th_ / 8)):
        g.merge(bxz(9.6, 0.4, 0.6, ttx, tty - 4.7, (k + 1) * 8.0, mat='far:dark'))
    a, b = V((ttx, tty + 4.5, th_ - 5.6)), V((gx + 6, -sy / 2 + 4.0, hall_h + 0.4))
    _gallery(g, a, b, 3.6, 3.2, member=0.4, bay=6.0)
    for t in (0.33, 0.66):                                                          # portal bents
        m_ = a + (b - a) * t
        for sx_ in (-1, 1):
            g.merge(bxz(0.7, 0.7, m_.z, m_.x + sx_ * 2.2, m_.y, 0.0, mat='far:frame'))
        g.merge(bxz(5.2, 0.8, 0.8, m_.x, m_.y, m_.z - 0.8, mat='far:frame'))
    # rooftop vents / boxes in rows (aligned, not scattered) + 1-2 stacks
    nv = max(2, int(hl / 16))
    for k in range(nv):
        x = hx0 + (k + 0.5) * hl / nv
        if r.random() < 0.6:
            g.merge(P.cylinder(r.uniform(0.8, 1.4), r.uniform(4, 8), 8, bevel=0.0, mat='far:steel', z0=hall_h + 0.5).move(x, sy * 0.25, 0))
        else:
            g.merge(bxz(r.uniform(4, 7), r.uniform(3, 5), r.uniform(2.5, 4.5), x, sy * 0.25, hall_h + 0.5, mat='far:dark'))
    for k in range(r.randint(1, 2)):
        rs = r.uniform(1.8, 3.2)
        hs = r.uniform(40, 80)
        x, y = tx + r.uniform(-tw / 4, tw / 4), r.uniform(-tdp / 4, tdp / 4)
        g.merge(P.lathe([(0.0, 0.0), (rs * 1.3, 0.0), (rs, hs), (rs * 0.8, hs), (0.0, hs - 1)], 10, 'far:shell').move(x, y, h * 0.8 + 1.0))
        g.merge(P.ring(rs * 1.08, rs * 0.8, 3.0, 10, bevel=0.0, mat='far:soot', z0=h * 0.8 + hs - 2.0).move(x, y, 0))
        if hs > 55:
            g.merge(beacon(x + rs * 0.6, y, h * 0.8 + hs + 2.4, 1.0))
    g.merge(beacon(tx, -tdp / 2 + 1.0, h + 2.4, 1.2))
    return g


# ============================================================================ FAR DISTRICTS (r4)
# Hinterland clusters for 0.5-3 km (WORLD r4 S: "the outer land is a flat plane with far kit floating
# on it"): rail yards, shed rows, tank farms and crane runways at >= 1 cluster per ~150-250 m of
# horizon. Low-poly (0.6-1.4k tris), silhouette-led, 'far' material classes only; the runtime
# terrain lays a concrete apron + soot band under each one.
def _pitched(g, L, W, z, rise, mat, x=0.0, y=0.0):
    """Gable roof along X (two slabs) on a wall top at z."""
    for sy in (-1, 1):
        rf = bx(L + 1.0, W / 2 + 0.8, 0.5, (0, 0, 0), mat=mat)
        rf.transform(Matrix.Translation(V((x, y + sy * W / 4, z + rise / 2))) @ Matrix.Rotation(sy * math.atan2(rise, W / 2), 4, 'X'))
        g.merge(rf)


def district_railyard(seed=1, L=150.0):
    """Marshalling yard: ballast bed with 5 tracks, wagon strings, a signal gantry, yard office,
    lamp masts."""
    r = random.Random(seed)
    g = Geo()
    nt, gap = 5, 4.6
    W = nt * gap + 6.0
    g.merge(bxz(L, W, 0.6, 0, 0, 0.0, mat='far:soot'))                               # ballast bed
    for t in range(nt):
        y = -W / 2 + 3.0 + (t + 0.5) * gap
        g.merge(bxz(L, 2.2, 0.25, 0, y, 0.6, mat='far:fdark'))                        # sleepers / rails
        if r.random() < 0.75:                                                         # wagon string
            n = r.randint(4, 9)
            x = -L / 2 + r.uniform(4, L * 0.35)
            kind = r.choice(('hopper', 'box', 'flat', 'tank'))
            for k in range(n):
                if x > L / 2 - 14:
                    break
                mat = r.choice(('far:rust', 'far:oxide', 'far:sdark', 'far:rust'))
                if kind == 'tank':
                    g.merge(tube((x, y, 2.8), (x + 12.5, y, 2.8), 1.5, mat, 8))
                    g.merge(bxz(12.8, 2.6, 0.9, x + 6.25, y, 0.85, mat='far:fdark'))
                elif kind == 'flat':
                    g.merge(bxz(13.0, 2.8, 1.0, x + 6.5, y, 0.85, mat='far:fdark'))
                    if r.random() < 0.6:
                        g.merge(bxz(9.0, 2.4, 2.4, x + 6.5, y, 1.85, mat=r.choice(('far:steel', 'far:oxide', 'far:pale'))))
                else:
                    hh = 3.6 if kind == 'hopper' else 4.0
                    g.merge(bxz(13.0, 3.0, hh, x + 6.5, y, 0.85, mat=mat))
                    g.merge(bxz(13.2, 3.1, 0.35, x + 6.5, y, 0.85 + hh - 0.35, mat='far:fdark'))
                x += 14.0
    # signal gantry across the tracks + yard office + lamp masts
    gx = -L / 2 + r.uniform(18, 40)
    for sy in (-1, 1):
        g.merge(bxz(0.8, 0.8, 9.0, gx, sy * (W / 2 - 0.5), 0.0, mat='far:frame'))
    g.merge(bxz(1.0, W, 1.2, gx, 0, 8.4, mat='far:frame'))
    ox = L / 2 - 8.0
    g.merge(bxz(12.0, 9.0, 6.5, ox, W / 2 + 7.0, 0.0, mat=r.choice(('far:pale', 'far'))))
    g.merge(bxz(12.6, 9.6, 0.6, ox, W / 2 + 7.0, 6.5, mat='far:fdark'))
    g.merge(bxz(9.0, 0.3, 1.4, ox, W / 2 + 2.4, 3.6, mat='far:soot'))
    g.merge(bxz(4.0, 0.3, 1.2, ox - 2.0, W / 2 + 2.3, 3.7, mat='glow:window'))
    for k in range(3):
        x = -L / 2 + (k + 0.5) * L / 3
        g.merge(bxz(0.5, 0.5, 18.0, x, -W / 2 - 2.0, 0.0, mat='far:fdark'))
        g.merge(bxz(2.0, 1.4, 0.8, x, -W / 2 - 2.0, 18.0, mat='glow:sodium'))
    return g


def district_sheds(seed=2):
    """Row of 2-3 clad sheds (20-60 m) with gable or sawtooth roofs, pilasters, roller doors, a
    lean-to, roof vents and a small boiler stack."""
    r = random.Random(seed)
    g = Geo()
    x = 0.0
    n = r.randint(2, 3)
    for k in range(n):
        L = r.uniform(26, 58)
        W = r.uniform(18, 28)
        H = r.uniform(11, 19)
        cx = x + L / 2
        wall = r.choice(('far:steel', 'far:pale', 'far:oxide', 'far'))
        g.merge(bxz(L, W, H, cx, 0, 0.0, mat=wall))
        g.merge(bxz(L + 0.4, W + 0.4, 2.2, cx, 0, 0.0, mat='far:dark'))                 # dado
        if r.random() < 0.6:
            _pitched(g, L, W, H, W * 0.18, 'far:sdark', x=cx)
        else:
            nt = max(2, int(L / 10))
            for t in range(nt):
                x0 = cx - L / 2 + t * L / nt
                v = [V((x0, -W / 2, H)), V((x0 + L / nt, -W / 2, H)), V((x0 + L / nt, W / 2, H)), V((x0, W / 2, H)),
                     V((x0 + L / nt * 0.8, -W / 2, H + 4.0)), V((x0 + L / nt * 0.8, W / 2, H + 4.0))]
                g.merge(Geo.from_pydata([tuple(p) for p in v], [(0, 4, 5, 3), (4, 1, 2, 5), (0, 1, 4), (3, 5, 2)], 'far:sdark'))
        for i in range(int(L / 6.5) + 1):                                              # pilasters
            px = cx - L / 2 + i * L / max(1, int(L / 6.5))
            g.merge(bxz(0.6, 0.5, H, px, -W / 2 - 0.25, 0.0, mat='far:fdark'))
        g.merge(bxz(L + 0.6, 0.6, 0.6, cx, -W / 2 - 0.3, H - 0.6, mat='far:fdark'))     # eaves / gutter
        g.merge(bxz(L * 0.8, 0.3, 1.4, cx, -W / 2 - 0.1, H * 0.7, mat='far:soot'))        # window band
        nd = max(1, int(L / 22))
        for d in range(nd):
            dx = cx - L / 2 + (d + 0.5) * L / nd
            g.merge(bxz(5.5, 0.4, 6.0, dx, -W / 2 - 0.2, 0.0, mat=r.choice(('far:sdark', 'far:rust', 'far:dark'))))
            if r.random() < 0.35:
                g.merge(bxz(4.6, 0.45, 2.0, dx, -W / 2 - 0.25, 0.0, mat='glow:dim'))
        if r.random() < 0.6:                                                          # lean-to
            g.merge(bxz(L * 0.5, 7.0, H * 0.5, cx + r.uniform(-L / 5, L / 5), W / 2 + 3.5, 0.0, mat='far:dark'))
        for v_ in range(max(1, int(L / 14))):                                         # roof vents
            vx = cx - L / 2 + (v_ + 0.5) * L / max(1, int(L / 14))
            g.merge(P.cylinder(0.9, 2.2, 8, bevel=0.0, mat='far:frame', z0=H + 0.4).move(vx, W * 0.2, 0))
        x += L + r.uniform(5, 12)
    sx = r.uniform(0.2, 0.8) * x
    hs = r.uniform(28, 46)
    g.merge(P.lathe([(0.0, 0.0), (2.0, 0.0), (1.4, hs), (1.2, hs), (0.0, hs - 1)], 10, 'far:shell').move(sx, r.choice((-1, 1)) * 14.0, 0))
    g.merge(P.ring(1.5, 1.1, 2.5, 10, bevel=0.0, mat='far:soot', z0=hs - 2.4).move(sx, 0, 0).move(0, 0, 0))
    g.move(-x / 2, 0, 0)
    return g


def district_tanks(seed=3):
    """Tank farm: 3-5 tanks behind a bund wall, a pipe rack along the front, pump house."""
    r = random.Random(seed)
    g = Geo()
    W, D = r.uniform(90, 130), r.uniform(60, 80)
    for (sx, sy, l, a) in ((0, -D / 2, W, 0), (0, D / 2, W, 0), (-W / 2, 0, D, 1), (W / 2, 0, D, 1)):
        g.merge(bxz(l if a == 0 else 1.2, 1.2 if a == 0 else l, 2.6, sx, sy, 0.0, mat='far'))
    n = r.randint(3, 5)
    for k in range(n):
        rr = r.uniform(9, 16)
        hh = r.uniform(12, 22)
        x = -W / 2 + (k + 0.5) * W / n + r.uniform(-3, 3)
        y = r.uniform(-D / 6, D / 6)
        rr = min(rr, W / n / 2 - 1.5)
        mat = r.choice(('far:shell', 'far:pale', 'far:steel', 'far:shell'))
        g.merge(P.lathe([(0.0, 0.0), (rr, 0.0), (rr, hh), (rr * 0.6, hh + rr * 0.18), (0.0, hh + rr * 0.22)], 16, mat).move(x, y, 0))
        g.merge(P.ring(rr + 0.15, rr - 0.05, 0.8, 16, bevel=0.0, mat='far:fdark', z0=hh * 0.5).move(x, y, 0))
        g.merge(P.lathe([(rr + 0.2, hh - 3.0), (rr + 0.2, hh + 0.02)], 16, 'far:soot').move(x, y, 0))
        g.merge(beam((x + rr * 0.7, y - rr * 0.7, 0.0), (x + rr * 0.7, y - rr * 0.7 + 3.0, hh), 0.5, 0.5, 'far:frame'))   # stair stringer
    yp = -D / 2 - 6.0
    for i in range(int(W / 10) + 1):                                                  # pipe rack
        x = -W / 2 + i * 10.0
        g.merge(bxz(0.6, 0.6, 7.0, x, yp - 2.0, 0.0, mat='far:frame'))
        g.merge(bxz(0.6, 0.6, 7.0, x, yp + 2.0, 0.0, mat='far:frame'))
        g.merge(bxz(0.6, 4.6, 0.6, x, yp, 6.4, mat='far:frame'))
    for k, (dy, rr) in enumerate(((-1.2, 0.6), (0.2, 0.45), (1.4, 0.7))):
        g.merge(tube((-W / 2 - 2, yp + dy, 7.0 + rr), (W / 2 + 2, yp + dy, 7.0 + rr), rr, ('far:rust', 'far:steel', 'far:sdark')[k], 8))
    g.merge(bxz(14.0, 9.0, 7.0, W / 2 + 10.0, yp, 0.0, mat='far:oxide'))
    g.merge(bxz(14.6, 9.6, 0.6, W / 2 + 10.0, yp, 7.0, mat='far:fdark'))
    g.merge(beacon(0, 0, 0, 1.0).move(W / 2 + 14.0, yp, 8.0))
    return g


def district_runway(seed=4):
    """Stockyard crane runway: two rows of portal columns, runway girders, a gantry bridge with a
    trolley house, a stockpile beneath (ore / coal) and a conveyor stub."""
    r = random.Random(seed)
    g = Geo()
    L, S, H = r.uniform(110, 160), r.uniform(34, 44), r.uniform(20, 28)
    n = int(L / 16)
    for i in range(n + 1):
        x = -L / 2 + i * L / n
        for sy in (-1, 1):
            g.merge(bxz(1.2, 1.4, H, x, sy * S / 2, 0.0, mat='far:frame'))
        if i % 2 == 0:
            for sy in (-1, 1):
                g.merge(beam((x, sy * S / 2, H * 0.55), (x + L / n, sy * S / 2, H - 1.0), 0.45, 0.45, 'far:frame'))
    for sy in (-1, 1):
        g.merge(bxz(L + 2.0, 1.6, 2.0, 0, sy * S / 2, H, mat='far:dark'))
    bxp = r.uniform(-L / 3, L / 3)
    g.merge(bxz(5.0, S + 6.0, 3.6, bxp, 0, H + 2.0, mat='far:rust'))                  # gantry bridge
    g.merge(bxz(7.0, 7.0, 5.0, bxp, r.uniform(-S / 4, S / 4), H + 5.6, mat='far:pale'))
    g.merge(bxz(1.0, 1.0, H, bxp, 0, 2.0, mat='far:fdark'))                          # grab rope / bucket
    kind = r.choice(('ore', 'coal', 'slag'))
    hm = {'ore': 'far:oxide', 'coal': 'far:soot', 'slag': 'far:sdark'}[kind]
    for k in range(2):                                                                # elongated stockpiles
        cx = -L / 4 + k * L / 2 + r.uniform(-8, 8)
        hp = P.lathe([(0.0, H * 0.55), (S * 0.18, H * 0.5), (S * 0.32, H * 0.28), (S * 0.42, 0.0)], 12, hm)
        hp.transform(Matrix.Translation(V((cx, 0, 0))) @ Matrix.Diagonal((L / (S * 1.3) * 0.5, 1.0, 1.0, 1.0)))
        g.merge(hp)
    # conveyor stub to a transfer house (lattice gallery with a roof, not a plain beam)
    a, b = V((L / 2 - 4, 0, 4.0)), V((L / 2 + 34, 0, H * 0.9))
    _truss2(g, a, b, 3.2, 3.0, 8, 0.4, 0.25)
    g.merge(beam(a + V((0, 0, 1.9)), b + V((0, 0, 1.9)), 3.6, 0.35, 'far:sdark'))
    g.merge(bxz(9.0, 9.0, H * 0.9 + 4.0, L / 2 + 38.0, 0, 0.0, mat='far:steel'))
    g.merge(bxz(9.6, 9.6, 0.6, L / 2 + 38.0, 0, H * 0.9 + 4.0, mat='far:fdark'))
    return g


# ============================================================================ FAR FURNACE PARTS (r4)
def furnace_far_parts(h=300.0, seed=7):
    """furnace_far() split into parts sharing one origin, recombined per instance (r4: no identical
    horizon furnaces in one frame): core (shell, bands, bustle, platforms, tower, top house, uptakes,
    beacons), dcA (curved downcomer + dust catcher at -X), dcB (straight header + inclined drop to a
    catcher at +Y with a cyclone), st4 / st3 (cowper rows + hot-blast main), cast (casthouse, own
    origin at its centre so it can be turned 90 deg), skip (lattice incline + stock-house)."""
    r = random.Random(seed)
    s = h / 100.0
    SG = 24
    out = {}
    g = Geo()
    prof = [(0.0, 0.0), (9.5 * s, 0.0), (9.5 * s, 12 * s), (11 * s, 17 * s), (11 * s, 20 * s), (7.6 * s, 46 * s), (6.4 * s, 50 * s),
            (4.2 * s, 55 * s), (3.2 * s, 58 * s), (0.0, 58 * s)]
    g.merge(P.lathe(prof, SG, 'far:sdark'))

    def shell_r(z):
        zz = z / s
        if zz < 12:
            return 9.5 * s
        if zz < 17:
            return (9.5 + 1.5 * (zz - 12) / 5) * s
        if zz < 20:
            return 11 * s
        if zz < 46:
            return (11 - 3.4 * (zz - 20) / 26) * s
        return (7.6 - 1.2 * (zz - 46) / 4) * s
    _rings(g, shell_r, 3 * s, 11.5 * s, 5.0 * s, 0.7 * s, 0.25 * s, 'far:rust', SG)
    _rings(g, shell_r, 24 * s, 45 * s, 9.0 * s, 0.5 * s, 0.22 * s, 'far:steel', SG)
    g.merge(P.torus(13.5 * s, 1.4 * s, SG, 6, mat='far:rust').move(0, 0, 19.5 * s))
    for i in range(8):
        a = TAU * i / 8
        c, si = math.cos(a), math.sin(a)
        g.merge(beam((c * 13.2 * s, si * 13.2 * s, 18.6 * s), (c * 9.8 * s, si * 9.8 * s, 14 * s), 0.7 * s, 0.7 * s, 'far:fdark'))
    _platform(g, shell_r(26 * s), shell_r(26 * s) + 4.5 * s, 26 * s, s, SG)
    _platform(g, shell_r(40 * s), shell_r(40 * s) + 4.0 * s, 40 * s, s, SG, deck=False)
    cw = 17 * s
    zs = [0.0, 14.0, 26.0, 38.0, 50.0, 62.0, 72.0]
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bxz(2.4 * s, 2.4 * s, 74 * s, sx * cw, sy * cw, 0.0, mat='far:frame'))
            g.merge(bxz(4.0 * s, 4.0 * s, 2.0 * s, sx * cw, sy * cw, 0.0, mat='far'))
    for z in zs[1:]:
        zz = z * s
        for k in range(4):
            a = k * math.pi / 2
            c, si = round(math.cos(a)), round(math.sin(a))
            L = 2 * cw + 3 * s
            g.merge(bxz(L if c == 0 else 1.6 * s, L if si == 0 else 1.6 * s, 1.3 * s, c * cw, si * cw, zz - 1.3 * s, mat='far:fdark'))
    for i in range(len(zs) - 1):
        z0, z1 = zs[i] * s + 1.0 * s, zs[i + 1] * s - 1.3 * s
        m = 0.7 * s
        for sx in (-1, 1):
            x = sx * cw
            g.merge(xbrace(V((x, -cw, z0)), V((x, cw, z0)), V((x, cw, z1)), V((x, -cw, z1)), m, 'far:frame'))
        for sy in (-1, 1):
            y = sy * cw
            if sy < 0 and i == 0:
                continue
            g.merge(xbrace(V((-cw, y, z0)), V((cw, y, z0)), V((cw, y, z1)), V((-cw, y, z1)), m, 'far:frame'))
    _cage(g, cw + 1.6 * s, -cw + 3 * s, 0.0, 72 * s, s, facing=-math.pi / 2)
    g.merge(bxz(16 * s, 14 * s, 9 * s, 0, 0, 72 * s, mat='far:oxide'))
    g.merge(bxz(16.8 * s, 14.8 * s, 0.8 * s, 0, 0, 81 * s, mat='far:fdark'))
    for sy in (-1, 1):
        g.merge(bxz(15 * s, 0.3 * s, 1.6 * s, 0, sy * 7.05 * s, 76 * s, mat='far:soot'))
    g.merge(bxz(7 * s, 6 * s, 5 * s, -3 * s, 2 * s, 81.8 * s, mat='far:steel'))
    hub = V((-2.0 * s, 0.0, 92 * s))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        p0 = V((math.cos(a) * 3.5 * s, math.sin(a) * 3.5 * s, 58 * s))
        p1 = V((math.cos(a) * 4.6 * s, math.sin(a) * 4.6 * s, 88 * s))
        g.merge(tube(p0, p1, 1.3 * s, 'far:sdark', 8))
        g.merge(tube(p1, hub, 1.1 * s, 'far:sdark', 8))
        g.merge(tube(p1, p1 + V((0, 0, 9 * s)), 0.8 * s, 'far:fdark', 8))
        g.merge(P.cylinder(1.4 * s, 0.8 * s, 8, bevel=0.0, mat='far:fdark').move(p1 + V((0, 0, 9.2 * s))))
    for z in (26, 50, 72):
        g.merge(beacon(cw, -cw, z * s + 1.6, 1.2))
    g.merge(beacon(0, 0, 92 * s + 2.0, 1.6))
    out['core'] = g
    # --- dcA
    d = Geo()
    dcx = -38 * s
    d.merge(P.sweep([hub, V((-12 * s, 0, 90 * s)), V((-24 * s, 0, 78 * s)), V((dcx + 3 * s, 0, 40 * s))], 2.1 * s, 10,
                    mat='far:sdark', smooth_path=True, subdiv=4))
    d.merge(P.lathe([(0.0, 14 * s), (2.2 * s, 14 * s), (8 * s, 22 * s), (8 * s, 35 * s), (5.5 * s, 39 * s), (0.0, 40 * s)], 16, 'far:steel').move(dcx, 0, 0))
    _rings(d, lambda z: 8 * s, 24 * s, 35 * s, 7.0 * s, 0.5 * s, 0.2 * s, 'far:rust', 16)
    for sx in (-1, 1):
        for sy in (-1, 1):
            d.merge(bxz(1.2 * s, 1.2 * s, 22 * s, dcx + sx * 5.6 * s, sy * 5.6 * s, 0.0, mat='far:frame'))
        d.merge(beam((dcx + sx * 5.6 * s, -5.6 * s, 2 * s), (dcx + sx * 5.6 * s, 5.6 * s, 13 * s), 0.5 * s, 0.5 * s, 'far:frame'))
    d.merge(tube((dcx, 0, 18 * s), (dcx, 26 * s, 18 * s), 1.7 * s, 'far:sdark', 8))
    d.merge(tube((dcx, 26 * s, 18 * s), (dcx, 26 * s, 0.0), 1.7 * s, 'far:sdark', 8))
    out['dcA'] = d
    # --- dcB: straight header over the top, a straight inclined drop to a tall catcher at -X/+Y diagonal,
    # cyclone and a horizontal gas main
    d = Geo()
    hdr = V((-14 * s, 14 * s, 94 * s))
    d.merge(tube(hub, hdr, 2.0 * s, 'far:sdark', 8))
    d.merge(bx(4.6 * s, 4.6 * s, 4.6 * s, tuple(hdr), mat='far:fdark'))
    cpos = V((-34 * s, 30 * s, 0.0))
    ctop = cpos + V((0, 0, 44 * s))
    d.merge(tube(hdr, ctop + V((2 * s, -2 * s, 0)), 2.0 * s, 'far:sdark', 8))
    d.merge(P.lathe([(0.0, 16 * s), (2.4 * s, 16 * s), (7 * s, 24 * s), (7 * s, 41 * s), (4.4 * s, 45 * s), (0.0, 46 * s)], 16, 'far:steel').move(cpos.x, cpos.y, 0))
    _rings(d, lambda z: 7 * s, 26 * s, 40 * s, 5.0 * s, 0.5 * s, 0.2 * s, 'far:rust', 16)
    for sx in (-1, 1):
        for sy in (-1, 1):
            d.merge(bxz(1.2 * s, 1.2 * s, 24 * s, cpos.x + sx * 5.0 * s, cpos.y + sy * 5.0 * s, 0.0, mat='far:frame'))
    d.merge(P.lathe([(0.0, 10 * s), (1.2 * s, 10 * s), (4.0 * s, 17 * s), (4.0 * s, 28 * s), (0.0, 30 * s)], 12, 'far:sdark').move(cpos.x - 16 * s, cpos.y + 4 * s, 0))
    for sx in (-1, 1):
        d.merge(bxz(0.9 * s, 0.9 * s, 17 * s, cpos.x - 16 * s + sx * 3.0 * s, cpos.y + 4 * s, 0.0, mat='far:frame'))
    d.merge(tube((cpos.x - 7 * s, cpos.y + 2 * s, 34 * s), (cpos.x - 12 * s, cpos.y + 4 * s, 27 * s), 1.4 * s, 'far:sdark', 8))
    d.merge(tube((cpos.x - 16 * s, cpos.y + 4 * s, 12 * s), (cpos.x - 16 * s, cpos.y + 40 * s, 12 * s), 1.5 * s, 'far:rust', 8))
    d.merge(beacon(cpos.x, cpos.y, 46 * s + 1.5, 1.2))
    out['dcB'] = d
    # --- stoves rows (4 and 3), each with its hot-blast main + branch to the bustle
    for n in (4, 3):
        st = Geo()
        sy0 = 36 * s
        xs = [(k - (n - 1) / 2) * 15 * s for k in range(n)]
        for k, x in enumerate(xs):
            hs = (44 + r.uniform(-3, 4)) * s
            rr = 6.2 * s
            prof = [(0.0, 0.0), (rr + 0.6 * s, 0.0), (rr + 0.6 * s, 1.4 * s), (rr, 1.8 * s), (rr, hs)]
            for i in range(1, 6):
                a = (math.pi / 2) * i / 5
                prof.append((rr * math.cos(a), hs + rr * 0.85 * math.sin(a)))
            prof[-1] = (0.0, hs + rr * 0.85)
            one = Geo()
            one.merge(P.lathe(prof, 14, 'far:steel'))
            _rings(one, lambda z: rr, 6 * s, hs - 1 * s, r.uniform(7.0, 9.0) * s, 0.9 * s, 0.18 * s, 'far:sdark', 14)
            _platform(one, rr, rr + 2.4 * s, hs * 0.45, s, 12, deck=False, nbr=3)
            _platform(one, rr, rr + 2.2 * s, hs - 1.5 * s, s, 12, deck=False, nbr=3)
            _cage(one, 0.0, -rr - 0.2 * s, 0.0, hs - 1.5 * s, s, hoops=False)
            one.merge(P.cylinder(1.0 * s, 1.0 * s, 8, bevel=0.0, mat='far:fdark', z0=hs + rr * 0.85 - 0.4 * s))
            one.merge(tube((0, -rr + 0.4 * s, 16 * s), (0, -rr - 4 * s, 16 * s), 1.2 * s, 'far:sdark', 8))
            one.merge(bxz(2.6 * s, 2.4 * s, 2.6 * s, 0, -rr - 3.2 * s, 14.8 * s, mat='far:fdark'))
            one.move(x, sy0, 0)
            st.merge(one)
        hb = 16 * s
        st.merge(tube((xs[0] - 6 * s, sy0 - 10.5 * s, hb), (xs[-1] + 6 * s, sy0 - 10.5 * s, hb), 1.7 * s, 'far:rust', 8))
        st.merge(tube((0, sy0 - 10.5 * s, hb), (0, 13.5 * s, 19.5 * s), 1.5 * s, 'far:rust', 8))
        for x in xs + [xs[0] - 6 * s, xs[-1] + 6 * s]:
            st.merge(bxz(1.0 * s, 1.0 * s, hb - 1.6 * s, x, sy0 - 10.5 * s, 0.0, mat='far:frame'))
        out[f'st{n}'] = st
    # --- casthouse (origin at its own centre; default placement offset (0, -30*s))
    c = Geo()
    chx, chy, cw2, cd2, chh = 0.0, 0.0, 50 * s, 30 * s, 18 * s
    fy = chy - cd2 / 2
    c.merge(bxz(cw2 + 0.6 * s, cd2 + 0.6 * s, 5 * s, chx, chy, 0.0, mat='far:pale'))
    c.merge(bxz(cw2, cd2, chh - 5 * s, chx, chy, 5 * s, mat='far:steel'))
    rise = cd2 * 0.12
    for sy in (-1, 1):
        rf = bx(cw2 + 1.0 * s, cd2 / 2 + 0.8 * s, 0.4 * s, (0, 0, 0), mat='far:sdark')
        rf.transform(Matrix.Translation(V((chx, chy + sy * cd2 / 4, chh + rise / 2))) @ Matrix.Rotation(sy * math.atan2(rise, cd2 / 2), 4, 'X'))
        c.merge(rf)
    c.merge(bxz(cw2 * 0.8, cd2 * 0.22, 3.5 * s, chx, chy, chh + rise * 0.8, mat='far:steel'))
    c.merge(bxz(cw2 * 0.8 + 0.2 * s, cd2 * 0.22 + 0.3 * s, 1.4 * s, chx, chy, chh + rise * 0.8 + 1.2 * s, mat='far:soot'))
    c.merge(bxz(cw2 * 0.8 + 1.0 * s, cd2 * 0.22 + 1.2 * s, 0.5 * s, chx, chy, chh + rise * 0.8 + 3.5 * s, mat='far:fdark'))
    for k in range(7):
        x = chx - cw2 * 0.42 + k * cw2 * 0.14
        for sy in (-1, 1):
            z = chh + rise * 0.35
            c.merge(P.cylinder(0.9 * s, 1.4 * s, 8, bevel=0.0, mat='far:frame', z0=z).move(x, chy + sy * cd2 * 0.3, 0))
            c.merge(P.cylinder(1.3 * s, 0.3 * s, 8, bevel=0.0, mat='far:fdark', z0=z + 1.6 * s).move(x, chy + sy * cd2 * 0.3, 0))
    nb = 6
    for k in range(nb + 1):
        x = chx - cw2 / 2 + k * cw2 / nb
        c.merge(bxz(0.9 * s, 0.7 * s, chh, x, fy - 0.3 * s, 0.0, mat='far:fdark'))
    for sx in (-1, 1):
        for k in range(4):
            y = chy - cd2 / 2 + k * cd2 / 3
            c.merge(bxz(0.7 * s, 0.9 * s, chh, chx + sx * (cw2 / 2 + 0.3 * s), y, 0.0, mat='far:fdark'))
    for zb, hb in ((9.5 * s, 1.8 * s), (14.5 * s, 1.4 * s)):
        c.merge(bxz(cw2 - 1.0 * s, 0.4 * s, hb, chx, fy - 0.15 * s, zb, mat='far:soot'))
        for sx in (-1, 1):
            c.merge(bxz(0.4 * s, cd2 - 1.0 * s, hb, chx + sx * (cw2 / 2 + 0.15 * s), chy, zb, mat='far:soot'))
    for k in range(nb):
        x = chx - cw2 / 2 + (k + 0.5) * cw2 / nb + 2.0 * s
        c.merge(bxz(0.35 * s, 0.35 * s, chh - 1.0 * s, x, fy - 0.5 * s, 0.0, mat='far:fdark'))
    c.merge(bxz(30 * s, 6 * s, 4 * s, chx, fy - 3 * s, 8 * s, mat='far:sdark'))
    c.merge(tube((chx - 8 * s, fy - 3 * s, 12 * s), (chx - 8 * s, fy + 4 * s, chh + rise + 4 * s), 1.1 * s, 'far:rust', 8))
    c.merge(tube((chx + 8 * s, fy - 3 * s, 12 * s), (chx + 8 * s, fy + 4 * s, chh + rise + 4 * s), 1.1 * s, 'far:rust', 8))
    for sx, aw_, ah_ in ((-1, 10 * s, 11 * s), (1, 8 * s, 14 * s)):
        ax_ = chx + sx * (cw2 / 2 + aw_ / 2)
        c.merge(bxz(aw_, cd2 * 0.8, ah_, ax_, chy + cd2 * 0.05, 0.0, mat='far:oxide' if sx < 0 else 'far:pale'))
        c.merge(bxz(aw_ + 0.6 * s, cd2 * 0.8 + 0.6 * s, 0.5 * s, ax_, chy + cd2 * 0.05, ah_, mat='far:fdark'))
        c.merge(bxz(aw_ - 1.0 * s, 0.3 * s, 1.2 * s, ax_, chy - cd2 * 0.35 - 0.1 * s, ah_ - 3.5 * s, mat='far:soot'))
    stx = chx - cw2 / 2 - 10 * s - 3 * s
    c.merge(bxz(5 * s, 5 * s, chh + 8 * s, stx, fy + 4 * s, 0.0, mat='far:pale'))
    c.merge(bxz(5.6 * s, 5.6 * s, 0.6 * s, stx, fy + 4 * s, chh + 8 * s, mat='far:fdark'))
    c.merge(bxz(0.3 * s, 1.0 * s, chh + 4 * s, stx, fy + 1.4 * s, 2 * s, mat='far:soot'))
    c.merge(beacon(stx, fy + 4 * s, chh + 9.4 * s, 1.2))
    c.merge(bxz(32 * s, 0.4, 3 * s, chx, fy - 0.4, 1.0, mat='glow:furnace'))
    c.merge(bxz(28 * s, 0.4, 9 * s, chx, fy - 0.35, 1.0, mat='glow:furnace_grad'))
    out['cast'] = c
    # --- skip incline + stock-house (+X)
    k = Geo()
    top = V((10 * s, 0.0, 72 * s))
    foot = V((80 * s, 0.0, 6 * s))
    d_ = foot - top
    _truss2(k, top, foot, 5 * s, 6 * s, 10, 0.8 * s, 0.45 * s)
    for t in (0.38, 0.7):
        p_ = top + d_ * t
        for sy in (-1, 1):
            k.merge(bxz(1.0 * s, 1.0 * s, p_.z - 2.5 * s, p_.x, sy * 3 * s, 0.0, mat='far:frame'))
        k.merge(xbrace(V((p_.x, -3 * s, 2 * s)), V((p_.x, 3 * s, 2 * s)), V((p_.x, 3 * s, p_.z - 4 * s)), V((p_.x, -3 * s, p_.z - 4 * s)), 0.4 * s, 'far:frame'))
    _far_bins(k, foot.x + 8 * s, 0.0, s)
    out['skip'] = k
    return out
