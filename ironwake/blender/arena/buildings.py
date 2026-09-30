"""blender/arena/buildings.py - brutalist blocks, sheds, walls, quay, channels, heaps, ship.

Same conventions as pieces.py (Blender coords, local origin at the base centre, semantic
materials, collider lists)."""
import math

from mathutils import Matrix, Vector

from akit import P, Geo, TAU
from pieces import V, beacon, beam, bx, bxz, cheap_ladder, flood, merge, rail_line, tube, xbrace


def _noise(seed):
    import random
    r = random.Random(seed)
    return r


# ============================================================================ BRUTALIST BLOCK
def brut_block(sx, sy, h, seed=1, windows=True, doors=1, pil=7.0, var='', hazard=True, roof=True, band_h=2.6,
               stair=False, core=True, pipes=True, cant=False):
    """Board-formed concrete block: plinth, projecting pilasters, recessed window band,
    heavy cornice, roller doors, downpipes, hazard base band and roof clutter."""
    r = _noise(seed)
    g = Geo()
    cv = 'concrete' + (':' + var if var else '')
    g.merge(bxz(sx + 1.0, sy + 1.0, 1.4, mat='concrete:dark', bev=0.1))
    g.merge(bxz(sx, sy, h, z0=0.0, mat=cv, bev=0.12))
    g.merge(bxz(sx + 1.4, sy + 1.4, 1.6, z0=h - 0.4, mat='concrete:grey', bev=0.1))
    # pilasters on all 4 faces
    for (L, axis) in ((sx, 'x'), (sy, 'y')):
        n = max(1, int(L / pil))
        for i in range(n + 1):
            t = -L / 2 + i * L / n
            for s in (-1, 1):
                if axis == 'x':
                    g.merge(bxz(1.3, 0.8, h - 1.0, t, s * (sy / 2 + 0.35), 0.0, mat=cv, bev=0.08))
                else:
                    g.merge(bxz(0.8, 1.3, h - 1.0, s * (sx / 2 + 0.35), t, 0.0, mat=cv, bev=0.08))
    # window band (trim) between pilasters on the +/-Y faces
    if windows and h > 9 and not (cant and h > 12):
        zw = h - 2.2 - band_h
        for s in (-1, 1):
            g.merge(bxz(sx - 0.4, 0.12, band_h, 0, s * (sy / 2 + 0.02), zw, mat='trim:window'))
            # a few lit bays (night shift): emissive panes of the same window trim
            for k in range(int(sx / 7)):
                if r.random() < 0.3:
                    x = -sx / 2 + 3.5 + k * 7.0
                    g.merge(bxz(5.0, 0.13, band_h, x, s * (sy / 2 + 0.025), zw, mat='trim:window_lit'))
            g.merge(bxz(sx + 0.2, 0.9, 0.35, 0, s * (sy / 2 + 0.3), zw - 0.35, mat='concrete:grey'))
        if sx > 20:
            for s in (-1, 1):
                g.merge(bxz(0.12, sy - 0.4, band_h * 0.8, s * (sx / 2 + 0.02), 0, zw, mat='trim:window'))
    # hazard band at the base
    if hazard:
        for s in (-1, 1):
            g.merge(bxz(sx + 0.05, 0.06, 1.3, 0, s * (sy / 2 + 0.03), 1.4, mat='trim:hazard'))
    # roller doors
    for k in range(doors):
        dx = (k - (doors - 1) / 2) * min(14.0, sx / max(doors, 1))
        dw, dh = min(8.0, sx / (doors + 1)), min(9.0, h * 0.55)
        g.merge(bxz(dw + 1.2, 0.5, dh + 0.9, dx, -sy / 2 - 0.2, 0.0, mat='steel:dark'))
        g.merge(bxz(dw, 0.3, dh, dx, -sy / 2 - 0.3, 0.0, mat='corr:' + r.choice(['grey', 'oxide', 'blue'])))
        g.merge(bxz(dw + 1.6, 1.4, 0.5, dx, -sy / 2 - 0.8, dh + 0.9, mat='concrete:grey'))
        g.merge(flood(dx, -sy / 2 - 1.2, dh + 2.4, 0.0, 'sodium'))
    # downpipes
    for s in (-1, 1):
        x = s * (sx / 2 - 2.0)
        g.merge(tube((x, -sy / 2 - 0.35, 0.3), (x, -sy / 2 - 0.35, h - 0.2), 0.18, 'steel:dark', 8))
    # roof clutter
    if roof:
        for i in range(r.randint(2, 4)):
            w, d, hh = r.uniform(3, 7), r.uniform(2.5, 5), r.uniform(1.6, 3.2)
            x, y = r.uniform(-sx / 2 + w, sx / 2 - w), r.uniform(-sy / 2 + d, sy / 2 - d)
            g.merge(bxz(w, d, hh, x, y, h + 1.2, mat='steel:galv'))
            g.merge(bxz(w * 0.8, 0.1, hh * 0.5, x, y - d / 2 - 0.02, h + 1.4, mat='trim:louvre'))
        for i in range(r.randint(1, 3)):
            x, y = r.uniform(-sx / 2 + 2, sx / 2 - 2), r.uniform(-sy / 2 + 2, sy / 2 - 2)
            g.merge(P.cylinder(0.7, 3.5, 16, bevel=0.0, mat='steel:rust', z0=h + 1.2).move(x, y, 0))
        if stair:
            g.merge(bxz(5, 5, 4, sx / 2 - 4, sy / 2 - 4, h + 1.2, mat=cv, bev=0.08))
        g.merge(rail_line([(-sx / 2 - 0.4, -sy / 2 - 0.4, h + 1.2), (sx / 2 + 0.4, -sy / 2 - 0.4, h + 1.2)], h=1.1, post=3.0, r=0.05))
    cols = [((0, 0, (h + 1.2) / 2), (sx + 1.4, sy + 1.4, h + 1.2))]
    # cantilevered upper storey (brutalist overhang) with its own window band + soffit beams
    if cant and h > 12:
        z0c = h * 0.6
        cy = sy / 2 + 2.6
        g.merge(bxz(sx + 2.6, sy + 5.2, h - z0c + 0.2, 0, 0, z0c, mat=cv, bev=0.12))
        for sgn in (-1, 1):
            g.merge(bxz(sx + 1.6, 0.14, band_h, 0, sgn * (cy + 0.03), h - band_h - 1.6, mat='trim:window'))
            g.merge(bxz(sx + 2.8, 1.0, 0.5, 0, sgn * (cy + 0.4), h - band_h - 2.1, mat='concrete:grey'))
            for k in range(int(sx / 7)):
                if r.random() < 0.35:
                    g.merge(bxz(5.0, 0.16, band_h, -sx / 2 + 3.5 + k * 7.0, sgn * (cy + 0.04), h - band_h - 1.6, mat='trim:window_lit'))
        for k in range(int(sx / 5) + 1):
            x = -sx / 2 + k * sx / int(sx / 5)
            g.merge(bxz(0.8, sy + 5.0, 0.9, x, 0, z0c - 0.9, mat=cv, bev=0.05))
        cols = [((0, 0, z0c / 2), (sx + 1.4, sy + 1.4, z0c)), ((0, 0, (z0c + h + 1.2) / 2), (sx + 2.8, sy + 5.4, h + 1.2 - z0c))]
    # stair core with slit windows (brutalist signature) on the +X end
    if core and h > 11:
        cw, ch = 6.5, h + 5.0
        cx, cy = sx / 2 + cw / 2 - 0.2, sy / 4 - cw / 2
        g.merge(bxz(cw, cw, ch, cx, cy, 0.0, mat=cv, bev=0.12))
        g.merge(bxz(cw + 0.8, cw + 0.8, 0.9, cx, cy, ch, mat='concrete:grey', bev=0.08))
        for k in range(int((ch - 4) / 4.0)):
            g.merge(bxz(0.12, 0.9, 2.6, cx + cw / 2 + 0.02, cy, 3.0 + k * 4.0, mat='trim:window'))
        g.merge(bxz(0.3, 2.0, 3.0, cx + cw / 2 + 0.1, cy - 1.8, 0.0, mat='steel:dark'))
        g.merge(beacon(cx, cy, ch + 1.3, 0.5))
        cols.append(((cx, cy, ch / 2), (cw + 0.4, cw + 0.4, ch + 0.9)))
    # facade services on +Y: risers, header, brackets, units at the base
    if pipes and h > 8:
        ys = sy / 2 + 1.0
        xs = [-sx / 2 + 3.0 + i * 1.4 for i in range(3)]
        for i, x in enumerate(xs):
            g.merge(tube((x, ys, 0.4), (x, ys, h - 2.5 - i * 0.9), 0.32 - i * 0.06, r.choice(['steel:galv', 'steel:rust', 'steel:bone']), 12))
            g.merge(tube((x, ys, h - 2.5 - i * 0.9), (sx / 2 - 2.0, ys, h - 2.5 - i * 0.9), 0.32 - i * 0.06, 'steel:galv', 12))
        for k in range(int(h / 3)):
            g.merge(bxz(5.0, 1.2, 0.2, xs[1], ys - 0.4, 1.5 + k * 3.0, mat='steel:dark'))
        for x in (sx * 0.1, sx * 0.3):
            g.merge(bxz(3.6, 2.4, 2.6, x, sy / 2 + 1.6, 0.0, mat='steel:galv'))
            g.merge(bxz(3.0, 0.1, 1.6, x, sy / 2 + 2.82, 0.5, mat='trim:louvre'))
        # aspect-correct stencil sign, 2-3 m letters (a strip line is 64 px tall in the trim atlas)
        from akit import STENCILS
        opts = [k for k in ('halvard', 'grauwerk', 'hdf07', 'pier07') if (STENCILS[k][1] - STENCILS[k][0]) * 16.0 * 3.4 < sx * 0.9]
        key = r.choice(opts[:2]) if opts else 'hdf07'
        sh_ = 3.4 if opts else max(1.6, sx * 0.9 / ((STENCILS['hdf07'][1] - STENCILS['hdf07'][0]) * 16.0))
        sw_ = (STENCILS[key][1] - STENCILS[key][0]) * 16.0 * sh_
        g.merge(bxz(sw_, 0.1, sh_, 0.0, -sy / 2 - 0.36, h - sh_ - 2.6, mat='trim:stencil@' + key))
    return g, cols


