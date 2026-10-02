"""blender/arena/buildings.py - brutalist blocks, sheds, walls, quay, channels, heaps, ship.

Same conventions as pieces.py (Blender coords, local origin at the base centre, semantic
materials, collider lists)."""
import math

from mathutils import Matrix, Vector

from akit import P, Geo, TAU
from pieces import V, beacon, beam, bx, bxz, cheap_ladder, flood, merge, rail_line, tube, xbrace
from megakit import side_decal, wall_decal


def _noise(seed):
    import random
    r = random.Random(seed)
    return r


# ============================================================================ BRUTALIST BLOCK
def _facade(g, r, w, off, h, cv, k, floors, fh, z0f, pil, band_h, lit_cols, doors_here, rv=0.35,
            windows=True, top=None, win_every=1):
    """One board-formed concrete facade (authored along X, facing -Y at y=-off, then rotated to
    face k): recessed window bands with 0.35 m reveals between full-height pilasters, precast
    sills + head bands (spandrels), steel mullions, clustered lit panes, sill drip streaks,
    rust runs from the coping, base soot/splash band. Doors are cut out of the ground floor."""
    f = Geo()
    top = h if top is None else top
    n = max(1, int(round(w / pil)))
    bay = w / n
    xs = [-w / 2 + i * bay for i in range(n + 1)]
    yf = -off                       # facade line (spandrels, pilasters)
    yc = -off + rv                  # recessed core face (glazing)
    for x in xs:                    # pilasters, projecting 0.45 m beyond the facade line
        f.merge(bxz(1.1, rv + 0.45, top - 0.2, x, yf + (rv - 0.45) / 2, 0.0, mat=cv, bev=0.06))
    zcov = z0f
    for fl in range(floors):
        zf = z0f + fl * fh
        zs, zh = zf + 1.0, zf + 1.0 + band_h          # sill / head of the window band
        if zh > top - 1.0:
            break
        door_floor = fl == 0 and doors_here
        glazed = windows and (fl % win_every == win_every - 1 or fl == floors - 1)
        if not glazed and not door_floor:
            # blank machine / bin floor: full-height spandrel, rust + water runs from the joint
            f.merge(bxz(w, rv, fh, 0, yf + rv / 2, zf, mat=cv))
            zcov = zf + fh
            for i in range(n):
                if r.random() < 0.35:
                    x0 = xs[i] + r.uniform(0.6, bay * 0.6)
                    f.merge(wall_decal(x0, x0 + r.uniform(0.8, 1.6), yf - 0.02, zf + fh - r.uniform(1.5, 3.5), zf + fh - 0.1, 'streak', 'stain'))
            continue
        if windows and not door_floor:
            # glazing strip on the recessed core face + mullions every ~2.3 m
            f.merge(bxz(w - 0.2, 0.1, band_h, 0, yc - 0.05, zs, mat='trim:window'))
            for i in range(n):
                xa = xs[i] + 0.55
                nm = max(1, int((bay - 1.1) / 2.3))
                for m in range(1, nm):
                    f.merge(bxz(0.14, 0.22, band_h, xa + m * (bay - 1.1) / nm, yc - 0.16, zs, mat='steel:dark'))
                # lit panes: vertical clusters (a few bays light up on consecutive floors)
                if i in lit_cols and r.random() < 0.7:
                    lw = r.choice((1.2, 2.3, 2.3, 3.4))
                    lx = xa + r.uniform(0.2, max(0.25, bay - 1.1 - lw - 0.2)) + lw / 2
                    f.merge(bxz(lw, 0.12, band_h * 0.92, lx, yc - 0.12, zs + band_h * 0.04, mat='trim:window_lit'))
                # drip streak from the sill (water + soot), every bay, random length
                if r.random() < 0.85:
                    x0 = xs[i] + 0.6 + r.uniform(0.0, bay * 0.5)
                    L = r.uniform(1.4, min(3.6, zs - zf + 1.5))
                    f.merge(wall_decal(x0, x0 + r.uniform(0.9, 1.8), yf - 0.02, zs - L, zs - 0.16, 'streak', r.choice(['stain', 'stain', 'rust'])))
        # spandrels: sill band (floor .. sill) and head band (head .. next floor), flush with the facade
        f.merge(bxz(w, rv, (zh if door_floor else zs) - zf, 0, yf + rv / 2, zf, mat=cv))
        hb = (zf + fh) - zh if fl < floors - 1 else max(0.4, top - zh)
        f.merge(bxz(w, rv, hb, 0, yf + rv / 2, zh, mat=cv))
        zcov = zh + hb
        # precast sill (projecting drip edge) + thin head reveal
        if windows and not door_floor:
            f.merge(bxz(w + 0.2, 0.42, 0.16, 0, yf - 0.12, zs - 0.16, mat='concrete:grey', bev=0.03))
    if zcov < top - 0.05:
        f.merge(bxz(w, rv, top - zcov, 0, yf + rv / 2, zcov, mat=cv))
    # base: soot / splash curtain + rust runs from the coping, 20-40 % of the facade
    for i in range(n):
        if r.random() < 0.55:
            x0 = xs[i] + r.uniform(0.6, bay * 0.6)
            L = top * r.uniform(0.18, 0.45)
            f.merge(wall_decal(x0, x0 + r.uniform(1.6, 3.2), yf - 0.03, top - L, top - 0.1, r.choice(['curtain', 'streak']),
                               r.choice(['soot', 'stain', 'rust'])))
    f.merge(wall_decal(-w / 2 + 0.6, w / 2 - 0.6, yf - 0.025, 1.4, 1.4 + min(2.4, top * 0.25), 'curtain', 'soot'))
    f.transform(Matrix.Rotation(k * math.pi / 2, 4, 'Z'))
    g.merge(f)


ROOF_AC = [0.0, 0.0]


