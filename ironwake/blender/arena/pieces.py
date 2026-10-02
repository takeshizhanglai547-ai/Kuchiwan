"""blender/arena/pieces.py - modular kit for Halvard Deep Foundry, Pier 7.

Every builder returns an iwkit Geo in BLENDER coordinates around the piece's local origin
(Z up; a piece's 'forward' is -Y, like every IRONWAKE asset) and, where it collides, a list
of local collider boxes [(center, size)]. Materials are semantic '<base>:<variant>' names
(see akit.VARIANTS). Scale: 1 unit = 1 m; the player rig is ~10 m tall, so cover pieces are
authored at mech scale (low cover 3-5 m, tall cover 8+ m).
"""
import math

import bmesh
from mathutils import Matrix, Vector

from akit import P, Geo, TAU

V = Vector


# ------------------------------------------------------------------------------ helpers
def bx(sx, sy, sz, c=(0, 0, 0), mat='steel', bev=0.0, bseg=1, chamfer_axes=None):
    """Box of full size (sx, sy, sz) centred at c. bev > 0 bevels every edge."""
    g = Geo()
    bmesh.ops.create_cube(g.bm, size=1.0)
    g.set_mat(mat)
    g.transform(Matrix.Diagonal((sx, sy, sz, 1.0)))
    if bev > 0:
        if chamfer_axes:
            es = []
            for ax in chamfer_axes:
                es += g.edges_parallel({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[ax])
            g.bevel(bev, bseg, edges=list(dict.fromkeys(es)))
        else:
            g.bevel(bev, bseg)
    g.move(V(c))
    return g


def bxz(sx, sy, sz, x=0.0, y=0.0, z0=0.0, **kw):
    """Box standing on z0."""
    return bx(sx, sy, sz, (x, y, z0 + sz / 2), **kw)


def beam(a, b, w, h=None, mat='steel', up=(0, 0, 1)):
    """Rectangular member from a to b, cross-section w x h."""
    a, b = V(a), V(b)
    d = b - a
    h = w if h is None else h
    g = bx(w, h, d.length, mat=mat)
    g.align(d, up=up, loc=(a + b) * 0.5)
    return g


def tube(a, b, r, mat='steel', segs=16, cap=True):
    a, b = V(a), V(b)
    d = b - a
    g = P.cylinder(r, d.length, segs, bevel=0.0, mat=mat, cap=cap)
    g.align(d, loc=(a + b) * 0.5)
    return g


def cylz(r, h, x=0.0, y=0.0, z0=0.0, mat='steel', segs=32, cap=True):
    return P.cylinder(r, h, segs, bevel=0.0, mat=mat, cap=cap, z0=z0).move(x, y, 0)


def lathe(profile, segs, mat, x=0.0, y=0.0, z=0.0):
    return P.lathe(profile, segs, mat).move(x, y, z)


def quad(p0, p1, p2, p3, mat):
    """Single quad (first edge p0->p1 = decal/flow U axis). Normal = right-hand rule."""
    return Geo.from_pydata([p0, p1, p2, p3], [(0, 1, 2, 3)], mat)


def hquad(cx, cy, w, l, z, mat, rot=0.0):
    """Horizontal quad facing +Z, u along local X rotated by rot (radians)."""
    c, s = math.cos(rot), math.sin(rot)

    def p(u, v):
        return (cx + u * c - v * s, cy + u * s + v * c, z)
    return quad(p(-w / 2, -l / 2), p(w / 2, -l / 2), p(w / 2, l / 2), p(-w / 2, l / 2), mat)


def merge(*gs):
    g = Geo()
    g.merge(*[x for x in gs if x is not None])
    return g


def rail_line(pts, h=1.1, post=2.4, r=0.06, mat='steel:railing', post_mat='steel:railing'):
    """Cheap mech-scale handrail: top + mid rail boxes and posts (no toe board)."""
    g = Geo()
    P_ = [V(p) for p in pts]
    for i in range(len(P_) - 1):
        a, b = P_[i], P_[i + 1]
        g.merge(beam(a + V((0, 0, h)), b + V((0, 0, h)), r * 1.6, r * 1.6, mat))
        g.merge(beam(a + V((0, 0, h * 0.5)), b + V((0, 0, h * 0.5)), r * 1.2, r * 1.2, post_mat))
        n = max(1, int(math.ceil((b - a).length / post)))
        for k in range(n + (1 if i == len(P_) - 2 else 0)):
            p = a + (b - a) * (k / n)
            g.merge(bx(r * 1.4, r * 1.4, h, (p.x, p.y, p.z + h / 2), mat=post_mat))
    return g


def cheap_ladder(h, x=0.0, y=0.0, z0=0.0, w=0.6, mat='steel:railing', facing=0.0, cage=True, rung=0.45, hoop=1.5):
    g = Geo()
    for sx in (-w / 2, w / 2):
        g.merge(bx(0.08, 0.08, h, (sx, 0, z0 + h / 2), mat=mat))
    n = int(h / rung)
    for i in range(1, n):
        g.merge(bx(w, 0.05, 0.05, (0, 0, z0 + i * rung), mat='steel:galv'))
    if cage and h > 4:
        for i in range(int((h - 3) / hoop)):
            z = z0 + 3 + i * hoop
            g.merge(bx(w + 0.5, 0.06, 0.06, (0, -0.8, z), mat=mat))
            g.merge(bx(0.06, 0.8, 0.06, (-w / 2 - 0.25, -0.4, z), mat=mat))
            g.merge(bx(0.06, 0.8, 0.06, (w / 2 + 0.25, -0.4, z), mat=mat))
        for sx in (-w / 2 - 0.25, 0, w / 2 + 0.25):
            g.merge(bx(0.05, 0.05, h - 3, (sx, -0.8, z0 + 3 + (h - 3) / 2), mat=mat))
    g.transform(Matrix.Translation(V((x, y, 0))) @ Matrix.Rotation(facing, 4, 'Z'))
    return g


def xbrace(a, b, c, d, w, mat):
    """X brace inside quad a-b-c-d (a-c and b-d diagonals)."""
    return merge(beam(a, c, w, w, mat), beam(b, d, w, w, mat))


def flood(x, y, z, yaw=0.0, var='sodium'):
    """Floodlight head: housing + glowing lens facing local -Y."""
    g = merge(bx(1.3, 0.7, 0.9, (0, 0, 0), mat='steel:dark'),
              bx(1.1, 0.06, 0.7, (0, -0.37, 0), mat='glow:' + var),
              bx(0.2, 0.2, 0.8, (0, 0.2, -0.7), mat='steel:dark'))
    g.transform(Matrix.Translation(V((x, y, z))) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(math.radians(25), 4, 'X'))
    return g


def beacon(x, y, z, s=0.6):
    return merge(bx(s * 1.2, s * 1.2, s * 0.3, (x, y, z - s * 0.15), mat='steel:dark'),
                 bx(s, s, s, (x, y, z + s * 0.5), mat='glow:red'))


def cyl_cols(r, z0, z1, x=0.0, y=0.0):
    """Collider set approximating a vertical cylinder: 4 rectangles rotated 0/45/90/135 deg with
    corners on the circle (max gap ~6% of r, nothing protrudes)."""
    return [((x, y, (z0 + z1) / 2), (1.84 * r, 0.76 * r, z1 - z0), a) for a in (0.0, math.pi / 4, math.pi / 2, 3 * math.pi / 4)]


# ============================================================================ SMALL PROPS / COVER
CONTAINER = (12.19, 2.44, 2.59)


def container(col='c_red'):
    L, W, H = CONTAINER
    g = Geo()
    g.merge(bx(L - 0.3, W - 0.1, H - 0.3, (0, 0, H / 2), mat='corr:' + col))
    # frame: corner posts, top/bottom side rails, end frames
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bx(0.18, 0.18, H, (sx * (L / 2 - 0.09), sy * (W / 2 - 0.09), H / 2), mat='steel:dark'))
            g.merge(bx(0.24, 0.24, 0.2, (sx * (L / 2 - 0.12), sy * (W / 2 - 0.12), H - 0.1), mat='steel:galv'))
            g.merge(bx(0.24, 0.24, 0.2, (sx * (L / 2 - 0.12), sy * (W / 2 - 0.12), 0.1), mat='steel:galv'))
        g.merge(bx(L, 0.14, 0.16, (0, sx * (W / 2 - 0.07), H - 0.08), mat='corr:' + col))
        g.merge(bx(L, 0.16, 0.22, (0, sx * (W / 2 - 0.08), 0.11), mat='steel:dark'))
    # door end (+X): lock rods + hinges + stencil
    for k in (-0.75, -0.25, 0.25, 0.75):
        g.merge(bx(0.1, 0.06, H - 0.5, (L / 2 + 0.02, k * (W / 2 - 0.2), H / 2), mat='steel:galv'))
    g.merge(bx(0.04, W - 0.5, 0.35, (L / 2 - 0.1, 0, H * 0.72), mat='trim:stencil@hdf07'))
    return g, [((0, 0, H / 2), (L, W, H))]


def block_barrier(L=6.0, H=3.2, D=2.4):
    """Mech-scale precast barrier block: chamfered top, lifting loops, hazard ends."""
    prof = [(-D / 2, 0), (D / 2, 0), (D / 2, H * 0.55), (D * 0.28, H), (-D * 0.28, H), (-D / 2, H * 0.55)]
    g = P.prism(prof, L, bevel=0.06, segs=1, mat='concrete:grey', axis='X')
    for sx in (-L / 2 - 0.01, L / 2 + 0.01):
        g.merge(bx(0.04, D * 0.8, H * 0.35, (sx, 0, H * 0.3), mat='trim:hazard2'))
    for x in (-L * 0.3, L * 0.3):
        g.merge(P.torus(0.22, 0.05, 12, 6, mat='steel:rust').rotate((90, 0, 0)).move(x, 0, H + 0.05))
    return g, [((0, 0, H / 2), (L, D, H))]