def shed(sx, sy, h, var='grey', monitor=True, doors=2, glow_doors=False, seed=3):
    """Steel-framed corrugated shed with monitor roof, columns, gutters, big doors."""
    r = _noise(seed)
    g = Geo()
    g.merge(bxz(sx + 0.8, sy + 0.8, 1.2, mat='concrete:dark', bev=0.08))
    g.merge(bxz(sx, sy, h, z0=1.0, mat='corr:' + var))
    # roof: two slopes
    rise = sy * 0.12
    for s in (-1, 1):
        rf = bx(sx + 1.0, sy / 2 + 1.2, 0.3, (0, 0, 0), mat='corr:' + var)
        rf.transform(Matrix.Translation(V((0, s * sy / 4, h + 1.0 + rise / 2))) @ Matrix.Rotation(s * math.atan2(rise, sy / 2), 4, 'X'))
        g.merge(rf)
    g.merge(bxz(sx + 1.0, sy * 0.25, rise * 0.6 + 0.2, 0, 0, h + 1.0, mat='corr:' + var))
    if monitor:
        g.merge(bxz(sx * 0.8, sy * 0.22, 3.2, 0, 0, h + 1.0 + rise * 0.9, mat='corr:' + var))
        for s in (-1, 1):
            g.merge(bxz(sx * 0.8, 0.12, 1.8, 0, s * sy * 0.11, h + 1.4 + rise * 0.9, mat='trim:louvre'))
        g.merge(bxz(sx * 0.8 + 0.6, sy * 0.22 + 1.2, 0.3, 0, 0, h + 4.2 + rise * 0.9, mat='steel:dark'))
    # frame columns + girts
    n = max(2, int(sx / 8))
    for i in range(n + 1):
        x = -sx / 2 + i * sx / n
        for s in (-1, 1):
            g.merge(bxz(0.6, 0.6, h + 0.6, x, s * (sy / 2 + 0.3), 0.6, mat='steel:dark'))
    for s in (-1, 1):
        g.merge(bxz(sx + 0.6, 0.5, 0.5, 0, s * (sy / 2 + 0.35), h + 0.8, mat='steel:dark'))
        g.merge(bxz(sx - 1, 0.12, 2.2, 0, s * (sy / 2 + 0.06), h - 3.6, mat='trim:window'))
    m = max(1, int(sy / 8))
    for i in range(m + 1):
        y = -sy / 2 + i * sy / m
        for s in (-1, 1):
            g.merge(bxz(0.6, 0.6, h + 0.6, s * (sx / 2 + 0.3), y, 0.6, mat='steel:dark'))
    # big doors on -Y
    for k in range(doors):
        dx = (k - (doors - 1) / 2) * sx / doors
        dw, dh = min(14.0, sx / doors * 0.6), min(16.0, h * 0.7)
        g.merge(bxz(dw + 1.4, 0.8, dh + 1.2, dx, -sy / 2 - 0.2, 0.0, mat='steel:yellow'))
        g.merge(bxz(dw, 0.9, dh, dx, -sy / 2 - 0.2, 0.0, mat='steel:black'))
        if glow_doors:   # fire inside: glowing floor slit + dim upper haze
            g.merge(bxz(dw - 0.4, 0.2, 1.6, dx, -sy / 2 - 0.62, 0.0, mat='glow:furnace'))
            g.merge(bxz(dw - 0.4, 0.2, dh * 0.8, dx, -sy / 2 - 0.6, 0.0, mat='glow:furnace_grad'))
        g.merge(flood(dx, -sy / 2 - 0.8, dh + 3.0, 0.0))
    g.merge(bxz(sx + 0.1, 0.06, 1.2, 0, -sy / 2 - 0.05, 1.2, mat='trim:hazard'))
    g.merge(bx(0.1, sy * 0.6, sy * 0.6 / 7.5, (sx / 2 + 0.07, 0, h * 0.72), mat='trim:stencil@halvard'))
    cols = [((0, 0, (h + 2.0) / 2), (sx + 1.2, sy + 1.2, h + 2.0))]
    return g, cols