def _roof_kit(g, r, sx, sy, zr, parapet=True, stair=False):
    """r3 roof-dressing kit (the verticality pillar sends rigs onto every roof): 1.1 m handrail
    with posts every 2 m on the coping, 2-4 hatches, 3-6 mushroom / gooseneck vents, a cable tray
    from the AC skid to the parapet, roof drains, ash drifts banked in the corners and along the
    windward parapet. Positions avoid the stair penthouse and the AC skid."""
    from megakit import ash_drift
    zc = zr + 1.0 if parapet else zr + 0.3          # coping top (parapet) / cantilever slab top
    e, f = (sx / 2 + 0.15, sy / 2 + 0.15) if parapet else (sx / 2 + 1.4, sy / 2 + 2.7)
    g.merge(rail_line([(-e, -f, zc), (e, -f, zc), (e, f, zc), (-e, f, zc), (-e, -f, zc)], h=1.1, post=2.0, r=0.05, mat='steel:yellow',
                      post_mat='steel:yellow'))
    busy = [(ROOF_AC[0], ROOF_AC[1], 4.6, 2.4)]
    if stair:
        busy.append((sx / 2 - 4, sy / 2 - 4, 3.6, 3.6))

    def free(x, y, rad):
        if abs(x) > sx / 2 - 1.2 - rad or abs(y) > sy / 2 - 1.2 - rad:
            return False
        return all(abs(x - bx_) > hw + rad or abs(y - by_) > hd + rad for (bx_, by_, hw, hd) in busy)
    nh = r.randint(2, 4)
    for i in range(nh * 6):
        if nh <= 0:
            break
        x, y = r.uniform(-sx / 2, sx / 2), r.uniform(-sy / 2, sy / 2)
        if not free(x, y, 1.2):
            continue
        g.merge(bxz(1.6, 1.6, 0.6, x, y, zr, mat='concrete:grey', bev=0.04))
        g.merge(bxz(1.5, 1.5, 0.12, x, y, zr + 0.6, mat='steel:yellow'))
        g.merge(bxz(1.5, 0.12, 0.1, x, y + 0.72, zr + 0.62, mat='steel:dark'))
        busy.append((x, y, 1.0, 1.0))
        nh -= 1
    nv = r.randint(3, 6)
    for i in range(nv * 6):
        if nv <= 0:
            break
        x, y = r.uniform(-sx / 2, sx / 2), r.uniform(-sy / 2, sy / 2)
        if not free(x, y, 0.9):
            continue
        rr = r.uniform(0.25, 0.55)
        hh = r.uniform(0.9, 2.6)
        if r.random() < 0.7:     # mushroom vent
            g.merge(P.cylinder(rr, hh, 10, bevel=0.0, mat=r.choice(['steel:galv', 'steel:rust', 'steel:dark']), z0=zr).move(x, y, 0))
            g.merge(P.cylinder(rr * 1.9, 0.18, 10, bevel=0.0, mat='steel:dark', z0=zr + hh + 0.25).move(x, y, 0))
            for k in range(3):
                a = TAU * k / 3
                g.merge(bxz(0.05, 0.05, 0.3, x + math.cos(a) * rr * 0.8, y + math.sin(a) * rr * 0.8, zr + hh - 0.02, mat='steel:dark'))
        else:                    # gooseneck
            g.merge(P.pipe_run([V((x, y, zr)), V((x, y, zr + hh)), V((x + 0.9, y, zr + hh)), V((x + 0.9, y, zr + hh - 0.6))], r=rr * 0.7,
                               bend=0.35, segs=8, mat='steel:galv', flanges=False))
        busy.append((x, y, 0.8, 0.8))
        nv -= 1
    # cable tray from the AC skid to the nearest long parapet, then down the facade
    ax, ay = ROOF_AC
    ty = -sy / 2 + 1.0 if ay < 0 else sy / 2 - 1.0
    y0 = ay - 1.6 if ay > 0 else ay + 1.6
    tx = ax + 4.2
    L = abs(ty - y0)
    if L > 2.0:
        cy_ = (ty + y0) / 2
        g.merge(bxz(0.9, L, 0.1, tx, cy_, zr + 0.55, mat='trim:grating'))
        for sgn in (-1, 1):
            g.merge(bxz(0.05, L, 0.18, tx + sgn * 0.45, cy_, zr + 0.55, mat='steel:galv'))
        for k in range(int(L / 2.5) + 1):
            g.merge(bxz(0.12, 0.12, 0.55, tx, y0 + (ty - y0) * k / max(1, int(L / 2.5)), zr, mat='steel:galv'))
        g.merge(P.cable((tx - 0.2, y0, zr + 0.72), (tx - 0.2, ty, zr + 0.72), sag=0.0, radius=0.08, segs=4, mat='steel:black', n=3))
    # roof drains (dark gratings by the corners)
    for (cx_, cy_) in ((-sx / 2 + 1.4, -sy / 2 + 1.4), (sx / 2 - 1.4, -sy / 2 + 1.4)):
        g.merge(bxz(0.7, 0.7, 0.05, cx_, cy_, zr, mat='steel:black'))
    # ash: drifts banked along the windward (+Y, north sea wind) parapet and in the corners
    if parapet:
        dL = sx * r.uniform(0.45, 0.7)
        d = ash_drift(dL, 2.2, 0.34, seed=r.randint(0, 99))
        d.move(r.uniform(-(sx - dL) / 2, (sx - dL) / 2) * 0.8, sy / 2 - 1.1, zr)
        g.merge(d)
        for (cx_, cy_, rot) in ((-sx / 2, -sy / 2, 0.0), (sx / 2, -sy / 2, 0.5 * math.pi), (-sx / 2, sy / 2, -0.5 * math.pi)):
            m = P.dome(r.uniform(1.6, 2.6), r.uniform(0.18, 0.32), segs=10, rings=3, mat='heap:dust')
            m.move(cx_ + (0.9 if cx_ < 0 else -0.9), cy_ + (0.9 if cy_ < 0 else -0.9), zr - 0.04)
            g.merge(m)