def billet_stack(L=9.0):
    g = Geo()
    rows = [(4, 0.0), (4, 0.9), (3, 1.8), (2, 2.7)]
    for n, z in rows:
        for i in range(n):
            y = (i - (n - 1) / 2) * 1.0
            g.merge(bx(L - (z * 0.2), 0.9, 0.85, (0, y, z + 0.43), mat='steel:rust', bev=0.03))
        g.merge(bx(0.4, n * 1.0 + 0.3, 0.06, (L * 0.3, 0, z + 0.88), mat='steel:dark'))
        g.merge(bx(0.4, n * 1.0 + 0.3, 0.06, (-L * 0.3, 0, z + 0.88), mat='steel:dark'))
    return g, [((0, 0, 1.8), (L, 4.2, 3.6))]


def pipe_spools():
    g = Geo()
    r = 1.5
    for (y, z) in ((-1.55, r), (1.55, r), (0, r + 2.6)):
        p = P.lathe([(r * 0.86, -6), (r, -6), (r, 6), (r * 0.86, 6), (r * 0.86, -6)], 32, 'steel:oxide')
        p.rotate((0, 90, 0)).move(0, y, z)
        g.merge(p)
        for x in (-6.05, 6.05):
            g.merge(P.ring(r * 1.12, r * 0.86, 0.3, 32, bevel=0.02, mat='steel:dark').rotate((0, 90, 0)).move(x, y, z))
    for x in (-3.5, 3.5):
        g.merge(bx(0.5, 6.4, 0.4, (x, 0, 0.2), mat='steel:rust'))
    return g, [((0, 0, 2.6), (12.4, 6.2, 5.2))]


def lamp_mast(h=32.0, lo=False):
    g = Geo()
    g.merge(P.lathe([(0.0, 0.0), (0.55, 0.0), (0.55, 0.5), (0.42, 0.6), (0.24, h), (0.0, h)], 16, 'steel:galv'))
    g.merge(bx(1.6, 1.6, 0.4, (0, 0, 0.2), mat='concrete:grey', bev=0.05))
    # head frame
    g.merge(bx(4.2, 0.2, 0.2, (0, 0, h - 0.4), mat='steel:galv'))
    g.merge(bx(0.2, 4.2, 0.2, (0, 0, h - 0.4), mat='steel:galv'))
    for (x, y, yaw) in ((1.8, 0, math.pi / 2), (-1.8, 0, -math.pi / 2), (0, 1.8, math.pi), (0, -1.8, 0.0)):
        g.merge(flood(x, y, h - 0.9, yaw))
    g.merge(bx(3.8, 3.8, 0.12, (0, 0, h - 1.7), mat='trim:grating'))
    if not lo:   # (lo: out-of-bounds copies seen from 20+ m: no railing / ladder)
        g.merge(rail_line([(-1.9, -1.9, h - 1.7), (1.9, -1.9, h - 1.7), (1.9, 1.9, h - 1.7), (-1.9, 1.9, h - 1.7), (-1.9, -1.9, h - 1.7)],
                          h=1.0, post=1.9, r=0.04, mat='steel:railing'))
        g.merge(cheap_ladder(h - 2.0, 0, 0.6, 0.6, w=0.5, facing=math.pi))
    g.merge(beacon(0, 0, h + 0.1, 0.35))
    return g, [((0, 0, h / 2), (1.2, 1.2, h))]


def rail_track(L=12.0, lo=False):
    """Standard-gauge track segment along X (ballast bed, sleepers, rails). lo: half the
    sleepers and box rails (lower-yard copies seen from the deck)."""
    g = Geo()
    prof = [(-2.1, 0.0), (2.1, 0.0), (1.4, 0.32), (-1.4, 0.32)]
    g.merge(P.prism(prof, L, bevel=0.0, segs=1, mat='heap:dark', axis='X'))
    n = int(L / (1.3 if lo else 0.65))
    for i in range(n):
        x = -L / 2 + (i + 0.5) * L / n
        g.merge(bx(0.26, 2.6, 0.18, (x, 0, 0.36), mat='concrete:dark'))
    rp = [(-0.075, 0), (0.075, 0), (0.075, 0.02), (0.012, 0.03), (0.012, 0.13), (0.036, 0.14), (0.036, 0.175),
          (-0.036, 0.175), (-0.036, 0.14), (-0.012, 0.13), (-0.012, 0.03), (-0.075, 0.02)]
    for y in (-0.72, 0.72):
        if lo:
            g.merge(bx(L, 0.08, 0.17, (0, y, 0.535), mat='steel:rail'))
            continue
        r = P.prism(rp, L, bevel=0.0, segs=1, mat='steel:rail', axis='X')
        r.move(0, y, 0.45)
        g.merge(r)
    return g


def hopper_wagon(lo=False):
    """Ore hopper wagon, 14 m, with an ore heap on top. Forward = X. lo: 8-sided wheels, no
    side stiffeners (lower-yard strings)."""
    g = Geo()
    L, W = 14.0, 3.2
    body = P.loft([([(-W / 2, 1.9), (W / 2, 1.9), (W / 2, 4.3), (-W / 2, 4.3)], -L / 2),
                   ([(-W / 2, 1.9), (W / 2, 1.9), (W / 2, 4.3), (-W / 2, 4.3)], L / 2)], bevel=0.05, segs=1,
                  mat='steel:oxide', axis='X')
    g.merge(body)
    # hopper chutes underneath
    for x in (-3.6, 0.0, 3.6):
        g.merge(P.frustum((3.0, 2.8), (1.2, 1.0), 1.2, bevel=0.0, segs=1, mat='steel:oxide').rotate((180, 0, 0)).move(x, 0, 1.95))
    # side stiffeners
    for i in range(0 if lo else 9):
        x = -L / 2 + 0.6 + i * (L - 1.2) / 8
        for sy in (-1, 1):
            g.merge(bx(0.16, 0.14, 2.3, (x, sy * (W / 2 + 0.06), 3.1), mat='steel:oxide'))
    g.merge(bx(L + 0.6, 2.0, 0.35, (0, 0, 1.75), mat='steel:dark'))
    # bogies + wheels
    for x in (-L / 2 + 2.2, L / 2 - 2.2):
        g.merge(bx(3.0, 2.4, 0.7, (x, 0, 0.9), mat='steel:dark'))
        for dx in (-0.9, 0.9):
            for sy in (-0.72, 0.72):
                g.merge(P.cylinder(0.46, 0.14, 8 if lo else 20, bevel=0.0, mat='steel:rail').rotate((90, 0, 0)).move(x + dx, sy, 0.46 + 0.45))
    for x in (-L / 2 - 0.4, L / 2 + 0.4):
        g.merge(bx(0.8, 0.4, 0.4, (x, 0, 1.3), mat='steel:dark'))
    # ore
    g.merge(P.prism([(-W / 2 + 0.15, 0), (W / 2 - 0.15, 0), (W * 0.2, 0.9), (-W * 0.2, 0.9)], L - 0.6, bevel=0.0, segs=1,
                    mat='heap:ore', axis='X').move(0, 0, 4.1))
    g.merge(bx(0.05, 1.6, 0.4, (0, -W / 2 - 0.14, 3.6), mat='trim:stencil@grauwerk').rotate((0, 0, 0)))
    return g, [((0, 0, 2.5), (L + 1.2, W + 0.4, 5.0))]


def ladle_car():
    """Torpedo ladle car (molten iron transfer), 22 m, forward = X."""
    g = Geo()
    prof = [(0.0, -11.0), (1.2, -11.0), (2.3, -8.5), (2.6, -5.5), (2.7, 0.0), (2.6, 5.5), (2.3, 8.5), (1.2, 11.0), (0.0, 11.0)]
    t = P.lathe(prof, 32, 'steel:dark')
    t.rotate((0, 90, 0)).move(0, 0, 4.0)
    g.merge(t)
    for x in (-5.5, 0.0, 5.5):
        g.merge(P.ring(2.85, 2.55, 0.5, 32, bevel=0.02, mat='steel:rust').rotate((0, 90, 0)).move(x, 0, 4.0))
    g.merge(P.cylinder(0.9, 0.9, 24, bevel=0.0, mat='steel:rust').move(0, 0, 6.6))
    g.merge(P.cylinder(0.75, 0.05, 24, bevel=0.0, mat='glow:hot').move(0, 0, 7.06))
    for x in (-9.0, 9.0):
        g.merge(bx(5.0, 3.0, 1.4, (x, 0, 1.6), mat='steel:dark'))
        g.merge(bx(1.2, 3.4, 3.0, (x * 0.93, 0, 3.2), mat='steel:oxide'))
        for dx in (-1.6, 0.0, 1.6):
            for sy in (-0.72, 0.72):
                g.merge(P.cylinder(0.46, 0.14, 20, bevel=0.0, mat='steel:rail').rotate((90, 0, 0)).move(x + dx, sy, 0.91))
    return g, [((0, 0, 3.5), (24.0, 5.6, 7.0))]


def jersey_row(n=5):
    g = Geo()
    prof = [(-0.4, 0), (0.4, 0), (0.4, 0.1), (0.15, 0.35), (0.12, 1.07), (-0.12, 1.07), (-0.15, 0.35), (-0.4, 0.1)]
    for i in range(n):
        s = P.prism(prof, 3.9, bevel=0.03, segs=1, mat='concrete:grey', axis='X')
        s.move((i - (n - 1) / 2) * 4.0, 0, 0)
        g.merge(s)
    return g