def casthouse():
    """Casthouse against the furnace: tall corrugated shed, glowing tap-floor openings,
    runner hood, fume ducts. Opening faces local -Y."""
    g, cols = shed(46.0, 34.0, 24.0, var='oxide', monitor=True, doors=2, glow_doors=True, seed=7)
    for x in (-12.0, 12.0):
        g.merge(tube((x, 10.0, 28.0), (x, 10.0, 44.0), 1.4, 'steel:rust', 20))
        g.merge(tube((x, 10.0, 44.0), (x + 8.0 * (1 if x > 0 else -1), 30.0, 44.0), 1.4, 'steel:rust', 20))
    g.merge(bxz(30.0, 6.0, 5.0, 0, -17.0 - 3.0, 18.0, mat='steel:dark'))
    return g, cols


def transfer_tower():
    """Conveyor transfer tower: 24 m concrete base, clad steel head house to 52 m."""
    g = Geo()
    bg, _ = brut_block(18.0, 18.0, 24.0, seed=11, doors=1, windows=True, roof=False, core=False, pipes=False)
    g.merge(bg)
    g.merge(bxz(21.0, 21.0, 1.0, 0, 0, 25.2, mat='steel:dark'))
    g.merge(bxz(20.0, 20.0, 24.0, 0, 0, 26.0, mat='corr:blue'))
    for s in (-1, 1):
        g.merge(bxz(20.2, 0.1, 2.2, 0, s * 10.02, 44.0, mat='trim:window'))
        g.merge(bxz(0.1, 20.2, 2.2, s * 10.02, 0, 44.0, mat='trim:window'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bxz(0.9, 0.9, 25.0, sx * 10.2, sy * 10.2, 25.5, mat='steel:dark'))
    g.merge(bxz(22.0, 22.0, 0.8, 0, 0, 50.0, mat='steel:dark'))
    g.merge(rail_line([(-11, -11, 50.8), (11, -11, 50.8), (11, 11, 50.8), (-11, 11, 50.8), (-11, -11, 50.8)], h=1.2, post=3.0, r=0.07))
    g.merge(bxz(6.0, 5.0, 4.0, 5.0, 5.0, 50.8, mat='corr:blue'))
    g.merge(P.cylinder(0.5, 8.0, 12, bevel=0.0, mat='steel:galv', z0=50.8).move(-7, -7, 0))
    g.merge(beacon(-7, -7, 59.0, 0.8))
    for (x, y, yaw) in ((0, -11.5, 0.0), (0, 11.5, math.pi), (11.5, 0, math.pi / 2), (-11.5, 0, -math.pi / 2)):
        g.merge(flood(x, y, 48.0, yaw))
    g.merge(cheap_ladder(24.0, 9.5, -9.8, 0.0, facing=0.0))
    return g, [((0, 0, 26.0), (22.0, 22.0, 52.0))]


# ============================================================================ WALLS / QUAY
def retaining_wall_seg(L=20.0, h=10.0):
    """Retaining wall segment along X; inner (arena) face toward local -Y. Counterforts,
    coping, hazard band, drainage outlets."""
    g = Geo()
    t = 2.2
    g.merge(bxz(L, t, h, 0, 0, 0.0, mat='concrete:grey', bev=0.1))
    g.merge(bxz(L + 0.02, t + 1.0, 1.2, 0, 0.0, h, mat='concrete:grey', bev=0.1))
    g.merge(bxz(L + 0.02, 0.06, 1.8, 0, -t / 2 - 0.03, 0.4, mat='trim:hazard'))
    for x in (-L / 4, L / 4):
        cf = P.prism([(0.0, 0.0), (3.2, 0.0), (0.0, h - 0.5)], 1.4, bevel=0.05, segs=1, mat='concrete', axis='X')
        cf.transform(Matrix.Translation(V((x, -t / 2, 0.0))) @ Matrix.Rotation(math.pi, 4, 'Z'))
        g.merge(cf)
    for x in (-L / 2 + 2.5, 0.0):
        g.merge(tube((x, -t / 2 - 0.3, 2.6), (x, -t / 2 + 0.3, 2.6), 0.3, 'steel:rust', 12))
    g.merge(rail_line([(-L / 2, 0.3, h + 1.2), (L / 2, 0.3, h + 1.2)], h=1.1, post=2.5, r=0.05))
    return g, [((0, 0, (h + 1.2) / 2), (L, t + 1.0, h + 1.2))]


def quay_seg(L=20.0):
    """Quay edge: coping beam at the arena edge, wall face down to the water (-Y side =
    the sea), fenders, bollard, ladder recess."""
    g = Geo()
    g.merge(bxz(L, 3.0, 1.0, 0, 0, 0.0, mat='concrete:grey', bev=0.08))
    g.merge(bxz(L, 2.0, 18.0, 0, -0.5, -18.0, mat='concrete:dark'))
    for x in (-L / 4, L / 4):
        g.merge(bxz(2.2, 1.2, 4.5, x, -2.0, -5.0, mat='steel:black'))
    b = P.lathe([(0.0, 0.0), (0.7, 0.0), (0.55, 0.6), (0.5, 1.0), (0.85, 1.2), (0.85, 1.4), (0.0, 1.45)], 20, 'steel:dark')
    g.merge(b.move(0, 0.2, 1.0))
    g.merge(bxz(L + 0.01, 0.06, 0.9, 0, -1.53, 0.05, mat='trim:hazard2'))
    g.merge(cheap_ladder(12.0, L / 2 - 1.5, -1.55, -12.0, facing=0.0, cage=False))
    return g


def crane_rail(L=20.0):
    g = Geo()
    g.merge(bxz(L, 1.6, 0.25, mat='concrete:dark'))
    g.merge(bxz(L, 0.25, 0.22, 0, 0, 0.25, mat='steel:rail'))
    return g


# ============================================================================ SLAG / HEAPS
def slag_channel(pts, width=5.0, curb=1.2, curb_h=0.8):
    """Molten slag runner along a polyline (Blender coords): concrete curbs + glowing slag
    (flow UVs along the path) + crust strips. Returns (geo, cols)."""
    g = Geo()
    cols = []
    P_ = [V(p) for p in pts]
    for i in range(len(P_) - 1):
        a, b = P_[i], P_[i + 1]
        d = (b - a)
        L = d.length
        dn = d.normalized()
        side = V((-dn.y, dn.x, 0.0))
        ang = math.atan2(d.y, d.x)
        mid = (a + b) * 0.5
        Mt = Matrix.Translation(mid) @ Matrix.Rotation(ang, 4, 'Z')
        ext = L + (width + 2 * curb if i < len(P_) - 2 else 0)
        for s in (-1, 1):
            c = bx(ext, curb, curb_h, (0, s * (width / 2 + curb / 2), curb_h / 2), mat='concrete:soot', bev=0.1)
            c.transform(Mt)
            g.merge(c)
            cols.append((mid + side * s * (width / 2 + curb / 2) + V((0, 0, curb_h / 2)), (ext, curb, curb_h), ang))
            cr = bx(ext, 0.8, 0.1, (0, s * (width / 2 - 0.3), 0.2), mat='heap:slag')
            cr.transform(Mt)
            g.merge(cr)
        # slag surface: quad with first edge along the flow
        p0 = a - side * width / 2 + V((0, 0, 0.14))
        p1 = b - side * width / 2 + V((0, 0, 0.14))
        p2 = b + side * width / 2 + V((0, 0, 0.14))
        p3 = a + side * width / 2 + V((0, 0, 0.14))
        g.merge(Geo.from_pydata([p0, p1, p2, p3], [(0, 1, 2, 3)], 'slag'))
    return g, cols


def slag_pool(rx, ry, seed=5):
    """Glowing slag pit: crusted rim, molten centre (flow UVs), concrete retaining lip."""
    g = Geo()
    g.merge(Geo.from_pydata([(-rx, -ry, 0.12), (rx, -ry, 0.12), (rx, ry, 0.12), (-rx, ry, 0.12)], [(0, 1, 2, 3)], 'slag'))
    for s in (-1, 1):
        g.merge(bxz(2 * rx + 3.0, 1.5, 1.0, 0, s * (ry + 0.75), 0.0, mat='concrete:soot', bev=0.1))
        g.merge(bxz(1.5, 2 * ry, 1.0, s * (rx + 0.75), 0, 0.0, mat='concrete:soot', bev=0.1))
    return g


def heap(rx, ry, h, var='ore', seed=1, rings=9, segs=40):
    """Stockpile / slag heap: noisy elliptical mound. Returns (geo, cols)."""
    import random
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, TAU) for _ in range(4)]
    verts = []
    faces = []
    for i in range(rings + 1):
        t = i / rings
        for j in range(segs):
            a = TAU * j / segs
            wob = 1 + 0.08 * math.sin(3 * a + ph[0]) + 0.05 * math.sin(7 * a + ph[1]) + 0.03 * math.sin(13 * a + ph[2])
            rr = (1 - t) * wob
            z = h * (1 - min(rr, 1.0) ** 1.7) ** 1.35 if rr < 1 else 0.0
            z += (0.35 * math.sin(5 * a + t * 7 + ph[3]) + 0.2 * math.sin(11 * a + t * 13 + ph[1])) * (1 - t) * t * 4 * (h / 10)
            verts.append((math.cos(a) * rx * rr, math.sin(a) * ry * rr, max(0.0, z) - 0.3 * (i == 0)))
    top = len(verts)
    verts.append((0.0, 0.0, h))
    for i in range(rings):
        for j in range(segs):
            j2 = (j + 1) % segs
            a, b, c, d = i * segs + j, i * segs + j2, (i + 1) * segs + j2, (i + 1) * segs + j
            if i == rings - 1:
                faces.append((a, b, top))
            else:
                faces.append((a, b, c, d))
    g = Geo.from_pydata(verts, faces, 'heap:' + var)
    cols = [((0, 0, h * 0.25), (rx * 1.5, ry * 1.5, h * 0.5)), ((0, 0, h * 0.7), (rx * 0.85, ry * 0.85, h * 0.4))]
    return g, cols