def brut_block(sx, sy, h, seed=1, windows=True, doors=1, pil=7.0, var='', hazard=True, roof=True, band_h=2.0,
               stair=False, core=True, pipes=True, cant=False):
    """Board-formed concrete block: plinth, full-height pilasters, recessed window bands with
    reveals, mullions and clustered lit panes, precast sills, parapet + coping, downpipes every
    ~6 m, roof plant (vent boxes, ducts, AC skid, hatch, mast), caged roof ladder, stair core,
    roller doors, hazard base band, sill / coping streaks."""
    r = _noise(seed)
    g = Geo()
    cv = 'concrete' + (':' + var if var else '')
    rv = 0.35
    fh = 4.5
    z0f = 1.4
    floors = max(1, int((h - z0f - 0.6) / fh))
    hc = h if not (cant and h > 12) else h * 0.6        # main volume top (below a cantilevered storey)
    g.merge(bxz(sx + 1.0, sy + 1.0, 1.4, mat='concrete:dark', bev=0.1))            # plinth
    g.merge(bxz(sx - 2 * rv, sy - 2 * rv, hc, z0=0.0, mat=cv))                     # recessed core
    # facades (front -Y carries the doors)
    nfl = floors if hc == h else max(1, int((hc - z0f) / fh))
    for k, (w, off) in enumerate(((sx, sy / 2), (sy, sx / 2), (sx, sy / 2), (sy, sx / 2))):
        n = max(1, int(round(w / pil)))
        lit = set(r.sample(range(n), min(n, r.choice((1, 2, 2, 3)))))
        _facade(g, r, w, off, hc, cv, k, nfl, fh, z0f, pil, band_h, lit, doors_here=(k == 0 and doors > 0),
                rv=rv, windows=windows and h > 6, top=hc, win_every=1 if h <= 26 else 3)
    # parapet upstand + coping (0.6 m, overhanging 0.3 m) on the main volume
    if not (cant and h > 12):
        for (w, d, x, y) in ((sx + 0.9, 0.5, 0, -sy / 2 - 0.2), (sx + 0.9, 0.5, 0, sy / 2 + 0.2), (0.5, sy, -sx / 2 - 0.2, 0), (0.5, sy, sx / 2 + 0.2, 0)):
            g.merge(bxz(w, d, 0.9, x, y, h, mat=cv))
        g.merge(bxz(sx + 1.6, 0.9, 0.35, 0, -sy / 2 - 0.15, h + 0.9, mat='concrete:grey', bev=0.05))
        g.merge(bxz(sx + 1.6, 0.9, 0.35, 0, sy / 2 + 0.15, h + 0.9, mat='concrete:grey', bev=0.05))
        g.merge(bxz(0.9, sy + 0.2, 0.35, -sx / 2 - 0.15, 0, h + 0.9, mat='concrete:grey', bev=0.05))
        g.merge(bxz(0.9, sy + 0.2, 0.35, sx / 2 + 0.15, 0, h + 0.9, mat='concrete:grey', bev=0.05))
        g.merge(bxz(sx - 1.0, sy - 1.0, 0.25, 0, 0, h, mat='concrete:soot'))       # roof membrane
    zr = h if not (cant and h > 12) else h
    # hazard band at the base
    if hazard:
        for s in (-1, 1):
            g.merge(bxz(sx + 0.05, 0.06, 1.3, 0, s * (sy / 2 + 0.03), 1.4, mat='trim:hazard'))
    # roller doors (front)
    for k in range(doors):
        dx = (k - (doors - 1) / 2) * min(14.0, sx / max(doors, 1))
        dw, dh = min(8.0, sx / (doors + 1)), min(9.0, h * 0.55, fh * 2 - 0.6)
        g.merge(bxz(dw + 1.2, 0.5, dh + 0.9, dx, -sy / 2 - 0.2, 0.0, mat='steel:dark'))
        g.merge(bxz(dw, 0.3, dh, dx, -sy / 2 - 0.3, 0.0, mat='corr:' + r.choice(['grey', 'oxide', 'blue'])))
        g.merge(bxz(dw + 1.6, 1.4, 0.5, dx, -sy / 2 - 0.8, dh + 0.9, mat='concrete:grey'))
        g.merge(flood(dx, -sy / 2 - 1.2, dh + 2.4, 0.0, 'sodium'))
        for sxx in (-1, 1):
            g.merge(bxz(0.45, 0.08, dh, dx + sxx * (dw / 2 + 0.35), -sy / 2 - 0.47, 0.0, mat='trim:hazard'))
        g.merge(bxz(dw + 0.4, 0.05, 0.03, dx, -sy / 2 - 0.47, 0.02, mat='steel:yellow'))
    # downpipes every ~6 m on the long faces (hopper head under the coping, shoe at the base)
    for s in (-1, 1):
        n = max(2, int(sx / 6.0))
        for i in range(n):
            x = -sx / 2 + (i + 0.5) * sx / n + 0.75
            if s < 0 and any(abs(x - (k - (doors - 1) / 2) * min(14.0, sx / max(doors, 1))) < 6.0 for k in range(doors)):
                continue
            yy = s * (sy / 2 + 0.3)
            g.merge(tube((x, yy, 0.3), (x, yy, hc - 0.3), 0.14, 'steel:dark', 8))
            g.merge(bxz(0.5, 0.45, 0.5, x, yy, hc - 0.5, mat='steel:dark'))
            g.merge(bxz(0.45, 0.6, 0.18, x, yy + s * 0.15, 0.1, mat='steel:dark'))
    # roof plant
    if roof:
        nb = r.randint(2, 4)
        for i in range(nb):
            w, d, hh = r.uniform(2.5, 5.5), r.uniform(2.0, 4.0), r.uniform(1.4, 2.6)
            x, y = r.uniform(-sx / 2 + w, sx / 2 - w), r.uniform(-sy / 2 + d, sy / 2 - d)
            g.merge(bxz(w, d, hh, x, y, zr + 0.25, mat='steel:galv'))
            g.merge(bxz(w + 0.2, d + 0.2, 0.12, x, y, zr + 0.25 + hh, mat='steel:dark'))
            g.merge(bxz(w * 0.8, 0.1, hh * 0.5, x, y - d / 2 - 0.02, zr + 0.45, mat='trim:louvre'))
            # duct from the unit over the parapet (elbow run)
            if i < 2:
                ex = x + (w / 2 if x < 0 else -w / 2)
                g.merge(P.pipe_run([V((x, y, zr + 0.25 + hh * 0.6)), V((x, -sy / 2 + 1.6, zr + 0.25 + hh * 0.6)),
                                    V((x, -sy / 2 + 1.6, zr + 2.6))], r=0.45, bend=0.8, segs=10, mat='steel:galv', flanges=False))
        # AC skid: frame + 3 fan stacks
        ax, ay = r.uniform(-sx / 4, sx / 4), sy / 2 - 3.0
        ROOF_AC[0], ROOF_AC[1] = ax, ay
        g.merge(bxz(7.0, 2.6, 0.3, ax, ay, zr + 0.25, mat='steel:yellow'))
        g.merge(bxz(6.6, 2.2, 1.6, ax, ay, zr + 0.55, mat='steel:galv'))
        for i in range(3):
            g.merge(P.cylinder(0.85, 0.35, 12, bevel=0.0, mat='steel:dark', z0=zr + 2.15).move(ax - 2.2 + i * 2.2, ay, 0))
        # stacks / vents, roof hatch, antenna mast with beacon
        for i in range(r.randint(1, 3)):
            x, y = r.uniform(-sx / 2 + 2, sx / 2 - 2), r.uniform(-sy / 2 + 2, sy / 2 - 2)
            g.merge(P.cylinder(0.5, 2.8, 12, bevel=0.0, mat='steel:rust', z0=zr + 0.25).move(x, y, 0))
            g.merge(P.cone(0.8, 0.2, 0.6, 12, bevel=0.0, mat='steel:dark').move(x, y, zr + 3.05))
        g.merge(bxz(1.6, 1.6, 0.8, -sx / 2 + 3.0, sy / 2 - 3.0, zr + 0.25, mat='steel:dark'))
        g.merge(beam((sx / 2 - 1.5, -sy / 2 + 1.5, zr + 0.25), (sx / 2 - 1.5, -sy / 2 + 1.5, zr + 7.0), 0.18, 0.18, 'steel:galv'))
        g.merge(beacon(sx / 2 - 1.5, -sy / 2 + 1.5, zr + 7.4, 0.45))
        if stair:      # stair penthouse: door, lamp, louvre, roof drain spout
            px, py = sx / 2 - 4, sy / 2 - 4
            g.merge(bxz(5, 5, 3.4, px, py, zr + 0.25, mat=cv, bev=0.08))
            g.merge(bxz(5.6, 5.6, 0.3, px, py, zr + 3.65, mat='concrete:grey'))
            g.merge(bxz(1.3, 0.12, 2.3, px - 0.8, py - 2.53, zr + 0.25, mat='steel:dark'))
            g.merge(bxz(1.5, 0.08, 0.06, px - 0.8, py - 2.57, zr + 2.6, mat='steel:yellow'))
            g.merge(bx(0.4, 0.25, 0.25, (px - 0.8, py - 2.7, zr + 2.95), mat='glow:sodium'))
            g.merge(bxz(1.6, 0.1, 0.9, px + 1.2, py - 2.52, zr + 1.4, mat='trim:louvre'))
            g.merge(wall_decal(px - 2.5, px + 2.5, py - 2.56, zr + 1.0, zr + 3.6, 'curtain', 'soot'))
            # the other faces + roof: louvre + conduits + junction box (+X), split HVAC unit (+Y),
            # vents / antenna / drip lip on the penthouse roof
            g.merge(bxz(0.1, 2.2, 1.0, px + 2.53, py + 0.6, zr + 1.6, mat='trim:louvre'))
            for k, zz in enumerate((zr + 0.6, zr + 2.9)):
                g.merge(bxz(0.16, 4.4, 0.16, px + 2.62, py, zz, mat='steel:galv'))
            g.merge(bxz(0.35, 0.8, 1.0, px + 2.7, py - 1.4, zr + 1.2, mat='steel:dark'))
            g.merge(bxz(0.16, 0.16, 2.6, px + 2.62, py - 1.4, zr + 0.3, mat='steel:galv'))
            g.merge(side_decal(px + 2.56, py - 2.3, py + 2.3, zr + 1.2, zr + 3.6, 'curtain', 'stain', 1))
            g.merge(bxz(2.6, 1.0, 1.4, px - 0.6, py + 3.0, zr + 0.6, mat='steel:galv'))
            g.merge(bxz(2.3, 0.08, 1.0, px - 0.6, py + 3.52, zr + 0.8, mat='trim:louvre'))
            g.merge(beam((px - 1.8, py + 2.5, zr + 0.6), (px - 1.8, py + 3.3, zr + 0.25), 0.12, 0.12, 'steel:dark'))
            g.merge(beam((px + 0.6, py + 2.5, zr + 0.6), (px + 0.6, py + 3.3, zr + 0.25), 0.12, 0.12, 'steel:dark'))
            zt = zr + 3.95
            for (vx, vy, vr) in ((px - 1.4, py + 1.2, 0.35), (px + 1.3, py - 1.1, 0.25)):
                g.merge(P.cylinder(vr, 1.0, 10, bevel=0.0, mat='steel:galv', z0=zt).move(vx, vy, 0))
                g.merge(P.cylinder(vr * 1.8, 0.15, 10, bevel=0.0, mat='steel:dark', z0=zt + 1.2).move(vx, vy, 0))
            g.merge(beam((px + 1.6, py + 1.6, zt), (px + 1.6, py + 1.6, zt + 4.0), 0.1, 0.1, 'steel:galv'))
            g.merge(bxz(0.6, 0.06, 0.6, px + 1.6, py + 1.6, zt + 3.0, mat='steel:dark'))
            g.merge(bxz(1.6, 1.0, 0.4, px - 0.6, py - 1.4, zt, mat='steel:dark'))
            g.merge(P.dome(1.6, 0.12, segs=8, rings=2, mat='heap:dust').move(px - 1.6, py + 1.8, zt - 0.02))
        _roof_kit(g, r, sx, sy, zr + 0.25, parapet=not (cant and h > 12), stair=stair)
        # caged ladder up the -X gable to the roof
        g.merge(cheap_ladder(hc + 1.0, -sx / 2 - 0.65, sy / 4, 0.0, facing=-math.pi / 2))
    cols = [((0, 0, (h + 0.25) / 2), (sx + 1.4, sy + 1.4, h + 0.25))]
    if not (cant and h > 12):
        for (cx_, cy_, w_, d_) in ((0, -sy / 2 - 0.15, sx + 1.6, 0.9), (0, sy / 2 + 0.15, sx + 1.6, 0.9), (-sx / 2 - 0.15, 0, 0.9, sy + 0.2),
                                   (sx / 2 + 0.15, 0, 0.9, sy + 0.2)):
            cols.append(((cx_, cy_, h + 0.62), (w_, d_, 1.25)))
    if roof and stair:
        cols.append(((sx / 2 - 4, sy / 2 - 4, h + 0.25 + 1.85), (5.6, 5.6, 3.7)))
    if roof:
        cols.append(((ROOF_AC[0], ROOF_AC[1], h + 0.25 + 1.0), (7.0, 2.6, 2.0)))
    # cantilevered upper storey (brutalist overhang) with its own window band + soffit beams
    if cant and h > 12:
        z0c = hc
        cy = sy / 2 + 2.6
        g.merge(bxz(sx + 2.6, sy + 5.2, h - z0c + 0.2, 0, 0, z0c, mat=cv, bev=0.12))
        for sgn in (-1, 1):
            fac = -1 if sgn < 0 else 1
            g.merge(bxz(sx + 1.6, 0.14, band_h + 0.4, 0, sgn * (cy + 0.03), h - band_h - 1.8, mat='trim:window'))
            g.merge(bxz(sx + 2.8, 1.0, 0.5, 0, sgn * (cy + 0.4), h - band_h - 2.3, mat='concrete:grey'))
            for k in range(int((sx + 1.6) / 2.4)):
                g.merge(bxz(0.16, 0.25, band_h + 0.4, -sx / 2 - 0.8 + (k + 0.5) * (sx + 1.6) / int((sx + 1.6) / 2.4), sgn * (cy + 0.14),
                            h - band_h - 1.8, mat='steel:dark'))
            for k in range(int(sx / 7)):
                if r.random() < 0.35:
                    g.merge(bxz(r.choice((2.3, 4.6)), 0.16, band_h, -sx / 2 + 3.5 + k * 7.0, sgn * (cy + 0.04), h - band_h - 1.6, mat='trim:window_lit'))
            for k in range(int(sx / 5)):
                x0 = -sx / 2 + k * 5 + r.uniform(0, 2)
                g.merge(wall_decal(x0, x0 + r.uniform(1.0, 2.0), sgn * (cy + 0.02), h - band_h - 2.3 - r.uniform(1.5, 3.5), h - band_h - 2.3, 'streak', 'stain', fac))
        cx_ = sx / 2 + 1.3
        for sgn in (-1, 1):                       # end walls of the overhang: glazing + mullions + streaks
            fac = 1 if sgn > 0 else -1
            g.merge(bxz(0.14, sy + 3.6, band_h + 0.4, sgn * (cx_ + 0.03), 0, h - band_h - 1.8, mat='trim:window'))
            g.merge(bxz(1.0, sy + 5.4, 0.5, sgn * (cx_ + 0.4), 0, h - band_h - 2.3, mat='concrete:grey'))
            for k in range(int((sy + 3.6) / 2.4)):
                g.merge(bxz(0.25, 0.16, band_h + 0.4, sgn * (cx_ + 0.14), -(sy + 3.6) / 2 + (k + 0.5) * (sy + 3.6) / int((sy + 3.6) / 2.4),
                            h - band_h - 1.8, mat='steel:dark'))
            if r.random() < 0.6:
                g.merge(bxz(0.16, r.choice((2.3, 4.6)), band_h, sgn * (cx_ + 0.04), r.uniform(-sy / 3, sy / 3), h - band_h - 1.6, mat='trim:window_lit'))
            for k in range(int(sy / 4)):
                y0 = -sy / 2 + k * 4 + r.uniform(0, 1.5)
                g.merge(side_decal(sgn * (cx_ + 0.02), y0, y0 + r.uniform(1.0, 2.0), h - band_h - 2.3 - r.uniform(1.5, 4.0), h - band_h - 2.3,
                                   'streak', r.choice(['stain', 'rust']), fac))
        for k in range(int(sx / 5) + 1):
            x = -sx / 2 + k * sx / int(sx / 5)
            g.merge(bxz(0.8, sy + 5.0, 0.9, x, 0, z0c - 0.9, mat=cv, bev=0.05))
        # parapet + coping on the overhang
        g.merge(bxz(sx + 3.2, sy + 5.8, 0.35, 0, 0, h + 0.2, mat='concrete:grey', bev=0.05))
        cols[0] = ((0, 0, z0c / 2), (sx + 1.4, sy + 1.4, z0c))
        cols.insert(1, ((0, 0, (z0c + h + 0.55) / 2), (sx + 3.2, sy + 5.8, h + 0.55 - z0c)))
    # stair core with slit windows (brutalist signature) on the +X end
    if core and h > 11:
        cw, ch = 6.5, h + 5.0
        cx, cy = sx / 2 + cw / 2 - 0.2, sy / 4 - cw / 2
        g.merge(bxz(cw, cw, ch, cx, cy, 0.0, mat=cv, bev=0.12))
        g.merge(bxz(cw + 0.8, cw + 0.8, 0.9, cx, cy, ch, mat='concrete:grey', bev=0.08))
        for k in range(int((ch - 4) / 4.0)):
            g.merge(bxz(0.12, 0.9, 2.6, cx + cw / 2 + 0.02, cy, 3.0 + k * 4.0, mat='trim:window'))
            if k % 3 == 1:
                g.merge(bxz(0.13, 0.7, 2.4, cx + cw / 2 + 0.03, cy, 3.1 + k * 4.0, mat='trim:window_lit'))
        g.merge(bxz(0.3, 2.0, 3.0, cx + cw / 2 + 0.1, cy - 1.8, 0.0, mat='steel:dark'))
        g.merge(side_decal(cx + cw / 2 + 0.03, cy - cw / 2 + 0.3, cy + cw / 2 - 0.3, ch - ch * 0.4, ch, 'curtain', 'soot', 1))
        g.merge(beacon(cx, cy, ch + 1.3, 0.5))
        e_ = cw / 2 + 0.25
        g.merge(rail_line([(cx - e_, cy - e_, ch + 0.9), (cx + e_, cy - e_, ch + 0.9), (cx + e_, cy + e_, ch + 0.9), (cx - e_, cy + e_, ch + 0.9),
                           (cx - e_, cy - e_, ch + 0.9)], h=1.1, post=2.0, r=0.05, mat='steel:yellow', post_mat='steel:yellow'))
        g.merge(bxz(1.4, 1.4, 0.6, cx - 1.4, cy + 1.2, ch + 0.9, mat='concrete:grey', bev=0.04))
        g.merge(bxz(1.3, 1.3, 0.12, cx - 1.4, cy + 1.2, ch + 1.5, mat='steel:yellow'))
        g.merge(P.cylinder(0.3, 1.6, 10, bevel=0.0, mat='steel:rust', z0=ch + 0.9).move(cx + 1.6, cy - 1.5, 0))
        g.merge(P.cylinder(0.55, 0.14, 10, bevel=0.0, mat='steel:dark', z0=ch + 2.6).move(cx + 1.6, cy - 1.5, 0))
        cols.append(((cx, cy, ch / 2), (cw + 0.4, cw + 0.4, ch + 0.9)))
    # facade services on +Y: risers, header, brackets, units at the base
    if pipes and h > 8:
        ys = sy / 2 + 1.0
        xs = [-sx / 2 + 3.0 + i * 1.4 for i in range(3)]
        for i, x in enumerate(xs):
            g.merge(tube((x, ys, 0.4), (x, ys, hc - 2.5 - i * 0.9), 0.32 - i * 0.06, r.choice(['steel:galv', 'steel:rust', 'steel:bone']), 12))
            g.merge(tube((x, ys, hc - 2.5 - i * 0.9), (sx / 2 - 2.0, ys, hc - 2.5 - i * 0.9), 0.32 - i * 0.06, 'steel:galv', 12))
        for k in range(int(hc / 3)):
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
        g.merge(bxz(sw_, 0.1, sh_, 0.0, -sy / 2 - 0.36, hc - sh_ - 1.0, mat='trim:stencil@' + key))
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
        g.merge(tube((x, 10.0, 28.0), (x, 10.0, 44.0), 1.4, 'steel:rust', 16))
        g.merge(tube((x, 10.0, 44.0), (x + 8.0 * (1 if x > 0 else -1), 30.0, 44.0), 1.4, 'steel:rust', 16))
    g.merge(bxz(30.0, 6.0, 5.0, 0, -17.0 - 3.0, 18.0, mat='steel:dark'))
    # (r3) roofscape so it never reads as a plain box from above: fume-extraction main along the
    # ridge on saddles, roof ventilators on both slopes, skylight strips, ridge walkway + rail,
    # a baghouse with hoppers on the +X gable, lean-to annex + stair tower on -X, downpipes
    zr = 24.0 + 1.0 + 34.0 * 0.12 * 0.9 + 4.5
    g.merge(tube((-20.0, 0.0, zr + 2.2), (26.0, 0.0, zr + 2.2), 1.6, 'steel:rust', 14))
    for x in (-16.0, -4.0, 8.0, 20.0):
        g.merge(bxz(1.0, 3.2, 1.6, x, 0, zr - 0.2, mat='steel:dark'))
    for s_ in (-1, 1):
        for k in range(5):
            x = -18.0 + k * 9.0
            y = s_ * 10.5
            z = 25.0 + 34.0 * 0.12 * (1 - 10.5 / 17.0) + 0.6
            g.merge(P.cylinder(1.1, 1.8, 12, bevel=0.0, mat='steel:galv', z0=z).move(x, y, 0))
            g.merge(P.cylinder(1.6, 0.35, 12, bevel=0.0, mat='steel:dark', z0=z + 2.2).move(x, y, 0))
        sk = bx(40.0, 1.6, 0.12, (0, 0, 0), mat='trim:window')
        sk.transform(Matrix.Translation(V((0, s_ * 5.2, 25.0 + 34.0 * 0.12 * (1 - 5.2 / 17.0) + 0.42))) @ Matrix.Rotation(s_ * math.atan2(34.0 * 0.12, 17.0), 4, 'X'))
        g.merge(sk)
    g.merge(rail_line([(-17.0, -4.2, zr), (17.0, -4.2, zr)], h=1.1, post=3.0, r=0.06, mat='steel:yellow', post_mat='steel:yellow'))
    # baghouse (+X gable): 3 hoppered cells on legs + duct from the fume main
    bxx = 23.0 + 7.0
    for k in range(3):
        y = -9.0 + k * 9.0
        g.merge(bxz(7.0, 7.4, 9.0, bxx, y, 12.0, mat='steel:grey'))
        g.merge(bxz(7.4, 7.8, 0.5, bxx, y, 21.0, mat='steel:dark'))
        g.merge(P.frustum((6.6, 7.0), (1.2, 1.2), 4.0, bevel=0.0, segs=1, mat='steel:grey').rotate((180, 0, 0)).move(bxx, y, 12.0))
        for sx in (-1, 1):
            g.merge(bxz(0.5, 0.5, 12.0, bxx + sx * 3.2, y - 3.4, 0.0, mat='steel:dark'))
    g.merge(tube((26.0, 0.0, zr + 2.2), (bxx, 0.0, zr + 2.2), 1.6, 'steel:rust', 14))
    g.merge(tube((bxx, 0.0, zr + 2.2), (bxx, 0.0, 21.5), 1.6, 'steel:rust', 14))
    g.merge(P.cylinder(1.1, 14.0, 12, bevel=0.0, mat='steel:rust', z0=21.5).move(bxx + 2.0, 9.0, 0))
    g.merge(beacon(bxx + 2.0, 9.0, 36.2, 0.6))
    # lean-to annex + stair tower on the -X gable
    g.merge(bxz(10.0, 26.0, 11.0, -23.0 - 5.0, 2.0, 0.0, mat='corr:blue'))
    lr = bx(11.0, 27.0, 0.3, (0, 0, 0), mat='corr:dark')
    lr.transform(Matrix.Translation(V((-28.0, 2.0, 11.6))) @ Matrix.Rotation(0.12, 4, 'Y'))
    g.merge(lr)
    g.merge(bxz(9.0, 0.12, 1.6, -28.0, 2.0 - 13.06, 7.0, mat='trim:window'))
    g.merge(bxz(6.0, 6.0, 30.0, -27.0, 18.5, 0.0, mat='concrete:grey', bev=0.08))
    for k in range(6):
        g.merge(bxz(0.12, 1.0, 2.2, -30.06, 18.5, 3.0 + k * 4.5, mat='trim:window'))
    g.merge(beacon(-27.0, 18.5, 31.0, 0.6))
    for x in (-15.0, 0.0, 15.0):
        g.merge(tube((x + 1.5, 17.6, 1.2), (x + 1.5, 17.6, 24.6), 0.25, 'steel:dark', 8))
        g.merge(wall_decal(x - 2.5, x + 2.5, 17.08, 14.0, 24.6, 'curtain', 'soot', facing=1))
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