# ============================================================================ STRUCTURAL KIT
def trestle(h, w=8.0, d=6.0, variant=0):
    """Conveyor support tower (4 built-up columns with flange lips, struts every ~8 m, X bracing,
    bolted gusset plates at every strut / column node), top at z = h.
    variant 1: mid-height service platform (grating, railing, MCC cabinet, lamp);
    variant 2: cable-tray riser + pipe riser on the outer face, junction boxes."""
    g = Geo()
    col = 'steel:slate'
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bx(0.7, 0.7, h, (sx * w / 2, sy * d / 2, h / 2), mat=col))
            for fy in (-1, 1):                                      # flange lips (I-section read)
                g.merge(bx(1.05, 0.07, h, (sx * w / 2, sy * d / 2 + fy * 0.385, h / 2), mat=col))
            g.merge(bx(1.6, 1.6, 1.2, (sx * w / 2, sy * d / 2, 0.6), mat='concrete:grey', bev=0.08))
            g.merge(bx(1.3, 1.3, 0.12, (sx * w / 2, sy * d / 2, 1.26), mat='trim:bolted'))   # base plate
    levels = max(2, int(round(h / 8.0)))
    zs = [h * i / levels for i in range(levels + 1)]
    for i, z in enumerate(zs[1:], 1):
        for sy in (-1, 1):
            g.merge(bx(w, 0.45, 0.45, (0, sy * d / 2, z - 0.25), mat=col))
        for sx in (-1, 1):
            g.merge(bx(0.45, d, 0.45, (sx * w / 2, 0, z - 0.25), mat=col))
    # gusset plates (bolted trim: 2 x 4 bolt group + seam) on both face planes of every node
    for z in zs:
        zz = max(1.9, min(z - 0.25, h - 0.9))
        for sx in (-1, 1):
            for sy in (-1, 1):
                g.merge(bx(0.95, 0.05, 0.95, (sx * (w / 2 - 0.55), sy * (d / 2 + 0.43), zz), mat='trim:bolted'))
                g.merge(bx(0.05, 0.95, 0.95, (sx * (w / 2 + 0.38), sy * (d / 2 - 0.55), zz), mat='trim:bolted'))
    for i in range(levels):
        z0, z1 = zs[i] + 0.3, zs[i + 1] - 0.3
        for sy in (-1, 1):
            y = sy * d / 2
            g.merge(xbrace(V((-w / 2, y, z0)), V((w / 2, y, z0)), V((w / 2, y, z1)), V((-w / 2, y, z1)), 0.22, col))
        for sx in (-1, 1):
            x = sx * w / 2
            g.merge(xbrace(V((x, -d / 2, z0)), V((x, d / 2, z0)), V((x, d / 2, z1)), V((x, -d / 2, z1)), 0.22, col))
        # brace crossing plate
        zc = (z0 + z1) / 2
        for sy in (-1, 1):
            g.merge(bx(0.6, 0.05, 0.6, (0, sy * (d / 2 + 0.14), zc), mat='trim:bolted'))
    g.merge(bx(w + 1.2, d + 1.2, 0.6, (0, 0, h - 0.3), mat='steel:dark'))
    g.merge(cheap_ladder(h - 1, w / 2 + 0.2, 0, 0, facing=-math.pi / 2))
    if variant == 1:
        zp = zs[max(1, levels // 2)] - 0.25
        g.merge(bx(w + 1.0, 3.2, 0.25, (0, -d / 2 - 1.6, zp + 0.35), mat='trim:grating'))
        for sx in (-1, 1):
            g.merge(beam((sx * w / 2, -d / 2, zp - 2.2), (sx * w / 2, -d / 2 - 3.0, zp + 0.2), 0.25, 0.25, col))
        g.merge(rail_line([(-w / 2 - 0.4, -d / 2, zp + 0.48), (-w / 2 - 0.4, -d / 2 - 3.1, zp + 0.48), (w / 2 + 0.4, -d / 2 - 3.1, zp + 0.48),
                           (w / 2 + 0.4, -d / 2, zp + 0.48)], h=1.1, post=2.2, r=0.05))
        g.merge(bx(2.6, 1.0, 2.2, (-1.2, -d / 2 - 0.9, zp + 1.58), mat='steel:green'))
        g.merge(bx(2.62, 0.06, 0.4, (-1.2, -d / 2 - 1.42, zp + 2.3), mat='trim:hazard2'))
        g.merge(flood(2.4, -d / 2 - 2.9, zp + 3.4, 0.0))
        g.merge(bx(0.15, 0.15, 3.2, (2.4, -d / 2 - 2.9, zp + 2.0), mat='steel:galv'))
    elif variant == 2:
        g.merge(bx(0.9, 0.18, h - 2.0, (w / 2 + 0.2, d / 2 + 0.7, h / 2 + 0.5), mat='trim:grating'))
        g.merge(bx(0.08, 0.3, h - 2.0, (w / 2 - 0.25, d / 2 + 0.75, h / 2 + 0.5), mat='steel:galv'))
        g.merge(bx(0.08, 0.3, h - 2.0, (w / 2 + 0.65, d / 2 + 0.75, h / 2 + 0.5), mat='steel:galv'))
        g.merge(tube((-w / 2 + 0.9, d / 2 + 0.9, 1.4), (-w / 2 + 0.9, d / 2 + 0.9, h - 0.6), 0.32, 'steel:rust', 10))
        for z in zs[1:-1]:
            g.merge(bx(1.0, 0.7, 1.2, (w / 2 + 0.2, d / 2 + 0.95, z + 1.0), mat='steel:galv'))
    return g, [((0, 0, h / 2), (w + 1.0, d + 1.0, h))]


def gallery(L=24.0):
    """Enclosed ore conveyor gallery segment from y=0 to y=-L (forward -Y), 7 x 5.5 m,
    bottom at z=0. Exposed side trusses below the clad hood, belt + ore inside, walkway
    grating along the open lower band, roof ridge."""
    g = Geo()
    W, Hh = 7.0, 5.5
    col = 'steel:slate'
    # bottom chords + deck
    for sx in (-1, 1):
        g.merge(bx(0.5, L, 0.8, (sx * W / 2, -L / 2, 0.4), mat=col))
        g.merge(bx(0.4, L, 0.4, (sx * W / 2, -L / 2, 2.4), mat=col))
    g.merge(bx(W, L, 0.25, (0, -L / 2, 0.85), mat='trim:grating'))
    # truss verticals + diagonals in the open band (z 0.8 .. 2.4)
    bays = int(L / 3)
    for i in range(bays + 1):
        y = -i * L / bays
        for sx in (-1, 1):
            g.merge(bx(0.3, 0.3, 1.6, (sx * W / 2, y, 1.6), mat=col))
            if i < bays:
                y2 = -(i + 1) * L / bays
                a, b = (V((sx * W / 2, y, 0.8)), V((sx * W / 2, y2, 2.4))) if i % 2 == 0 else (V((sx * W / 2, y, 2.4)), V((sx * W / 2, y2, 0.8)))
                g.merge(beam(a, b, 0.22, 0.22, col))
        g.merge(bx(W, 0.35, 0.35, (0, y, 0.25), mat=col))
    # clad hood: walls (corrugated) + roof panels + ridge
    for sx in (-1, 1):
        g.merge(bx(0.12, L, Hh - 2.6, (sx * (W / 2 + 0.05), -L / 2, 2.6 + (Hh - 2.6) / 2), mat='corr:grey'))
        g.merge(bx(0.14, L, 0.5, (sx * (W / 2 + 0.07), -L / 2, 3.2), mat='trim:louvre'))
    for sx in (-1, 1):
        r = bx(W / 2 + 0.5, L, 0.15, (0, 0, 0), mat='corr:grey')
        r.transform(Matrix.Translation(V((sx * W / 4, -L / 2, Hh + 0.35))) @ Matrix.Rotation(sx * -0.2, 4, 'Y'))
        g.merge(r)
    g.merge(bx(0.4, L, 0.3, (0, -L / 2, Hh + 0.75), mat='steel:dark'))
    # belt + ore + idlers
    g.merge(bx(1.8, L, 0.1, (-1.2, -L / 2, 1.9), mat='belt:ore'))
    g.merge(P.prism([(-0.8, 0), (0.8, 0), (0.3, 0.45), (-0.3, 0.45)], L, bevel=0.0, segs=1, mat='heap:ore', axis='Y').move(-1.2, -L / 2, 1.95))
    for i in range(int(L / 3)):
        y = -1.5 - i * 3
        g.merge(bx(2.2, 0.2, 0.9, (-1.2, y, 1.4), mat='steel:dark'))
    # walkway handrail on the inner side
    g.merge(rail_line([(1.6, 0, 0.95), (1.6, -L, 0.95)], h=1.0, post=3.0, r=0.04, mat='steel:railing'))
    # stiffener bands on the clad walls
    for i in range(int(L / 6) + 1):
        y = -i * 6.0
        for sx in (-1, 1):
            g.merge(bx(0.3, 0.3, Hh - 2.4, (sx * (W / 2 + 0.15), y, 2.4 + (Hh - 2.4) / 2), mat='steel:dark'))
    return g, [((0, -L / 2, Hh / 2 + 0.4), (W + 0.6, L, Hh + 0.8))]


def pipe_bent(w=10.0, h=12.0, h2=17.0):
    g = Geo()
    for sx in (-1, 1):
        g.merge(bx(0.6, 0.6, h2, (sx * w / 2, 0, h2 / 2), mat='steel:oxide'))
        g.merge(bx(1.4, 1.4, 1.0, (sx * w / 2, 0, 0.5), mat='concrete:grey', bev=0.06))
        g.merge(beam((sx * w / 2, 0, h - 2.2), (sx * (w / 2 - 2.0), 0, h - 0.3), 0.3, 0.3, 'steel:oxide'))
    for z in (h, h2):
        g.merge(bx(w + 1.2, 0.6, 0.6, (0, 0, z - 0.3), mat='steel:oxide'))
    return g, [((sx * w / 2, 0, h2 / 2), (0.9, 0.9, h2)) for sx in (-1, 1)]


# ============================================================================ STORAGE / TOWERS
def tank(r=14.0, h=20.0, var='bone', stair=True):
    g = Geo()
    segs = 48
    g.merge(P.lathe([(0.0, 0.0), (r, 0.0), (r, h), (r * 0.98, h + 0.2), (r * 0.25, h + r * 0.14), (0.0, h + r * 0.15)], segs, 'steel:' + var))
    for z in [h * i / 6 for i in range(1, 6)]:
        g.merge(P.ring(r + 0.05, r - 0.1, 0.32, segs, bevel=0.0, mat='steel:' + var, z0=z))
    g.merge(P.ring(r + 0.5, r - 0.2, 0.8, segs, bevel=0.0, mat='concrete:dark', z0=-0.2))
    # roof handrail ring (cheap)
    n = 24
    pts = [(math.cos(TAU * i / n) * (r - 0.6), math.sin(TAU * i / n) * (r - 0.6), h + 0.5) for i in range(n + 1)]
    g.merge(rail_line(pts, h=1.1, post=6.0, r=0.05, mat='steel:dark', post_mat='steel:dark'))
    # stair tower + walkway
    if stair:
        a0 = math.radians(-60)
        for k in range(10):
            a = a0 + k * 0.1
            z = h * k / 10
            x, y = math.cos(a) * (r + 1.1), math.sin(a) * (r + 1.1)
            s = bx(2.0, 1.2, 0.15, (0, 0, 0), mat='trim:grating')
            s.transform(Matrix.Translation(V((x, y, z + 1))) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z'))
            g.merge(s)
            g.merge(bx(0.12, 0.12, 2.2, (math.cos(a) * (r + 1.9), math.sin(a) * (r + 1.9), z + 2.0), mat='steel:railing'))
        g.merge(bx(3.0, 3.0, 0.2, (math.cos(a0 + 1.0) * (r + 1.2), math.sin(a0 + 1.0) * (r + 1.2), h + 0.2), mat='trim:grating'))
        # stringers + handrail following the helical stair
        pts_in, pts_out = [], []
        for k in range(11):
            a = a0 + k * 0.1
            z = h * k / 10 + 1.0
            pts_in.append(V((math.cos(a) * (r + 0.45), math.sin(a) * (r + 0.45), z - 0.25)))
            pts_out.append(V((math.cos(a) * (r + 1.75), math.sin(a) * (r + 1.75), z - 0.25)))
        for k in range(10):
            g.merge(beam(pts_out[k], pts_out[k + 1], 0.12, 0.35, 'steel:railing'))
            g.merge(beam(pts_in[k], pts_in[k + 1], 0.12, 0.35, 'steel:dark'))
            g.merge(beam(pts_out[k] + V((0, 0, 1.25)), pts_out[k + 1] + V((0, 0, 1.25)), 0.08, 0.08, 'steel:railing'))
    # nozzles / manholes / pipe stubs
    for a in (0.4, 2.2, 4.1):
        x, y = math.cos(a) * r, math.sin(a) * r
        g.merge(tube((x, y, 1.6), (x * 1.08, y * 1.08, 1.6), 0.7, 'steel:dark', 20))
    g.merge(bx(0.5, 1.2, 0.3, (r + 0.05, 0, h * 0.35), mat='trim:stencil@jp_load').rotate((0, 0, 0)))
    return g, cyl_cols(r + 0.4, 0.0, h + r * 0.12)


def sphere_tank(r=9.0, legs=8):
    g = Geo()
    prof = [(0.0, -r)] + [(r * math.sin(math.pi * i / 16), -r * math.cos(math.pi * i / 16)) for i in range(1, 16)] + [(0.0, r)]
    s = P.lathe(prof, 40, 'steel:bone')
    s.move(0, 0, r + 6)
    g.merge(s)
    g.merge(P.ring(r + 0.1, r - 0.2, 0.4, 40, bevel=0.0, mat='steel:bone', z0=r + 6 - 0.2))
    for i in range(legs):
        a = TAU * i / legs
        x, y = math.cos(a) * r * 0.92, math.sin(a) * r * 0.92
        g.merge(bx(0.8, 0.8, r + 6, (x, y, (r + 6) / 2), mat='steel:grey'))
        g.merge(bx(1.6, 1.6, 0.8, (x, y, 0.4), mat='concrete:grey'))
        a2 = TAU * (i + 1) / legs
        x2, y2 = math.cos(a2) * r * 0.92, math.sin(a2) * r * 0.92
        g.merge(beam((x, y, 1.0), (x2, y2, r + 4.0), 0.25, 0.25, 'steel:grey'))
    g.merge(cheap_ladder(r * 2 + 6, r * 0.7, -r * 0.7, 0, facing=0.8))
    g.merge(bx(3, 3, 0.2, (0, 0, 2 * r + 6.1), mat='trim:grating'))
    return g, cyl_cols(r * 0.98, 6.0 - r * 0.2, 2 * r + 6.0) + [((math.cos(TAU * i / legs) * r * 0.92, math.sin(TAU * i / legs) * r * 0.92, 3.5), (1.0, 1.0, 7.0)) for i in range(legs)]


def band(r_lo, r_hi, z, h, out, segs, mat):
    """Raised band on a (tapering) shell: outer face + top / bottom lips only (no hidden inner
    wall): 6 tris per segment."""
    return P.lathe([(r_lo - 0.02, z), (r_lo + out, z), (r_hi + out, z + h), (r_hi - 0.02, z + h)], segs, mat)


def _ring_rail(g, rr, z, segs, posts=12, h=1.1):
    """Cheap circular guard rail: top + mid rail rings and posts (out-of-bounds stacks)."""
    g.merge(P.ring(rr + 0.05, rr - 0.05, 0.1, segs, bevel=0.0, mat='steel:railing', z0=z + h - 0.1))
    g.merge(P.ring(rr + 0.04, rr - 0.04, 0.08, segs, bevel=0.0, mat='steel:railing', z0=z + h * 0.5))
    for i in range(posts):
        a = TAU * i / posts
        g.merge(bx(0.09, 0.09, h, (math.cos(a) * rr, math.sin(a) * rr, z + h / 2), mat='steel:railing'))


def stack(h=120.0, r0=6.0, r1=3.6, var='dark', glow=True, beacons=True, segs=40, band_step=15.0, band_mat='steel:rust',
          paint=None, plats=(0.45, 0.82), seed=0, cheap_rail=False):
    """Concrete chimney: steel bands (spacing band_step), optional painted day-mark bands in the top
    third (paint = (mat_a, mat_b), random 6-14 m spacing from seed), platforms, beacons, sooted lip."""
    import random as _r
    rnd = _r.Random(seed)
    g = Geo()
    prof = [(0.0, 0.0), (r0 + 0.8, 0.0), (r0 + 0.8, 1.5), (r0, 2.0), (r1, h), (r1 + 0.35, h), (r1 + 0.35, h + 1.2),
            (r1 - 0.3, h + 1.2), (r1 - 0.3, h - 3.0)]
    g.merge(P.lathe(prof, segs, 'concrete:' + var))
    g.merge(P.cylinder(r1 - 0.3, 0.2, segs, bevel=0.0, mat='glow:dim' if glow else 'steel:black', z0=h - 3.0))   # dim flue ember (no HDR disc from above)

    def rad(z):
        return r0 + (r1 - r0) * (z / h)
    if band_step:
        z = band_step * rnd.uniform(0.6, 1.0)
        top = h * (0.6 if paint else 0.97)
        while z < top - 4.0:
            g.merge(band(rad(z), rad(z + 0.6), z, 0.6, 0.25, segs, band_mat))
            z += band_step * rnd.uniform(0.75, 1.25)
    if paint:
        step = rnd.uniform(6.0, 14.0)
        z = h - 14.0
        k = 0
        while z > h * 0.62:
            z0 = z - step * 0.5
            g.merge(P.lathe([(rad(z0) + 0.06, z0), (rad(z) + 0.06, z)], segs, paint[k % 2]))
            z -= step
            k += 1
    # soot band at the top
    g.merge(P.lathe([(r1 + 0.36, h - 14.0), (r1 + 0.36, h + 0.02)], segs, 'concrete:soot'))
    for zf in plats:
        z = h * zf
        rr = rad(z)
        g.merge(P.ring(rr + 1.8, rr - 0.05, 0.3, segs, bevel=0.0, mat='trim:grating', z0=z))
        if cheap_rail:
            _ring_rail(g, rr + 1.7, z + 0.3, segs)
        else:
            n = 16
            pts = [(math.cos(TAU * i / n) * (rr + 1.7), math.sin(TAU * i / n) * (rr + 1.7), z + 0.3) for i in range(n + 1)]
            g.merge(rail_line(pts, h=1.2, post=3.0, r=0.06))
        for k in range(6):
            a = TAU * k / 6 + 0.3
            g.merge(beam((math.cos(a) * rr, math.sin(a) * rr, z - 1.6), (math.cos(a) * (rr + 1.6), math.sin(a) * (rr + 1.6), z - 0.05), 0.2, 0.2, 'steel:dark'))
        if beacons:
            for a in (0.0, math.pi):
                g.merge(beacon(math.cos(a) * (rr + 1.2), math.sin(a) * (rr + 1.2), z + 1.8, 0.8))
    if beacons:
        for a in (0.5, 0.5 + math.pi):
            g.merge(beacon(math.cos(a) * (r1 + 0.1), math.sin(a) * (r1 + 0.1), h + 1.6, 0.9))
    return g, cyl_cols(r0 + 0.8, 0.0, h * 0.5) + cyl_cols((r0 + r1) / 2, h * 0.5, h)


def steel_stack(h=140.0, r=4.2, seed=5, segs=28):
    """Plated steel flue: flanged courses every 7-10 m, three platforms, guy wires to anchor
    blocks, rust-bled shell, sooted lip."""
    import random as _r
    rnd = _r.Random(seed)
    g = Geo()
    prof = [(0.0, 0.0), (r + 1.6, 0.0), (r + 1.6, 1.2), (r + 0.6, 1.6), (r + 0.6, 4.0), (r, 5.0), (r, h), (r + 0.3, h),
            (r + 0.3, h + 0.9), (r - 0.25, h + 0.9), (r - 0.25, h - 3.0)]
    g.merge(P.lathe(prof, segs, 'steel:rust'))
    g.merge(P.cylinder(r - 0.25, 0.2, segs, bevel=0.0, mat='glow:dim', z0=h - 3.0))
    z = 8.0
    while z < h - 3.0:
        g.merge(band(r, r, z, 0.45, 0.22, segs, 'steel:dark'))
        z += rnd.uniform(9.0, 13.0)
    g.merge(P.lathe([(r + 0.32, h - 9.0), (r + 0.32, h + 0.02)], segs, 'concrete:soot'))
    for zf in (0.32, 0.6, 0.9):
        zz = h * zf
        g.merge(P.ring(r + 1.9, r - 0.05, 0.3, segs, bevel=0.0, mat='trim:grating', z0=zz))
        _ring_rail(g, r + 1.8, zz + 0.3, segs, posts=10)
        for k in range(5):
            a = TAU * k / 5 + 0.4
            g.merge(beam((math.cos(a) * r, math.sin(a) * r, zz - 1.5), (math.cos(a) * (r + 1.7), math.sin(a) * (r + 1.7), zz - 0.05), 0.18, 0.18, 'steel:dark'))
    for sx in (-0.3, 0.3):     # ladder stiles (rungs are sub-pixel from the deck)
        g.merge(bx(0.08, 0.08, h * 0.9, (sx, -r - 0.35, h * 0.45), mat='steel:railing'))
    for k in range(3):
        a = TAU * k / 3 + 0.5
        c, si = math.cos(a), math.sin(a)
        for zf in (0.6, 0.9):
            g.merge(beam((c * (r + 0.2), si * (r + 0.2), h * zf), (c * h * 0.4, si * h * 0.4, 1.0), 0.09, 0.09, 'steel:black'))
        g.merge(bxz(3.0, 3.0, 1.6, c * h * 0.4, si * h * 0.4, 0.0, mat='concrete:grey', bev=0.06))
    g.merge(beacon(r * 0.7, 0, h + 1.5, 0.8))
    g.merge(beacon(-r - 1.2, 0, h * 0.6 + 2.0, 0.7))
    return g


def twin_flue(h=160.0, rf=2.6, seed=6, segs=20):
    """Two steel flues inside a tapering 4-leg lattice tower with platforms every bay."""
    g = Geo()
    tw0, tw1 = 7.0, 4.2
    for sx in (-1, 1):
        x = sx * (rf + 0.6)
        g.merge(P.lathe([(0.0, 0.0), (rf, 0.0), (rf, h + 8.0), (rf + 0.25, h + 8.0), (rf + 0.25, h + 8.8), (rf - 0.2, h + 8.8),
                         (rf - 0.2, h + 6.0)], segs, 'steel:grey').move(x, 0, 0))
        g.merge(P.lathe([(rf + 0.26, h - 2.0), (rf + 0.26, h + 8.02)], segs, 'concrete:soot').move(x, 0, 0))
        g.merge(P.cylinder(rf - 0.2, 0.2, segs, bevel=0.0, mat='glow:dim', z0=h + 6.0).move(x, 0, 0))
    nb = int(h / 16)
    for i in range(nb + 1):
        z = h * i / nb
        a = tw0 + (tw1 - tw0) * i / nb
        for k in range(4):
            c0 = [(-1, -1), (1, -1), (1, 1), (-1, 1)][k]
            c1 = [(-1, -1), (1, -1), (1, 1), (-1, 1)][(k + 1) % 4]
            g.merge(beam((c0[0] * a, c0[1] * a, z), (c1[0] * a, c1[1] * a, z), 0.35, 0.35, 'steel:slate'))
            if i < nb:
                a2 = tw0 + (tw1 - tw0) * (i + 1) / nb
                z2 = h * (i + 1) / nb
                g.merge(beam((c0[0] * a, c0[1] * a, z), (c0[0] * a2, c0[1] * a2, z2), 0.6, 0.6, 'steel:slate'))
                if i % 2 == k % 2:
                    g.merge(beam((c0[0] * a, c0[1] * a, z), (c1[0] * a2, c1[1] * a2, z2), 0.28, 0.28, 'steel:slate'))
                else:
                    g.merge(beam((c1[0] * a, c1[1] * a, z), (c0[0] * a2, c0[1] * a2, z2), 0.28, 0.28, 'steel:slate'))
        if i % 3 == 2:
            g.merge(bxz(2 * a + 1.2, 2 * a + 1.2, 0.25, 0, 0, z, mat='trim:grating'))
    g.merge(bxz(2 * tw0 + 2.0, 2 * tw0 + 2.0, 1.2, 0, 0, 0.0, mat='concrete:grey', bev=0.08))
    g.merge(beacon(tw1, tw1, h + 0.8, 0.8))
    g.merge(beacon(-tw1, -tw1, h + 0.8, 0.8))
    g.merge(beacon(tw0 * 0.8, -tw0 * 0.8, h * 0.5, 0.7))
    return g


def cooling_tower(h=140.0, rb=55.0, rt=34.0, rw=30.0):
    """Hyperbolic natural-draught cooling tower with the X-column ring at its base."""
    g = Geo()
    zt = h * 0.78  # throat height
    prof_o, prof_i = [], []
    N = 18
    for i in range(N + 1):
        z = 9.0 + (h - 9.0) * i / N
        if z < zt:
            t = (zt - z) / (zt - 9.0)
            r = rw + (rb - rw) * t ** 1.6
        else:
            t = (z - zt) / (h - zt)
            r = rw + (rt - rw) * t ** 1.4
        prof_o.append((r, z))
        prof_i.append((r - 0.6, z))
    prof = prof_o + [(prof_o[-1][0] + 0.2, h + 0.6)] + list(reversed(prof_i))
    g.merge(P.lathe(prof, 48, 'concrete:shell'))
    # ring beam at the lip + inspection platform / ladder hint, aviation beacons on the lip
    g.merge(P.ring(rt + 0.9, rt - 0.2, 1.4, 64, bevel=0.0, mat='concrete:soot', z0=h - 0.8))
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        g.merge(beacon(math.cos(a) * (rt + 0.4), math.sin(a) * (rt + 0.4), h + 1.4, 1.0))
    g.merge(P.ring(rb + 0.6, rb - 0.4, 1.2, 64, bevel=0.0, mat='concrete:grey', z0=9.0))
    ncol = 40
    for i in range(ncol):
        a = TAU * i / ncol
        a2 = TAU * (i + 1) / ncol
        p0 = V((math.cos(a) * rb, math.sin(a) * rb, 0.0))
        p1 = V((math.cos(a2) * rb, math.sin(a2) * rb, 9.2))
        p2 = V((math.cos(a2) * rb, math.sin(a2) * rb, 0.0))
        p3 = V((math.cos(a) * rb, math.sin(a) * rb, 9.2))
        g.merge(beam(p0, p1, 0.9, 0.9, 'concrete:grey'))
        g.merge(beam(p2, p3, 0.9, 0.9, 'concrete:grey'))
    g.merge(P.ring(rb + 1.5, rb - 3.0, 1.0, 64, bevel=0.0, mat='concrete:dark', z0=-0.5))
    g.merge(P.cylinder(rb - 3.0, 0.4, 64, bevel=0.0, mat='sea', z0=0.2))
    return g


# ============================================================================ BLAST FURNACE
def blast_furnace():
    """~95 m blast furnace: banded shell, 4-column braced tower with decks, top house,
    uptakes/downcomer to the dust catcher, bleeders, bustle main, skip incline. Local
    origin at the furnace centre; skip incline runs toward +X; dust catcher at -X."""
    g = Geo()
    sh = 'steel:dark'
    # shell
    prof = [(0.0, 0.0), (9.0, 0.0), (9.0, 12.0), (10.2, 17.0), (10.2, 20.0), (7.2, 46.0), (6.2, 50.0), (4.0, 55.0),
            (3.0, 58.0), (0.0, 58.0)]
    g.merge(P.lathe(prof, 48, sh))
    for z in range(22, 46, 3):
        t = (z - 20.0) / 26.0
        r = 10.2 + (7.2 - 10.2) * t
        r2 = 10.2 + (7.2 - 10.2) * ((z + 0.5 - 20.0) / 26.0)
        g.merge(band(r, r2, z, 0.5, 0.25, 48, 'steel:rust'))
    for z in (2.0, 5.0, 8.0, 11.0):
        g.merge(band(9.0, 9.0, z, 0.8, 0.35, 48, 'steel:rust'))
    # bustle main + tuyere stocks
    g.merge(P.torus(12.5, 1.3, 40, 8, mat='steel:rust').move(0, 0, 19.5))
    for i in range(16):
        a = TAU * i / 16
        c, s = math.cos(a), math.sin(a)
        g.merge(tube((c * 12.3, s * 12.3, 18.5), (c * 9.4, s * 9.4, 14.0), 0.35, 'steel:rust', 10))
    # tap hole glow + runner trough stubs
    g.merge(bx(1.6, 0.4, 1.2, (9.1, 0, 1.2), mat='glow:hot').rotate((0, 0, 0)))
    # support tower: 4 big columns + decks + bracing
    cw = 15.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bx(2.0, 2.0, 66.0, (sx * cw, sy * cw, 33.0), mat='steel:slate'))
            g.merge(bx(3.2, 3.2, 1.5, (sx * cw, sy * cw, 0.75), mat='concrete:grey', bev=0.1))
    for z in (14.0, 26.0, 38.0, 50.0, 62.0):
        for k in range(4):
            a = k * math.pi / 2
            c, s = round(math.cos(a)), round(math.sin(a))
            g.merge(bx(2 * cw + 2 if c == 0 else 1.2, 2 * cw + 2 if s == 0 else 1.2, 1.4,
                       (c * cw, s * cw, z), mat='steel:slate'))
        # deck ring (grating) between shell and columns (4 slabs)
        for k in range(4):
            a = k * math.pi / 2
            c, s = math.cos(a), math.sin(a)
            g.merge(bx(abs(c) * 6 + abs(s) * (2 * cw), abs(s) * 6 + abs(c) * (2 * cw), 0.35,
                       (c * (cw - 3), s * (cw - 3), z + 0.8), mat='trim:grating'))
        edge = [(-cw, -cw, z + 1.0), (cw, -cw, z + 1.0), (cw, cw, z + 1.0), (-cw, cw, z + 1.0), (-cw, -cw, z + 1.0)]
        g.merge(rail_line(edge, h=1.2, post=3.0, r=0.07))
    zs = [2.0, 14.0, 26.0, 38.0, 50.0, 62.0]
    for i in range(len(zs) - 1):
        z0, z1 = zs[i] + 0.8, zs[i + 1] - 0.8
        for sx in (-1, 1):
            x = sx * cw
            g.merge(xbrace(V((x, -cw, z0)), V((x, cw, z0)), V((x, cw, z1)), V((x, -cw, z1)), 0.6, 'steel:slate'))
        g.merge(xbrace(V((-cw, cw, z0)), V((cw, cw, z0)), V((cw, cw, z1)), V((-cw, cw, z1)), 0.6, 'steel:slate'))
    # top house
    g.merge(bxz(14, 12, 9, 0, 0, 62.0, mat='corr:oxide'))
    g.merge(bx(14.4, 12.4, 0.6, (0, 0, 71.3), mat='steel:dark'))
    g.merge(bx(14.2, 0.1, 1.2, (0, -6.06, 66), mat='trim:window'))
    # uptakes -> downcomer
    ups = []
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        p0 = V((c * 3.4, s * 3.4, 56.0))
        p1 = V((c * 4.2, s * 4.2, 80.0))
        g.merge(tube(p0, p1, 1.2, 'steel:rust', 20))
        ups.append(p1)
        # bleeder valve + cap
        g.merge(tube(p1, p1 + V((0, 0, 7.0)), 0.8, 'steel:dark', 16))
        g.merge(P.cylinder(1.3, 0.8, 16, bevel=0.0, mat='steel:dark').move(p1 + V((0, 0, 7.4))))
    hub = V((-2.0, 0.0, 82.0))
    for p in ups:
        g.merge(tube(p, hub, 1.1, 'steel:rust', 20))
    dc_top = V((-12.0, 0.0, 80.0))
    dcx = -38.0
    g.merge(P.sweep([hub, dc_top, V((-24.0, 0, 70.0)), V((dcx + 3, 0, 36.0))], 1.9, 24, mat='steel:rust', smooth_path=True, subdiv=8))
    # dust catcher on legs
    g.merge(P.lathe([(0.0, 14.0), (2.0, 14.0), (7.5, 22.0), (7.5, 34.0), (5.0, 38.0), (0.0, 39.0)], 32, 'steel:slate').move(dcx, 0, 0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.merge(bx(1.0, 1.0, 22.0, (dcx + sx * 5.2, sy * 5.2, 11.0), mat='steel:slate'))
    g.merge(tube((dcx, 0, 18.0), (dcx, 22.0, 18.0), 1.6, 'steel:rust', 20))
    g.merge(tube((dcx, 22.0, 18.0), (dcx, 22.0, 0.0), 1.6, 'steel:rust', 20))
    # skip incline truss (to +X)
    top = V((10.0, 0.0, 66.0))
    foot = V((72.0, 0.0, 0.0))
    d = foot - top
    from farkit import _truss2        # plain-box truss (iwkit's bevelled one cost ~5k tris here)
    _truss2(g, top, foot, 4.0, 6.0, 16, 0.6, 0.35, mat='steel:slate')
    for t in (0.3, 0.55, 0.8):
        p = top + d * t
        g.merge(bx(1.2, 6.0, p.z, (p.x, 0, p.z / 2), mat='steel:slate'))
    g.merge(bxz(4.0, 3.0, 3.0, top.x + d.x * 0.42, 0, top.z + d.z * 0.42 + 2.5, mat='steel:yellow'))
    # beacons
    for p in ups[:2]:
        g.merge(beacon(p.x, p.y, p.z + 8.6, 1.0))
    g.merge(beacon(0, 0, 72.2, 1.0))
    cols = [((0, 0, 29.0), (21.0, 21.0, 58.0)),
            ((0, 0, 33.0), (2 * cw + 3, 2 * cw + 3, 66.0)),
            ((dcx, 0, 26.0), (15.0, 15.0, 26.0))]
    return g, cols


def stove(h=42.0, r=5.5):
    """Cowper hot-blast stove: banded shell (stiffener ring every 3 m), 8 vertical ribs, mid and
    top platforms with railings, caged ladder, hot-blast valve + stub main, dome with a manhole
    and top platform."""
    g = Geo()
    prof = [(0.0, 0.0), (r + 0.6, 0.0), (r + 0.6, 1.2), (r, 1.4), (r, h)]
    for i in range(1, 9):
        a = (math.pi / 2) * i / 8
        prof.append((r * math.cos(a), h + r * 0.9 * math.sin(a)))
    prof[-1] = (0.0, h + r * 0.9)
    g.merge(P.lathe(prof, 32, 'steel:grey'))
    for z in range(3, int(h), 3):
        hh = 0.3 if z % 6 else 0.5
        g.merge(band(r, r, z, hh, 0.22, 32, 'steel:rust' if z % 6 else 'steel:dark'))
    for k in range(8):
        a = TAU * k / 8 + 0.2
        g.merge(bx(0.35, 0.35, h - 2.0, (math.cos(a) * (r + 0.12), math.sin(a) * (r + 0.12), 1.4 + (h - 2.0) / 2), mat='steel:dark'))
    for zp in (h * 0.42, h - 2.0):
        g.merge(P.ring(r + 2.0, r - 0.1, 0.35, 32, bevel=0.0, mat='trim:grating', z0=zp))
        n = 16
        pts = [(math.cos(TAU * i / n) * (r + 1.8), math.sin(TAU * i / n) * (r + 1.8), zp + 0.35) for i in range(n + 1)]
        g.merge(rail_line(pts, h=1.1, post=3.0, r=0.06))
        for k in range(6):
            a = TAU * k / 6
            g.merge(beam((math.cos(a) * r, math.sin(a) * r, zp - 1.6), (math.cos(a) * (r + 1.8), math.sin(a) * (r + 1.8), zp - 0.05), 0.2, 0.2, 'steel:dark'))
    g.merge(tube((r - 0.3, 0, 14.0), (r + 5.5, 0, 14.0), 1.2, 'steel:rust', 20))
    g.merge(P.ring(1.6, 1.0, 0.5, 20, bevel=0.0, mat='steel:dark').rotate((0, 90, 0)).move(r + 2.2, 0, 14.0))
    g.merge(bxz(2.2, 2.6, 2.6, r + 3.6, 0, 15.0, mat='steel:dark'))                      # hot-blast valve
    g.merge(tube((-r + 0.3, 0, 4.0), (-r - 3.0, 0, 4.0), 0.8, 'steel:rust', 14))
    g.merge(P.cylinder(0.9, 0.6, 14, bevel=0.0, mat='steel:dark', z0=h + r * 0.9 - 0.3))  # dome manhole
    g.merge(bx(3.0, 3.0, 0.2, (0, 0, h + r * 0.9 + 0.35), mat='trim:grating'))
    g.merge(cheap_ladder(h - 2.0, 0, -r - 0.3, 0, facing=0.0, rung=0.9, hoop=3.0))
    g.merge(cheap_ladder(r * 0.9 + 2.4, 0, -r * 0.55, h - 2.0, facing=0.0, cage=False, rung=0.9))
    return g, cyl_cols(r + 0.3, 0.0, h + r * 0.9)


# ============================================================================ STS GANTRY CRANE
def sts_crane():
    """Rail-mounted ship-to-shore gantry crane. Rails along local X (legs 18 m apart), gauge
    30 m along Y; the boom reaches out along local -Y (over the water) to y=-78, backreach
    to y=+26. Portal girder at 44 m, apex 82 m."""
    g = Geo()
    y_l, y_w = 15.0, -15.0      # landside / waterside legs
    lx = 9.0
    col = 'steel:crane'
    zb = 44.0
    for sx in (-1, 1):
        for y in (y_l, y_w):
            g.merge(bx(1.8, 1.8, zb, (sx * lx, y, zb / 2), mat=col))
            g.merge(bx(3.6, 2.6, 2.2, (sx * lx, y, 1.1), mat='steel:dark'))
            for dx in (-1.0, 1.0):
                g.merge(P.cylinder(0.5, 0.4, 16, bevel=0.0, mat='steel:rail').rotate((90, 0, 0)).move(sx * lx + dx, y, 0.5))
        # sill beam + portal side frames
        g.merge(bx(1.4, 30.0, 1.6, (sx * lx, 0, 7.0), mat=col))
        g.merge(xbrace(V((sx * lx, y_w, 8.0)), V((sx * lx, y_l, 8.0)), V((sx * lx, y_l, zb - 3)), V((sx * lx, y_w, zb - 3)), 0.7, col))
        # boom / girder (box girder 2.8 m)
        g.merge(bx(1.6, 104.0, 3.0, (sx * lx, -26.0, zb + 1.5), mat=col))
        g.merge(bx(1.62, 104.0, 0.25, (sx * lx, -26.0, zb + 3.1), mat='steel:dark'))
        # apex A-frame legs
        g.merge(beam((sx * lx, y_l - 1, zb + 3), (sx * (lx - 2.5), 2.0, 82.0), 1.3, 1.3, col))
        g.merge(beam((sx * lx, y_w + 1, zb + 3), (sx * (lx - 2.5), 2.0, 82.0), 1.3, 1.3, col))
        # stays
        g.merge(beam((sx * (lx - 2.5), 2.0, 81.0), (sx * lx, -76.0, zb + 3.0), 0.35, 0.35, 'steel:dark'))
        g.merge(beam((sx * (lx - 2.5), 2.0, 81.0), (sx * lx, -40.0, zb + 3.0), 0.35, 0.35, 'steel:dark'))
        g.merge(beam((sx * (lx - 2.5), 2.0, 81.0), (sx * lx, 26.0, zb + 3.0), 0.45, 0.45, 'steel:dark'))
    # connection detail: bolted gusset plates where the legs meet the sill beam, the portal
    # girder and the A-frame; stiffener ribs every 4 m up the legs (no members passing through
    # each other unconnected)
    for sx in (-1, 1):
        for y in (y_l, y_w):
            for (zz, sz) in ((7.0, 2.6), (zb - 1.6, 3.2), (zb + 3.4, 2.4)):
                for f in (-1, 1):
                    g.merge(bx(0.06, sz, sz, (sx * lx + f * 0.95, y - (1.4 if y > 0 else -1.4) * 0.0, zz), mat='trim:bolted'))
            for k in range(1, int(zb / 4.0)):
                g.merge(bx(2.1, 2.1, 0.18, (sx * lx, y, k * 4.0), mat=col))
            g.merge(bx(2.3, 2.3, 0.5, (sx * lx, y, zb - 0.25), mat='steel:dark'))
        for yy in (-60.0, -30.0, 0.0, 20.0):
            g.merge(bx(0.06, 2.2, 2.4, (sx * (lx + 0.83), yy, zb + 1.5), mat='trim:bolted'))
            g.merge(bx(0.06, 2.2, 2.4, (sx * (lx - 0.83), yy, zb + 1.5), mat='trim:bolted'))
    # cross beams (portal)
    for y in (y_l, y_w, 26.0, -76.0, -45.0):
        g.merge(bx(2 * lx + 1.6, 1.4, 1.8, (0, y, zb + 1.2), mat=col))
    g.merge(bx(2 * lx - 3, 1.6, 1.6, (0, 2.0, 82.0), mat=col))
    for y in (y_l, y_w):
        g.merge(bx(2 * lx, 1.0, 1.6, (0, y, 9.0), mat=col))
        g.merge(xbrace(V((-lx, y, 10.0)), V((lx, y, 10.0)), V((lx, y, zb - 2)), V((-lx, y, zb - 2)), 0.6, col))
    # machinery house on the backreach, trolley + cab + spreader on the boom
    import megakit as MK
    g.merge(MK.crane_house(14.0, 12.0, 7.0, var='cream', seed=5).move(0, 19.0, zb + 3.0))
    # hazard-striped leg bases (worn), cable festoon from the house to the trolley
    for sx in (-1, 1):
        for y in (y_l, y_w):
            for f in (-1, 1):
                g.merge(bx(1.86, 0.06, 3.0, (sx * lx, y + f * 0.93, 3.7), mat='trim:hazard'))
                g.merge(bx(0.06, 1.86, 3.0, (sx * lx + f * 0.93, y, 3.7), mat='trim:hazard'))
    for k in range(6):
        y0 = 12.0 - k * 7.0
        g.merge(P.cable((lx - 0.6, y0, zb + 3.2), (lx - 0.6, y0 - 7.0, zb + 3.2), sag=1.4, radius=0.07, segs=6, mat='steel:black', n=6))
        g.merge(bx(0.3, 0.3, 0.5, (lx - 0.6, y0, zb + 3.3), mat='steel:dark'))
    ty = -30.0
    g.merge(bxz(2 * lx + 1.0, 7.0, 3.0, 0, ty, zb + 3.2, mat='steel:dark'))
    g.merge(bxz(4.0, 3.5, 3.2, -3.0, ty + 1.0, zb - 3.4, mat='steel:bone'))
    g.merge(bx(4.05, 0.1, 1.6, (-3.0, ty - 0.8, zb - 1.6), mat='trim:window'))
    for sx in (-1.2, 1.2):
        g.merge(bx(0.12, 0.12, 20.0, (sx, ty, zb - 10.0), mat='steel:dark'))
    g.merge(bxz(12.5, 2.6, 1.4, 0, ty, zb - 21.4, mat='steel:yellow'))
    # lights + beacons
    for y in (-10.0, -30.0, -50.0, -70.0, 5.0):
        g.merge(flood(0, y, zb - 0.6, 0.0))
    g.merge(beacon(0, 2.0, 83.4, 0.9))
    g.merge(beacon(0, -77.0, zb + 3.6, 0.8))
    # ladders
    g.merge(cheap_ladder(zb - 1, lx + 1.1, y_l, 0, facing=math.pi / 2))
    cols = []
    for sx in (-1, 1):
        for y in (y_l, y_w):
            cols.append(((sx * lx, y, zb / 2), (2.4, 2.4, zb)))
        cols.append(((sx * lx, 0, 7.0), (1.6, 30.0, 1.8)))
        cols.append(((sx * lx, -26.0, zb + 1.5), (1.8, 104.0, 3.2)))
    cols.append(((0, 19.0, zb + 6.7), (14.0, 12.0, 7.0)))
    cols.append(((0, ty, zb + 4.7), (2 * lx + 1, 7.0, 3.0)))
    return g, cols


# ============================================================================ CLUTTER (foreground density)
def _rnd(seed):
    import random
    return random.Random(seed)


def rubble(seed=1, s=1.0):
    """Broken concrete slabs, rebar and ash dust, ~7 m across, 2.2 m tall."""
    r = _rnd(seed)
    g = Geo()
    for i in range(24):
        w, d, h = r.uniform(0.4, 2.8) * s, r.uniform(0.35, 2.2) * s, r.uniform(0.2, 0.55) * s
        b = bx(w, d, h, (0, 0, 0), mat=r.choice(['concrete', 'concrete:grey', 'concrete:dark']), bev=0.05)
        a = r.uniform(0, TAU)
        rr = (r.random() ** 0.7) * 3.6 * s
        b.transform(Matrix.Translation(V((math.cos(a) * rr, math.sin(a) * rr, r.uniform(0.1, 0.6) * s))) @
                    Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @ Matrix.Rotation(r.uniform(-0.35, 0.35), 4, 'X') @
                    Matrix.Rotation(r.uniform(-0.5, 0.5), 4, 'Y'))
        g.merge(b)
    for i in range(9):   # bent rebar sticking out of the broken slabs (thin, dark rust)
        a = r.uniform(0, TAU)
        p0 = V((math.cos(a) * 1.5 * s, math.sin(a) * 1.5 * s, 0.5 * s))
        p1 = p0 + V((r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(0.4, 0.9))) * s
        p2 = p1 + V((r.uniform(-0.9, 0.9), r.uniform(-0.9, 0.9), r.uniform(-0.3, 0.4))) * s
        g.merge(P.sweep([p0, p1, p2], 0.028, 5, mat='steel:rail', smooth_path=True, subdiv=2))
    return g, [((0, 0, 0.55 * s), (5.2 * s, 5.2 * s, 1.1 * s))]


def scrap_pile(seed=2):
    """Heap of cut plates, I-beams and pipe offcuts, ~9 m across."""
    r = _rnd(seed)
    g = Geo()
    for i in range(18):
        kind = r.random()
        a = r.uniform(0, TAU)
        rr = r.uniform(0, 3.2)
        M = (Matrix.Translation(V((math.cos(a) * rr, math.sin(a) * rr, r.uniform(0.6, 2.0)))) @ Matrix.Rotation(r.uniform(0, TAU), 4, 'Z') @
             Matrix.Rotation(r.uniform(-0.7, 0.7), 4, 'X') @ Matrix.Rotation(r.uniform(-0.4, 0.4), 4, 'Y'))
        if kind < 0.45:
            b = bx(r.uniform(2, 4.5), r.uniform(1.2, 2.5), 0.08, mat=r.choice(['steel:rust', 'steel:oxide', 'steel:grey']))
        elif kind < 0.75:
            b = P.girder_i(r.uniform(3, 6), h=0.5, w=0.3, mat='steel:rust')
        else:
            b = P.lathe([(0.35, -1.5), (0.42, -1.5), (0.42, 1.5), (0.35, 1.5), (0.35, -1.5)], 16, 'steel:rust').rotate((0, 90, 0))
        b.transform(M)
        g.merge(b)
    return g, [((0, 0, 0.9), (6.5, 6.5, 1.8))]


def drums(seed=3, n=9):
    r = _rnd(seed)
    g = Geo()
    for i in range(n):
        x, y = r.uniform(-2.2, 2.2), r.uniform(-1.6, 1.6)
        col = r.choice(['steel:blue', 'steel:red', 'steel:rust', 'steel:yellow', 'steel:green'])
        if r.random() < 0.2:
            d = P.lathe([(0.0, -0.45), (0.3, -0.45), (0.3, 0.45), (0.0, 0.45)], 16, col).rotate((90, 0, r.uniform(0, 180))).move(x, y, 0.3)
        else:
            d = P.lathe([(0.0, 0.0), (0.3, 0.0), (0.3, 0.9), (0.0, 0.9)], 16, col).move(x, y, 0)
        g.merge(d)
    return g


def cable_drum(seed=4):
    g = Geo()
    for yy in (-0.9, 0.9):
        g.merge(P.cylinder(1.8, 0.12, 32, bevel=0.0, mat='steel:oxide').rotate((90, 0, 0)).move(0, yy, 1.8))
    g.merge(P.cylinder(1.25, 1.7, 32, bevel=0.0, mat='steel:black').rotate((90, 0, 0)).move(0, 0, 1.8))
    g.merge(bx(3.4, 2.4, 0.2, (0, 0, 0.1), mat='steel:rust'))
    return g, [((0, 0, 1.8), (3.6, 2.0, 3.6))]


def plate_stack(seed=5):
    r = _rnd(seed)
    g = Geo()
    z = 0.0
    for i in range(r.randint(5, 9)):
        t = r.uniform(0.08, 0.2)
        b = bx(r.uniform(5.5, 7.0), r.uniform(2.0, 2.6), t, (r.uniform(-0.2, 0.2), r.uniform(-0.1, 0.1), z + t / 2), mat='steel:rust')
        g.merge(b)
        z += t
        if i % 3 == 2:
            for x in (-2.0, 2.0):
                g.merge(bx(0.2, 2.4, 0.2, (x, 0, z + 0.1), mat='steel:dark'))
            z += 0.2
    return g, [((0, 0, z / 2), (7.0, 2.6, z))]


def wreck_hauler(seed=6):
    """Burnt-out mining haul truck (mech-scale foreground prop), 11 m, forward = -Y."""
    g = Geo()
    # chassis + axles + wheels
    g.merge(bx(3.2, 10.0, 0.9, (0, 0, 1.7), mat='steel:black'))
    for y in (-3.6, 3.0):
        for x in (-1.9, 1.9):
            w = P.lathe([(0.0, -0.55), (1.35, -0.55), (1.45, -0.3), (1.45, 0.3), (1.35, 0.55), (0.0, 0.55)], 20, 'steel:black')
            w.rotate((0, 90, 0)).move(x * (1.0 if y < 0 else 1.05), y, 1.45)
            g.merge(w)
    # cab (front left) burnt, dump bed tilted up
    g.merge(bxz(2.2, 2.6, 2.4, -0.9, -4.0, 2.1, mat='steel:rust'))
    g.merge(bxz(2.3, 0.1, 1.0, -0.9, -5.32, 3.2, mat='trim:window'))
    g.merge(bxz(3.4, 1.6, 1.4, 0.0, -4.2, 2.1, mat='steel:black'))
    bed = merge(bx(4.2, 7.0, 0.25, (0, 0, 0), mat='steel:rust'),
                bx(0.25, 7.0, 2.2, (2.0, 0, 1.1), mat='steel:rust'), bx(0.25, 7.0, 2.2, (-2.0, 0, 1.1), mat='steel:rust'),
                bx(4.2, 0.25, 2.8, (0, -3.4, 1.4), mat='steel:rust'))
    bed.transform(Matrix.Translation(V((0, 1.4, 2.4))) @ Matrix.Rotation(0.35, 4, 'X') @ Matrix.Translation(V((0, 2.0, 0))))
    g.merge(bed)
    g.merge(beam((0.8, 0.5, 2.3), (0.8, 2.6, 4.2), 0.3, 0.3, 'steel:dark'))
    return g, [((0, 0, 2.3), (4.4, 11.0, 4.6))]


def transformer():
    g = Geo()
    g.merge(bxz(4.0, 2.6, 3.2, mat='steel:green'))
    for sx in (-1, 1):
        for i in range(9):
            g.merge(bxz(0.06, 2.0, 2.4, sx * (2.1 + 0.12 * (i % 3)), -0.9 + i * 0.22, 0.4, mat='steel:green'))
    for x in (-1.2, 0.0, 1.2):
        g.merge(P.lathe([(0.0, 0.0), (0.18, 0.0), (0.14, 0.4), (0.18, 0.5), (0.12, 0.9), (0.16, 1.0), (0.0, 1.1)], 12, 'steel:bone').move(x, 0.6, 3.2))
    g.merge(bxz(4.4, 3.0, 0.4, mat='concrete:grey'))
    return g, [((0, 0, 2.0), (4.6, 3.2, 4.0))]


def ore_bridge(span=128.0, h=40.0):
    """Rail-mounted ore stocking bridge spanning the stockpile: twin box-truss girders at
    `h`, rigid A-frame leg at -X, pendulum leg at +X, cantilevers, trolley + grab, machinery
    house, walkways. Rails run along local Y."""
    g = Geo()
    col = 'steel:crane'
    L = span + 28.0
    x0 = -L / 2
    from farkit import _truss2        # plain-box truss: the bevelled iwkit truss cost ~16k tris here
    for y in (-4.5, 4.5):
        _truss2(g, (x0, y, h + 3.5), (x0 + L, y, h + 3.5), 7.0, 1.6, int(L / 6), 0.7, 0.4, mat=col)
    for x in [x0 + i * L / 12 for i in range(13)]:
        g.merge(bx(0.8, 10.6, 0.8, (x, 0, h + 0.3), mat=col))
        g.merge(bx(0.8, 10.6, 0.8, (x, 0, h + 6.8), mat=col))
    g.merge(bx(L, 2.0, 0.3, (0, 0, h + 7.4), mat='trim:grating'))
    g.merge(rail_line([(x0, -1.1, h + 7.55), (x0 + L, -1.1, h + 7.55)], h=1.1, post=3.0, r=0.06))
    g.merge(rail_line([(x0, 1.1, h + 7.55), (x0 + L, 1.1, h + 7.55)], h=1.1, post=3.0, r=0.06))
    xa, xb = -span / 2, span / 2
    # rigid A-frame leg
    for y in (-4.5, 4.5):
        for yy in (-9.0, 9.0):
            g.merge(beam((xa, yy, 1.6), (xa, y, h), 1.6, 1.6, col))
    g.merge(bx(2.4, 22.0, 3.2, (xa, 0, 1.6), mat='steel:dark'))
    g.merge(xbrace(V((xa, -8.0, 4.0)), V((xa, 8.0, 4.0)), V((xa, 4.0, h - 4)), V((xa, -4.0, h - 4)), 0.6, col))
    # pendulum leg
    for y in (-4.5, 4.5):
        g.merge(beam((xb, y * 1.4, 1.6), (xb, y, h), 1.4, 1.4, col))
    g.merge(bx(2.4, 16.0, 3.2, (xb, 0, 1.6), mat='steel:dark'))
    for x in (xa, xb):
        for yy in (-8.5, -5.5, 5.5, 8.5):
            g.merge(P.cylinder(0.7, 0.5, 16, bevel=0.0, mat='steel:rail').rotate((0, 90, 0)).move(x, yy, 0.7))
    # machinery house + trolley + grab
    import megakit as MK
    g.merge(MK.crane_house(12.0, 9.0, 5.5, var='cream', seed=7).move(xa + 12.0, 0, h + 7.4))
    tx = 18.0
    g.merge(bxz(8.0, 11.0, 3.5, tx, 0, h + 7.5, mat='steel:dark'))
    g.merge(bxz(8.4, 0.08, 1.0, tx, -5.55, h + 8.4, mat='trim:hazard2'))
    g.merge(bxz(3.0, 2.4, 1.4, tx - 1.5, 2.0, h + 11.0, mat='steel:galv'))
    for k in range(5):
        x0_ = xa + 20.0 + k * 5.0
        g.merge(P.cable((x0_, 4.2, h + 7.6), (x0_ + 5.0, 4.2, h + 7.6), sag=1.2, radius=0.06, segs=6, mat='steel:black', n=6))
    g.merge(bxz(3.6, 3.2, 3.0, tx - 1.0, -3.5, h - 3.2, mat='steel:bone'))
    g.merge(bx(3.65, 0.1, 1.4, (tx - 1.0, -5.12, h - 1.6), mat='trim:window'))
    for dy in (-1.0, 1.0):
        g.merge(bx(0.1, 0.1, 18.0, (tx + 1.5, dy, h - 8.0), mat='steel:dark'))
    grab = P.lathe([(0.0, 0.0), (2.2, 1.2), (2.4, 3.2), (1.0, 4.4), (0.4, 5.0), (0.0, 5.0)], 16, 'steel:dark')
    g.merge(grab.move(tx + 1.5, 0, h - 21.5))
    for x in (xa + 6.0, 0.0, xb - 6.0, x0 + 2.0, x0 + L - 2.0):
        g.merge(flood(x, -5.6, h - 0.4, 0.0))
    g.merge(beacon(xa + 12.0, 0, h + 13.2, 0.8))
    g.merge(beacon(x0 + 1.0, 0, h + 7.8, 0.6))
    g.merge(beacon(x0 + L - 1.0, 0, h + 7.8, 0.6))
    g.merge(cheap_ladder(h, xa + 1.6, 9.0, 0.0, facing=math.pi / 2))
    cols = [((xa, 0, h / 2), (3.0, 20.0, h)), ((xb, 0, h / 2), (3.0, 14.0, h)), ((0, 0, h + 3.7), (L, 11.0, 7.8)),
            ((xa + 12.0, 0, h + 10.0), (12.0, 9.0, 5.0))]
    return g, cols