# ============================================================================ SHIP / SEA
def bulk_carrier(L=190.0, W=30.0, D=17.0):
    """Derelict bulk carrier hull (bow toward local -Y), hatch covers, deck cranes, aft
    accommodation block + funnel. Keel at z=0."""
    g = Geo()
    secs = []
    for t, wmul, zb in ((-0.5, 0.05, 6.0), (-0.47, 0.35, 3.0), (-0.42, 0.75, 1.0), (-0.34, 1.0, 0.0), (0.38, 1.0, 0.0),
                        (0.46, 0.85, 2.5), (0.5, 0.6, 7.0)):
        w = W / 2 * wmul
        secs.append(([(-w * 0.9, zb), (w * 0.9, zb), (w, zb + 1.5), (w, D), (-w, D), (-w, zb + 1.5)], t * L))
    hull = P.loft(secs, bevel=0.0, segs=1, mat='steel:dark', axis='Y')
    g.merge(hull)
    # boot-top red band
    g.merge(P.loft([([(-W / 2 - 0.05, 0.5), (W / 2 + 0.05, 0.5), (W / 2 + 0.05, 7.0), (-W / 2 - 0.05, 7.0)], -0.33 * L),
                    ([(-W / 2 - 0.05, 0.5), (W / 2 + 0.05, 0.5), (W / 2 + 0.05, 7.0), (-W / 2 - 0.05, 7.0)], 0.37 * L)],
                   bevel=0.0, segs=1, mat='steel:red', axis='Y'))
    for k in range(7):
        y = -0.3 * L + k * 0.085 * L
        g.merge(bxz(W * 0.62, 14.0, 2.2, 0, y, D, mat='steel:oxide'))
        g.merge(bxz(W * 0.66, 15.0, 0.6, 0, y, D - 0.2, mat='steel:dark'))
    for k in range(4):
        y = -0.26 * L + k * 0.17 * L
        g.merge(P.cylinder(1.4, 10.0, 16, bevel=0.0, mat='steel:bone', z0=D).move(0, y + 7.0, 0))
        g.merge(beam((0, y + 7.0, D + 9.5), (8.0, y - 14.0, D + 18.0), 1.0, 1.4, 'steel:bone'))
    ay = 0.38 * L
    for i, (w, d, h) in enumerate(((W - 2, 20, 4), (W - 4, 17, 4), (W - 6, 15, 4), (W - 8, 13, 4), (W - 6, 10, 3))):
        g.merge(bxz(w, d, h, 0, ay - 4 + i * 0.5, D + i * 4.0, mat='steel:white'))
        g.merge(bxz(w + 0.05, d * 0.9, 1.0, 0, ay - 4 + i * 0.5, D + i * 4.0 + 1.6, mat='trim:window'))
    g.merge(bxz(W + 6, 5, 0.6, 0, ay - 13.0, D + 16.0, mat='steel:white'))
    g.merge(bxz(7, 6, 12, 0, ay + 6, D + 18.0, mat='steel:dark'))
    g.merge(bxz(7.2, 6.2, 2.0, 0, ay + 6, D + 26.0, mat='steel:orange'))
    g.merge(beam((0, ay - 8, D + 20), (0, ay - 8, D + 32), 0.4, 0.4, 'steel:dark'))
    g.merge(beacon(0, ay - 8, D + 32.5, 0.6))
    return g