def quay_seg(L=20.0, lo=False):
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
    if not lo:
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
def bulk_carrier(L=180.0, W=30.0, D=17.0, seed=17):
    """Derelict Cape-size bulk carrier (bow toward local -Y, keel at z=0): hull lofted with sheer
    and bow flare, forecastle, raised strakes + frame seams on the parallel mid-body, boot-top
    band, 7 hatch coamings (one cover missing, one knocked askew), 4 deck cranes with lattice-
    look jibs, 5-deck aft accommodation with window rows + bridge wings, funnel, radar mast,
    lifeboat davits, rudder + propeller hub (exposed when the wreck settles bow-down)."""
    import random
    r = random.Random(seed)
    g = Geo()
    hw = W / 2

    bil = min(3.0, D * 0.2)

    def sec(t, wb, wm, wd, zb, sh, grow=0.0, ztop=None):
        # (half-width at the keel, at the bilge, at the deck; keel rise; sheer) at station t
        zt = D + sh if ztop is None else ztop
        wt = wd if ztop is None else wm + (wd - wm) * (ztop - zb - bil) / max(D + sh - zb - bil, 1e-3)
        e = grow
        return ([(-wb - e, zb - e), (wb + e, zb - e), (wm + e, zb + bil), (wt + e, zt), (-wt - e, zt), (-wm - e, zb + bil)], t * L)
    ST = [(-0.5, 0.25, 0.4, 0.9, 7.5, 3.4), (-0.485, 1.2, 2.6, 6.0, 4.0, 3.1), (-0.46, 3.0, 6.5, 10.5, 1.8, 2.7),
          (-0.42, 6.5, 11.0, 13.6, 0.6, 2.1), (-0.36, 11.0, 14.2, 14.9, 0.0, 1.3), (-0.28, 13.2, hw, hw, 0.0, 0.7),
          (0.30, 13.2, hw, hw, 0.0, 0.35), (0.40, 10.0, 14.6, hw, 0.8, 0.6), (0.46, 5.5, 12.4, 14.6, 3.2, 1.1),
          (0.5, 2.5, 9.5, 13.2, 6.8, 1.5)]
    g.merge(P.loft([sec(*p_) for p_ in ST], bevel=0.0, segs=1, mat='steel:dark', axis='Y'))
    # boot-top / antifouling below the old load line (slightly proud of the hull)
    g.merge(P.loft([sec(*p_, grow=0.05, ztop=7.0) for p_ in ST[2:-1]], bevel=0.0, segs=1, mat='steel:red', axis='Y'))
    # raised strakes (plate laps) + frame seams on the parallel mid-body, sheer strake band
    y0, y1 = -0.27 * L, 0.29 * L
    for z in (9.5, 12.5, D - 0.6):
        for sx in (-1, 1):
            g.merge(bx(0.12, y1 - y0, 0.22 if z < D - 1 else 0.6, (sx * (hw + 0.05), (y0 + y1) / 2, z), mat='steel:dark' if z < D - 1 else 'steel:white'))
    for k in range(int((y1 - y0) / 9.0) + 1):
        y = y0 + k * 9.0
        for sx in (-1, 1):
            g.merge(bx(0.1, 0.16, D - 7.6, (sx * (hw + 0.04), y, 7.0 + (D - 7.6) / 2), mat='steel:dark'))
    # bulwark + forecastle deck at the bow
    g.merge(bxz(19.0, 22.0, 2.6, 0, -0.42 * L + 2, D + 1.6, mat='steel:dark'))
    g.merge(bxz(19.4, 22.4, 0.3, 0, -0.42 * L + 2, D + 4.2, mat='steel:white'))
    g.merge(P.cylinder(1.2, 1.4, 12, bevel=0.0, mat='steel:black', z0=D + 4.5).move(-4, -0.43 * L, 0))
    g.merge(P.cylinder(1.2, 1.4, 12, bevel=0.0, mat='steel:black', z0=D + 4.5).move(4, -0.43 * L, 0))
    g.merge(beam((0, -0.4 * L, D + 4.5), (0, -0.4 * L, D + 13.0), 0.5, 0.5, 'steel:white'))
    g.merge(beacon(0, -0.4 * L, D + 13.4, 0.5))
    for sx in (-1, 1):                                                        # hawse pipes
        g.merge(tube((sx * 6.0, -0.47 * L, D - 1.0), (sx * 8.6, -0.452 * L, D - 4.0), 0.9, 'steel:rust', 10))
    # 7 hatch coamings + pontoon covers (#3 missing: open hold; #5 knocked askew)
    hy0, hstep = -0.335 * L, 0.0835 * L
    for k in range(7):
        y = hy0 + k * hstep
        g.merge(bxz(W * 0.62, 13.0, 1.9, 0, y, D, mat='steel:oxide'))
        g.merge(bxz(W * 0.66, 13.6, 0.3, 0, y, D + 1.0, mat='steel:dark'))     # coaming flange
        for sx in (-1, 1):                                                    # coaming stays
            for j in range(4):
                g.merge(bxz(0.25, 0.25 + 0.0, 1.6, sx * (W * 0.31 + 0.2), y - 5.0 + j * 3.3, D, mat='steel:dark'))
        if k == 2:
            g.merge(bxz(W * 0.56, 11.8, 0.2, 0, y, D + 1.75, mat='steel:black'))   # open hold (dark void)
            continue
        cov = Geo()
        for sx in (-1, 1):
            panel = bx(W * 0.31, 13.4, 0.9, (0, 0, 0), mat='steel:oxide')
            panel.transform(Matrix.Translation(V((sx * W * 0.155, 0, 0))) @ Matrix.Rotation(-sx * 0.05, 4, 'Y'))
            cov.merge(panel)
            for j in range(5):
                cov.merge(bx(W * 0.3, 0.25, 0.25, (sx * W * 0.155, -5.6 + j * 2.8, 0.5), mat='steel:dark'))
        if k == 4:
            cov.transform(Matrix.Translation(V((3.5, y + 1.5, D + 2.9))) @ Matrix.Rotation(0.22, 4, 'Z') @ Matrix.Rotation(0.12, 4, 'Y'))
        else:
            cov.transform(Matrix.Translation(V((0, y, D + 2.35))))
        g.merge(cov)
    # 4 deck cranes on pedestals between the hatches, jibs at varied luffing angles
    for k in range(4):
        y = hy0 + (k * 2 + 0.5) * hstep
        g.merge(P.cylinder(1.9, 7.0, 16, bevel=0.0, mat='steel:bone', z0=D).move(-1.0, y, 0))
        g.merge(bxz(4.6, 5.2, 3.8, -1.0, y, D + 7.0, mat='steel:bone'))
        g.merge(bx(4.65, 0.1, 1.0, (-1.0, y - 2.62, D + 9.4), mat='trim:window'))
        ang = math.radians(r.uniform(22, 62))
        yaw = r.uniform(-2.2, 2.2)
        dy, dz = math.cos(ang) * 26.0, math.sin(ang) * 26.0
        dx, dyy = math.sin(yaw) * dy, -math.cos(yaw) * dy
        base = V((-1.0, y, D + 8.0))
        tip = base + V((dx, dyy, dz))
        for off in (-0.9, 0.9):
            o = V((math.cos(yaw) * off, math.sin(yaw) * off, 0))
            g.merge(beam(base + o, tip + o * 0.3, 0.45, 0.6, 'steel:bone'))
        for j in range(1, 6):
            p0 = base + (tip - base) * (j / 6.0)
            g.merge(beam(p0 + V((math.cos(yaw) * -0.9, math.sin(yaw) * -0.9, 0)) * (1 - 0.7 * j / 6),
                         p0 + V((math.cos(yaw) * 0.9, math.sin(yaw) * 0.9, 0)) * (1 - 0.7 * j / 6), 0.2, 0.2, 'steel:bone'))
        g.merge(beam((-1.0, y, D + 10.8), (-1.0, y, D + 14.5), 0.5, 0.5, 'steel:bone'))
        g.merge(beam((-1.0, y, D + 14.5), tip, 0.08, 0.08, 'steel:black'))           # luffing wire
        g.merge(beam(tip, tip + V((0, 0, -min(tip.z - D - 3.0, 12.0))), 0.06, 0.06, 'steel:black'))  # hoist wire
    # aft accommodation: 5 decks stepping back, window rows, bridge wings, railings
    ay = 0.385 * L
    zd = D + 0.0
    for i in range(5):
        w, d = W - 3.0 - (i > 2) * 2.0, 16.0 - i * 0.9
        g.merge(bxz(w, d, 2.8, 0, ay + i * 0.4, zd, mat='steel:white'))
        g.merge(bxz(w + 0.6, d + 0.6, 0.2, 0, ay + i * 0.4, zd + 2.8, mat='steel:dark'))
        for sgn in (-1, 1):
            g.merge(bx(w * 0.86, 0.1, 1.0, (0, ay + i * 0.4 + sgn * (d / 2 + 0.03), zd + 1.5), mat='trim:window'))
        g.merge(bx(0.1, d * 0.7, 1.0, (w / 2 + 0.03, ay + i * 0.4, zd + 1.5), mat='trim:window'))
        g.merge(bx(0.1, d * 0.7, 1.0, (-w / 2 - 0.03, ay + i * 0.4, zd + 1.5), mat='trim:window'))
        g.merge(rail_line([(-w / 2 - 0.3, ay + i * 0.4 - d / 2 - 0.3, zd + 3.0), (w / 2 + 0.3, ay + i * 0.4 - d / 2 - 0.3, zd + 3.0)],
                          h=1.0, post=2.5, r=0.04, mat='steel:white', post_mat='steel:white'))
        zd += 3.0
    zb_ = zd
    g.merge(bxz(W + 4.0, 7.0, 2.6, 0, ay - 4.0, zb_, mat='steel:white'))             # bridge deck + wings
    g.merge(bx(W + 3.0, 0.12, 1.3, (0, ay - 7.55, zb_ + 1.5), mat='trim:window'))
    g.merge(bxz(W + 4.6, 7.6, 0.3, 0, ay - 4.0, zb_ + 2.6, mat='steel:dark'))
    g.merge(bxz(5.0, 4.0, 1.6, 0, ay - 3.0, zb_ + 2.9, mat='steel:white'))
    g.merge(beam((0, ay - 3.0, zb_ + 4.5), (0, ay - 3.0, zb_ + 12.0), 0.35, 0.35, 'steel:white'))
    g.merge(bx(5.0, 0.6, 0.25, (0, ay - 3.0, zb_ + 10.0), mat='steel:dark'))         # radar
    g.merge(beacon(0, ay - 3.0, zb_ + 12.4, 0.5))
    # funnel with a worn orange band, soot top
    fy = ay + 9.0
    g.merge(bxz(8.0, 7.0, 14.0, 0, fy, D + 12.0, mat='steel:dark', bev=0.3))
    g.merge(bxz(8.08, 7.08, 2.2, 0, fy, D + 21.5, mat='steel:orange'))
    g.merge(bxz(8.1, 7.1, 2.0, 0, fy, D + 24.0, mat='steel:black'))
    for sx in (-1.6, 1.6):
        g.merge(P.cylinder(0.6, 3.0, 10, bevel=0.0, mat='steel:black', z0=D + 26.0).move(sx, fy, 0))
    # lifeboat davits on both sides of the house (one boat gone)
    for sgn in (-1, 1):
        g.merge(bxz(1.2, 8.0, 3.5, sgn * (W / 2 - 1.0), ay + 2.0, D + 6.0, mat='steel:dark'))
        if sgn > 0:
            g.merge(P.lathe([(0.0, -4.0), (1.3, -3.0), (1.5, 0.0), (1.3, 3.0), (0.0, 4.0)], 10, 'steel:orange')
                    .rotate((90, 0, 0)).move(sgn * (W / 2 + 0.6), ay + 2.0, D + 8.0))
    # main-deck railing + pipe runs along the deck
    for sx in (-1, 1):
        g.merge(rail_line([(sx * (hw - 0.4), -0.4 * L, D + 0.1), (sx * (hw - 0.4), 0.37 * L, D + 0.1)], h=1.1, post=3.0, r=0.05, mat='steel:white', post_mat='steel:white'))
        g.merge(tube((sx * (hw - 2.0), -0.36 * L, D + 0.6), (sx * (hw - 2.0), 0.34 * L, D + 0.6), 0.35, 'steel:rust', 8))
    # rudder + propeller hub at the stern
    g.merge(bxz(1.2, 7.0, 10.0, 0, 0.5 * L + 2.0, 0.5, mat='steel:red'))
    g.merge(P.cylinder(1.3, 3.0, 12, bevel=0.0, mat='steel:dark').rotate((90, 0, 0)).move(0, 0.5 * L - 2.0, 4.5))
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        g.merge(beam((0, 0.5 * L - 2.0, 4.5), (math.cos(a) * 3.6, 0.5 * L - 2.0, 4.5 + math.sin(a) * 3.6), 0.25, 1.6, 'steel:rust', up=(0, 1, 0)))
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
    if glow:   # sooted dark lip instead of an HDR lid (a lid outlives the fogged stack as a floating oval)
        g.merge(P.ring(r1 * 1.05, r1 * 0.75, 2.0, 24, bevel=0.0, mat='far:dark', z0=h - 1.0))
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