def breakwater(L=900.0):
    g = Geo()
    g.merge(P.prism([(-22, -12), (22, -12), (8, 6), (-8, 6)], L, bevel=0.0, segs=1, mat='heap:dark', axis='X'))
    g.merge(bxz(L, 5.0, 4.0, 0, 3.0, 5.5, mat='concrete:grey'))
    # accropode-ish armour blocks scattered on the seaward slope
    import random
    rnd = random.Random(9)
    for i in range(160):
        x = rnd.uniform(-L / 2, L / 2)
        y = rnd.uniform(-16, -6)
        z = 5 + (y + 6) * 0.8
        s = rnd.uniform(2.0, 3.2)
        b = bx(s, s, s, (0, 0, 0), mat='concrete:grey')
        b.transform(Matrix.Translation(V((x, y, z))) @ Matrix.Rotation(rnd.uniform(0, 3), 4, 'Z') @ Matrix.Rotation(rnd.uniform(0, 1), 4, 'X'))
        g.merge(b)
    return g


def light_tower():
    g = Geo()
    g.merge(P.lathe([(0.0, 0.0), (3.0, 0.0), (2.2, 22.0), (2.6, 22.0), (2.6, 23.0), (0.0, 23.0)], 20, 'concrete:pale'))
    for z in (4.0, 10.0, 16.0):
        g.merge(P.ring(3.0 - z * 0.036 + 0.05, 2.0, 2.0, 20, bevel=0.0, mat='steel:red', z0=z))
    g.merge(P.cylinder(1.4, 2.5, 16, bevel=0.0, mat='glow:white', z0=23.0))
    g.merge(P.cone(1.8, 0.2, 1.6, 16, bevel=0.0, mat='steel:dark').move(0, 0, 25.5))
    return g


# ============================================================================ FAR SILHOUETTES
def far_block(sx, sy, h, seed=1):
    import random
    r = random.Random(seed)
    g = Geo()
    g.merge(bxz(sx, sy, h, mat='far'))
    for i in range(r.randint(1, 3)):
        w, d, hh = r.uniform(0.2, 0.5) * sx, r.uniform(0.3, 0.7) * sy, r.uniform(0.2, 0.6) * h
        g.merge(bxz(w, d, hh, r.uniform(-0.3, 0.3) * sx, r.uniform(-0.2, 0.2) * sy, h, mat='far:dark'))
    g.merge(bxz(sx * 1.02, 0.2, h * 0.08, 0, -sy / 2, h * 0.7, mat='glow:window'))
    return g


def far_stack(h, r0, r1, glow=True):
    g = Geo()
    g.merge(P.lathe([(0.0, 0.0), (r0, 0.0), (r1, h), (r1 * 0.8, h), (r1 * 0.8, h - 2), (0.0, h - 2)], 24, 'far'))
    if glow:
        g.merge(P.cylinder(r1 * 0.8, 0.2, 24, bevel=0.0, mat='glow:furnace', z0=h - 1.5))
    g.merge(beacon(r1 * 0.7, 0, h + 0.5, max(1.0, r1 * 0.25)))
    return g


def far_crane(h=70.0):
    g = Geo()
    for sx in (-1, 1):
        for y in (-12, 12):
            g.merge(bxz(1.6, 1.6, 40, sx * 8, y, 0, mat='far:rust'))
        g.merge(bx(1.6, 90, 3, (sx * 8, -20, 41.5), mat='far:rust'))
        g.merge(beam((sx * 7, 12, 43), (sx * 5, 0, h), 1.2, 1.2, 'far:rust'))
        g.merge(beam((sx * 7, -12, 43), (sx * 5, 0, h), 1.2, 1.2, 'far:rust'))
        g.merge(beam((sx * 5, 0, h), (sx * 8, -64, 43), 0.5, 0.5, 'far:dark'))
    g.merge(bxz(14, 10, 6, 0, 16, 43, mat='far'))
    g.merge(beacon(0, 0, h + 0.8, 1.2))
    return g


def deck_edge(L=20.0, drop=9.0):
    """Pier deck edge along local X: parapet + guard rail on the deck (local +Y side), a
    retaining face with pilasters dropping `drop` m to the lower yard on the outer (-Y) side."""
    g = Geo()
    g.merge(bxz(L, 0.8, 1.3, 0, 0.4, 0.0, mat='concrete:grey', bev=0.06))
    g.merge(bxz(L + 0.02, 1.1, 0.25, 0, 0.35, 1.3, mat='concrete:grey', bev=0.04))
    g.merge(bxz(L + 0.02, 0.05, 0.8, 0, 0.83, 0.25, mat='trim:hazard2'))
    g.merge(bxz(L, 1.2, drop + 1.6, 0, -0.6, -drop - 1.4, mat='concrete:dark'))
    for x in (-L / 4, L / 4):
        g.merge(bxz(1.6, 1.0, drop + 1.0, x, -1.6, -drop - 1.0, mat='concrete:dark', bev=0.06))
    g.merge(tube((0, -1.1, -drop + 2.2), (0, -1.9, -drop + 2.2), 0.35, 'steel:rust', 12))
    g.merge(rail_line([(-L / 2, 0.4, 1.55), (L / 2, 0.4, 1.55)], h=1.2, post=2.5, r=0.05, mat='steel:yellow'))
    return g, [((0, 0.4, 0.8), (L, 0.8, 1.6))]
