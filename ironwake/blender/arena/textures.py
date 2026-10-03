"""blender/arena/textures.py - tiling texture sets for Halvard Deep Foundry, Pier 7.

    python3 blender/arena/textures.py [--preview out.png] [--only concrete,slab]

Writes assets/arena/tex/<set>_{a,n,d}.<ext> (albedo sRGB, tangent normal OpenGL, data).
Channel packing of the DATA map depends on the set (see src/world/materials.js):

  concrete, slab, ash   d = (R cavity/AO, G roughness, B height)
  steel, corr           a = RUST / bare underlayer albedo (paint colour comes from vertex tint)
                        d = (R paint coverage 0..1 - thresholded in the shader,
                             G underlayer roughness, B paint grime multiplier)
  trim                  standard (R AO, G roughness, B metalness)
  detail                (R albedo detail, G normal.x, B normal.y) - 1 m tile, overlays near camera
  noise                 (R blotch fbm, G mid fbm, B vertical streaks)  - world-space macro breakup
  decal                 greyscale coverage atlas (colour from vertex tint)

All ORIGINAL designs (IRONWAKE setting, AC6_BENCHMARK section 5).
"""
import math
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (R, blur, disc_field, enc_normal, font, grid, height_to_normal, line_dist_periodic,
                    norm01, save, spectral, srgb, sstep, voronoi)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'arena', 'tex')

# encoding choices: everything lossy webp (the arena's 4 MB lane budget)
FMT = {'a': ('.webp', 78), 'n': ('.webp', 76), 'd': ('.webp', 76)}   # webp: ~35% smaller than jpeg at equal quality


def write(name, a=None, n=None, d=None, sizes=None):
    sizes = sizes or {}
    out = {}
    for k, img in (('a', a), ('n', n), ('d', d)):
        if img is None:
            continue
        ext, q = FMT[k]
        p = os.path.join(OUT, f'{name}_{k}{ext}')
        out[k] = save(img, p, quality=q, size=sizes.get(k))
    return out


def C(h):
    return srgb(h)[None, None, :]


def mix(a, b, t):
    if np.ndim(t) == 2:
        t = t[..., None]
    return a + (b - a) * t


# ============================================================================ CONCRETE (walls)
def concrete(n=1024, seed=11):
    """Board-formed brutalist concrete, 6 m tile: 4 x 2 formwork panels (1.5 x 3 m) with tie
    holes, plank marks, bug holes, rusty tie streaks and water staining under the joints."""
    T = 6.0
    ppm = n / T
    x, y = grid(n)
    rg = R(seed)
    pw, ph = n / 4, n / 2
    col = np.floor(x / pw).astype(int) % 4
    row = np.floor(y / ph).astype(int) % 2
    pid = row * 4 + col
    ptone = rg.normal(0, 0.045, 8).astype(np.float32)[pid]
    pwarm = rg.normal(0, 0.005, 8).astype(np.float32)[pid]
    poff = rg.normal(0, 0.5, 8).astype(np.float32)[pid]
    # plank marks: horizontal boards 0.15 m, random per-board offset
    bh = ppm * 0.15
    brow = np.floor((y + (col * 7.3) % bh) / bh).astype(int)
    boff = R(seed + 1).normal(0, 0.22, 4096).astype(np.float32)[(brow * 4 + col) % 4096]
    bline = line_dist_periodic(y + (col * 7.3) % bh, bh)
    grain = spectral(n, seed + 2, beta=1.6, fmin=4, aniso=(10.0, 1.0))
    # panel joints (recessed 2px) + slight lip from panel misalignment
    jd = np.minimum(line_dist_periodic(x, pw), line_dist_periodic(y, ph))
    joint = 1 - sstep(0.8, 2.4, jd)
    # tie holes: 2 x 3 per panel
    centers = []
    for pr in range(2):
        for pc in range(4):
            for fx in (0.25, 0.75):
                for fy in (1 / 6, 0.5, 5 / 6):
                    centers.append(((pc + fx) * pw + rg.normal(0, 1.2), (pr + fy) * ph + rg.normal(0, 1.2)))
    dh = disc_field(n, centers, 7.0)
    hole = 1 - sstep(2.6, 3.8, dh)
    plug = (1 - sstep(5.0, 7.0, dh)) * (1 - hole)
    # bug holes (air voids), denser near panel tops
    pts = []
    for i in range(2600):
        px_, py_ = rg.random() * n, rg.random() * n
        top = 1.0 - ((py_ % ph) / ph)
        if rg.random() < 0.35 + 0.65 * top ** 2:
            pts.append((px_, py_))
    dp = disc_field(n, pts, 2.2)
    pit = 1 - sstep(0.6, 1.9, dp)
    fine = spectral(n, seed + 3, beta=0.6, fmin=60)
    mid = spectral(n, seed + 4, beta=2.0, fmin=2, fmax=40)
    macro = spectral(n, seed + 5, beta=2.6, fmin=1, fmax=8)
    # height (px units)
    H = poff * 0.6 + boff * 0.6 - (1 - sstep(0.0, 1.2, bline)) * 0.35 + grain * 0.10 + fine * 0.06 + mid * 0.25
    H = H - joint * 2.2 - hole * 3.0 + plug * 0.25 - pit * 1.2
    # staining: water runs from horizontal joints downward + rust from ties
    yin = np.mod(y, ph)  # distance below the panel top joint
    streakN = norm01(spectral(n, seed + 6, beta=1.4, fmin=3, aniso=(1.0, 14.0)))
    water = sstep(0.45, 0.85, streakN) * np.exp(-yin / (ph * 0.55)) * 0.9
    water += sstep(0.62, 0.9, norm01(spectral(n, seed + 7, beta=1.8, fmin=2, aniso=(1.0, 9.0)))) * 0.35
    water = np.clip(water, 0, 1)
    rust = np.zeros((n, n), np.float32)
    for (cx, cy) in centers:
        if rg.random() < 0.6:
            L = rg.uniform(40, 200)
            wdt = rg.uniform(1.5, 4.0)
            dx = np.minimum(np.abs(x - cx), n - np.abs(x - cx))
            dyy = np.mod(y - cy, n)
            s = np.exp(-(dx / wdt) ** 2) * np.exp(-dyy / L) * (dyy < L * 3)
            rust = np.maximum(rust, s * rg.uniform(0.4, 1.0))
    rust *= 0.7 + 0.3 * norm01(fine)
    efflo = sstep(0.7, 0.95, norm01(spectral(n, seed + 8, beta=2.2, fmin=3, fmax=30))) * (0.3 + 0.7 * np.exp(-(ph - yin) / 60.0))
    # albedo
    base = C('#7a7872') * (1 + ptone[..., None] + 0.05 * macro[..., None] + 0.035 * mid[..., None] + 0.03 * fine[..., None])
    base = base + np.stack([pwarm, pwarm * 0.3, -pwarm], -1)
    base = base * (1 - 0.06 * (boff[..., None] + 0.5 * grain[..., None]) * 0.5)
    base = mix(base, base * 0.66, water * 0.8)
    base = mix(base, C('#7a4b2c'), rust * 0.75)
    base = mix(base, C('#b3aea3'), efflo * 0.35)
    base = base * (1 - 0.55 * joint[..., None]) * (1 - 0.75 * hole[..., None]) * (1 - 0.45 * pit[..., None])
    base = mix(base, base * 0.85, plug * 0.6)
    rough = 0.9 + 0.04 * fine - 0.12 * water - 0.05 * rust + 0.05 * hole
    cav = 1 - 0.55 * joint - 0.75 * hole - 0.45 * pit
    cav = cav * (1 - 0.15 * sstep(0, 1, -mid * 0.5))
    nrm = height_to_normal(H, 0.9)
    hgt = norm01(blur(H, 1.0))
    return base, enc_normal(nrm), np.stack([cav, rough, hgt], -1)


# ============================================================================ SLAB (yard floor)
def slab(n=1024, seed=21):
    """Yard slabs, 12 m tile: 2 x 2 cast slabs (6 m) with tar-sealed expansion joints and
    edge spalls, 3 m saw cuts, cracks, oil + rust stains, patch repairs, drag scuffs."""
    T = 12.0
    ppm = n / T
    x, y = grid(n)
    rg = R(seed)
    sw = n / 2
    sid = (np.floor(y / sw).astype(int) % 2) * 2 + (np.floor(x / sw).astype(int) % 2)
    stone = rg.normal(0, 0.05, 4).astype(np.float32)[sid]
    swarm = rg.normal(0, 0.015, 4).astype(np.float32)[sid]
    wn = spectral(n, seed + 1, beta=1.2, fmin=20)
    ej = np.minimum(line_dist_periodic(x, sw), line_dist_periodic(y, sw))
    spallN = norm01(spectral(n, seed + 2, beta=1.5, fmin=6))
    joint = 1 - sstep(1.1, 2.0, ej)
    spall = (1 - sstep(1.5, 1.6 + 6.0 * sstep(0.62, 0.95, spallN), ej)) * (1 - joint)
    sc = np.minimum(line_dist_periodic(x + sw / 2, sw), line_dist_periodic(y + sw / 2, sw))
    saw = (1 - sstep(0.3, 1.1, sc)) * (0.6 + 0.4 * sstep(0.3, 0.7, spallN))
    # broom finish, direction alternates per slab
    b1 = spectral(n, seed + 3, beta=1.0, fmin=40, aniso=(1.0, 12.0))
    b2 = spectral(n, seed + 4, beta=1.0, fmin=40, aniso=(12.0, 1.0))
    broom = np.where(sid % 3 == 0, b1, b2)
    agg = spectral(n, seed + 5, beta=0.2, fmin=120)
    speck = sstep(2.2, 3.0, agg) - sstep(2.3, 3.2, -agg)
    macro = spectral(n, seed + 6, beta=2.6, fmin=1, fmax=10)
    mid = spectral(n, seed + 7, beta=2.0, fmin=4, fmax=60)
    # cracks: warped voronoi edges on some cells
    wx = spectral(n, seed + 8, beta=2.2, fmin=2, fmax=40) * 9
    wy = spectral(n, seed + 9, beta=2.2, fmin=2, fmax=40) * 9
    F1, F2, ID = voronoi(n, 7, seed + 10, warp=(wx, wy))
    keep = (R(seed + 11).random(49) < 0.45)[ID]
    edge = F2 - F1
    crack = (1 - sstep(0.4, 1.3, edge)) * keep * sstep(0.35, 0.6, norm01(spectral(n, seed + 12, beta=2, fmin=2, fmax=20)))
    F1b, F2b, IDb = voronoi(n, 20, seed + 13, warp=(wx * 0.5, wy * 0.5))
    hair = (1 - sstep(0.2, 0.8, F2b - F1b)) * sstep(0.62, 0.8, norm01(spectral(n, seed + 14, beta=2, fmin=2, fmax=12)))
    crack = np.clip(crack + hair * 0.55, 0, 1)
    # oil stains (dark, glossy) and rust blooms
    oilN = norm01(spectral(n, seed + 15, beta=2.6, fmin=2, fmax=28))
    oil = sstep(0.74, 0.9, oilN)
    oilring = sstep(0.7, 0.75, oilN) * (1 - sstep(0.75, 0.8, oilN))
    rustN = norm01(spectral(n, seed + 16, beta=2.0, fmin=3, fmax=70))
    rust = sstep(0.72, 0.9, rustN) * sstep(0.4, 0.7, norm01(mid))
    # drag scuffs: long streaks
    drag = sstep(0.8, 0.95, norm01(spectral(n, seed + 17, beta=1.2, fmin=2, aniso=(22.0, 1.0)))) * 0.6
    # patch repairs (rectangles)
    patch = np.zeros((n, n), np.float32)
    for i in range(3):
        cx, cy = rg.random() * n, rg.random() * n
        hw, hh = rg.uniform(20, 70), rg.uniform(20, 60)
        dx = np.minimum(np.abs(x - cx), n - np.abs(x - cx))
        dy = np.minimum(np.abs(y - cy), n - np.abs(y - cy))
        patch = np.maximum(patch, (1 - sstep(hw - 1.5, hw + 1.5, dx)) * (1 - sstep(hh - 1.5, hh + 1.5, dy)))
    pedge = np.clip(blur(patch, 1.2) * (1 - blur(patch, 1.2)) * 4, 0, 1)
    dirtj = np.exp(-ej / 5.0) * 0.8 + np.exp(-sc / 3.0) * 0.3
    # height
    H = broom * 0.08 + mid * 0.3 + agg * 0.05 - joint * 1.6 - spall * 1.2 - saw * 0.8 - crack * 1.4 + patch * 0.25 - pedge * 0.4
    # albedo
    base = C('#797874') * (1 + stone[..., None] + 0.06 * macro[..., None] + 0.035 * mid[..., None] + 0.03 * broom[..., None] * 0.5)
    base = base + np.stack([swarm, swarm * 0.4, -swarm * 0.8], -1)
    base = base * (1 + 0.12 * speck[..., None])
    base = mix(base, C('#6f6a62'), patch * 0.7)
    base = mix(base, base * 0.72, dirtj * 0.6)
    base = mix(base, C('#7b5a42'), rust * 0.55)
    base = mix(base, C('#2e2a26'), oil * 0.62 + oilring * 0.25)
    base = mix(base, base * 0.8, drag)
    base = mix(base, C('#a09a8e'), spall * 0.5)
    base = mix(base, C('#3b3733'), joint * 0.7)
    base = mix(base, base * 0.75, saw * 0.6)
    base = mix(base, C('#2b2825'), crack * 0.85)
    rough = 0.9 + 0.035 * wn - 0.38 * oil - 0.1 * oilring - 0.3 * joint - 0.06 * drag
    cav = 1 - 0.6 * joint - 0.5 * crack - 0.35 * saw - 0.3 * spall - 0.2 * dirtj
    nrm = height_to_normal(H, 0.8)
    return base, enc_normal(nrm), np.stack([cav, rough, norm01(blur(H, 1.5))], -1)


# ============================================================================ ASH (dirt / ballast)
def ash(n=1024, seed=31):
    """Ash-covered ground with slag gravel and rust flakes, 8 m tile."""
    x, y = grid(n)
    macro = spectral(n, seed, beta=2.4, fmin=1, fmax=12)
    mid = spectral(n, seed + 1, beta=1.8, fmin=4, fmax=80)
    fine = spectral(n, seed + 2, beta=0.5, fmin=80)
    cover = sstep(-0.4, 0.8, spectral(n, seed + 3, beta=2.2, fmin=2, fmax=30))  # gravel coverage
    wx = spectral(n, seed + 4, beta=2, fmin=4, fmax=90) * 2.5
    wy = spectral(n, seed + 5, beta=2, fmin=4, fmax=90) * 2.5
    F1, F2, ID = voronoi(n, 150, seed + 6, jitter=1.0, warp=(wx, wy))
    rg = R(seed + 7)
    kind = rg.random(150 * 150)
    size = rg.random(150 * 150)
    k = kind[ID]
    stone_on = (size[ID] < 0.25 + 0.7 * cover)
    rim = sstep(0.4, 2.2, F2 - F1)
    dome = np.sqrt(np.clip(rim, 0, 1)) * stone_on
    # colours: slag glass black, rust brown, grey stone, pale ash lumps
    c_slag, c_rust, c_grey, c_pale = C('#2e2c2a'), C('#56402f'), C('#5a5651'), C('#6f6a62')
    stone = np.where((k < 0.4)[..., None], c_slag, np.where((k < 0.62)[..., None], c_rust, np.where((k < 0.9)[..., None], c_grey, c_pale)))
    shade = np.clip(0.55 + 0.45 * np.sqrt(np.clip(rim, 0, 1)) + 0.25 * height_to_normal(dome * 3.0, 1.0)[..., 1], 0.3, 1.25)
    stone = stone * (0.85 + 0.3 * rg.random(150 * 150)[ID][..., None]) * shade[..., None]
    ashc = C('#56514b') * (1 + 0.12 * macro[..., None] + 0.08 * mid[..., None] + 0.05 * fine[..., None])
    ashc = mix(ashc, C('#6d665d'), sstep(0.5, 1.5, macro) * 0.5)
    base = mix(ashc, stone, dome * 0.8)
    flake = sstep(2.3, 2.8, spectral(n, seed + 8, beta=0.8, fmin=60))
    base = mix(base, C('#6e3f22'), flake * 0.6)
    H = mid * 0.4 + macro * 0.6 + dome * 2.2 + fine * 0.08
    glass = (k < 0.4) * dome
    rough = 0.93 - 0.45 * glass + 0.03 * fine
    cav = 1 - 0.45 * (1 - rim) * stone_on
    nrm = height_to_normal(H, 0.9)
    return base, enc_normal(nrm), np.stack([cav, rough, norm01(blur(H, 1.0))], -1)


# ============================================================================ STEEL (painted plate)
def _rust_layer(n, seed):
    macro = spectral(n, seed, beta=2.2, fmin=1, fmax=20)
    mid = spectral(n, seed + 1, beta=1.6, fmin=6, fmax=120)
    fine = spectral(n, seed + 2, beta=0.4, fmin=100)
    t1 = norm01(macro * 0.6 + mid * 0.4)
    c = mix(C('#5a3120'), C('#8c4a26'), sstep(0.3, 0.7, t1))
    c = mix(c, C('#a55a2c'), sstep(0.65, 0.9, norm01(mid)) * 0.7)
    c = mix(c, C('#2e2622'), sstep(0.55, 0.85, norm01(spectral(n, seed + 3, beta=2.0, fmin=3, fmax=60))) * 0.6)
    c = mix(c, C('#56524e'), sstep(0.72, 0.9, norm01(spectral(n, seed + 4, beta=1.8, fmin=4, fmax=60))) * 0.55)
    c = c * (1 + 0.1 * fine[..., None])
    pitting = sstep(1.8, 2.6, spectral(n, seed + 5, beta=0.3, fmin=90))
    rough = 0.82 + 0.08 * fine - 0.12 * sstep(0.72, 0.9, t1)
    return c, rough, mid, fine, pitting


def steel(n=1024, seed=41):
    """Painted structural steel, 3 m tile. Albedo = rust/bare underlayer; paint coverage in
    data.R is thresholded in the shader (wear varies over the world); paint grime in data.B."""
    x, y = grid(n)
    c, rrough, mid, fine, pitting = _rust_layer(n, seed)
    cov = norm01(spectral(n, seed + 10, beta=2.2, fmin=2, fmax=70)) * 0.82
    cov += 0.12 * norm01(spectral(n, seed + 11, beta=1.6, fmin=12, fmax=160)) + 0.06 * norm01(spectral(n, seed + 17, beta=0.8, fmin=100))
    # flaking: voronoi cells lower coverage at some cells (paint lifting in flakes)
    # clustered flaking: only where a low-frequency mask allows it (no uniform polka dots)
    F1, F2, ID = voronoi(n, 28, seed + 12)
    flk = R(seed + 13).random(28 * 28)[ID]
    clus = sstep(0.62, 0.8, norm01(spectral(n, seed + 18, beta=2.4, fmin=1, fmax=8)))
    cov -= 0.22 * (flk > 0.5) * sstep(1.0, 5.0, F2 - F1) * clus
    # scratches
    sc = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(sc)
    rg = R(seed + 14)
    for i in range(70):
        x0, y0 = rg.random() * n, rg.random() * n
        ang = rg.normal(0, 0.35) + (0 if rg.random() < 0.7 else math.pi / 2)
        L = rg.uniform(20, 160)
        pts = [(x0, y0)]
        for k in range(6):
            ang += rg.normal(0, 0.08)
            pts.append((pts[-1][0] + math.cos(ang) * L / 6, pts[-1][1] + math.sin(ang) * L / 6))
        for dx in (-n, 0, n):
            for dy in (-n, 0, n):
                d.line([(p[0] + dx, p[1] + dy) for p in pts], fill=int(rg.uniform(120, 255)), width=int(rg.integers(1, 3)))
    scr = np.asarray(sc, np.float32) / 255
    cov = np.clip(cov - scr * 0.5, 0, 1)
    # paint grime: vertical runs + mottling (0.5 = neutral, shader maps around it)
    streak = norm01(spectral(n, seed + 15, beta=1.3, fmin=3, aniso=(1.0, 16.0)))
    grime = 0.62 + 0.14 * spectral(n, seed + 16, beta=2.2, fmin=1, fmax=30) / 2.5 - 0.22 * sstep(0.55, 0.95, streak)
    grime += 0.04 * fine / 2.5 - 0.12 * scr
    grime = np.clip(grime, 0, 1)
    # height: paint film step at the default threshold + pitting in bare areas
    film = sstep(0.28, 0.36, cov)
    H = film * 0.9 + mid * 0.08 - pitting * 0.6 * (1 - film) + fine * 0.03 - scr * 0.3
    nrm = height_to_normal(H, 1.2)
    return c, enc_normal(nrm), np.stack([cov, rrough, grime], -1)


def corrugated(n=512, seed=51):
    """Trapezoidal-profile cladding, 3 m tile (16 ribs), screw rows every 1.5 m with rust
    halos and runs, dents. Same packing as steel."""
    x, y = grid(n)
    c, rrough, mid, fine, pitting = _rust_layer(n, seed)
    period = n / 16
    u = np.mod(x, period) / period
    prof = sstep(0.05, 0.18, u) * (1 - sstep(0.45, 0.58, u))  # raised trapezoid rib
    dent = spectral(n, seed + 1, beta=2.6, fmin=2, fmax=24)
    # screws on purlins (y = 0.25 and 0.75 of the tile), on the valleys
    centers = []
    for yy in (n * 0.25, n * 0.75):
        for i in range(16):
            centers.append(((i + 0.78) * period, yy))
    ds = disc_field(n, centers, 3.0)
    screw = 1 - sstep(1.5, 2.6, ds)
    halo = (1 - sstep(2.0, 9.0, ds))
    runs = np.zeros((n, n), np.float32)
    rg = R(seed + 2)
    for (cx, cy) in centers:
        L = rg.uniform(20, 120)
        dx = np.minimum(np.abs(x - cx), n - np.abs(x - cx))
        dyy = np.mod(y - cy, n)
        runs = np.maximum(runs, np.exp(-(dx / rg.uniform(1.5, 3.5)) ** 2) * np.exp(-dyy / L) * (dyy < 3 * L))
    cov = norm01(spectral(n, seed + 3, beta=2.2, fmin=2, fmax=40)) * 0.88 + 0.12 * norm01(spectral(n, seed + 7, beta=1.4, fmin=8, fmax=90))
    cov = cov - 0.45 * halo - 0.5 * runs * 0.6
    # rib crests wear first
    cov = cov - 0.12 * prof * sstep(0.3, 0.8, norm01(mid))
    cov = np.clip(cov, 0, 1)
    streak = norm01(spectral(n, seed + 4, beta=1.3, fmin=3, aniso=(1.0, 14.0)))
    grime = 0.62 + 0.1 * spectral(n, seed + 5, beta=2.2, fmin=1, fmax=20) / 2.5 - 0.25 * sstep(0.5, 0.95, streak) - 0.2 * runs
    grime -= 0.18 * (1 - prof)  # dirt collects in valleys
    grime = np.clip(grime, 0, 1)
    H = prof * 6.0 + dent * 0.8 + screw * 1.0 + mid * 0.05
    nrm = height_to_normal(blur(H, 0.6), 1.0)
    c = mix(c, c * 0.7, 1 - prof)
    return c, enc_normal(nrm), np.stack([cov, rrough, grime], -1)


# ============================================================================ TRIM SHEET
TRIM_ROWS = {  # name: (v0, v1) in UV space (0 = bottom), matches src/world/materials.js
    'hazard': (1 - 128 / 1024, 1.0),
    'hazard2': (1 - 256 / 1024, 1 - 128 / 1024),
    'window': (1 - 512 / 1024, 1 - 256 / 1024),
    'louvre': (1 - 640 / 1024, 1 - 512 / 1024),
    'grating': (1 - 768 / 1024, 1 - 640 / 1024),
    'stencil': (1 - 896 / 1024, 1 - 768 / 1024),
    'bolted': (0.0, 1 - 896 / 1024),
}


def trim(n=1024, seed=61):
    """Trim sheet: horizontal strips that tile in U (see TRIM_ROWS)."""
    x, y = grid(n)
    A = np.zeros((n, n, 3), np.float32)
    H = np.zeros((n, n), np.float32)
    AO = np.ones((n, n), np.float32)
    RO = np.full((n, n), 0.7, np.float32)
    ME = np.zeros((n, n), np.float32)
    rust, rrough, mid, fine, pitting = _rust_layer(n, seed)
    grime = spectral(n, seed + 1, beta=2.0, fmin=2, fmax=60)
    streak = norm01(spectral(n, seed + 2, beta=1.3, fmin=3, aniso=(1.0, 10.0)))
    wear = norm01(spectral(n, seed + 3, beta=1.6, fmin=4, fmax=200))

    def band(r0, r1):
        return (y >= r0) & (y < r1)

    # hazard stripes (two variants)
    for (r0, r1, amt) in ((0, 128, 0.3), (128, 256, 0.5)):
        m = band(r0, r1)
        s = np.mod(x + (y - r0), 128) < 64
        col = np.where(s[..., None], C('#d8a31a'), C('#1b1a19'))
        col = col * (0.88 + 0.12 * grime[..., None] / 2.5 + 0.0)
        chip = wear < amt * 0.55 + 0.25 * sstep(0.2, 0.9, streak)
        col = np.where(chip[..., None], rust * 0.9, col)
        col = col * (1 - 0.3 * sstep(0.6, 0.95, streak)[..., None])
        edge = np.minimum(y - r0, r1 - 1 - y)
        col = mix(col, rust * 0.7, (1 - sstep(0, 5, edge)) * 0.8)
        A[m] = col[m]
        H[m] = np.where(chip, -0.4, 0.2)[m]
        RO[m] = np.where(chip, 0.85, 0.55)[m]
        AO[m] = (1 - 0.4 * (1 - sstep(0, 3, edge)))[m]
    # windows: 2 m bays (256 px) of steel-framed small panes, 4 rows x 6 cols per bay
    r0, r1 = 256, 512
    m = band(r0, r1)
    lx = np.mod(x, 256)
    ly = y - r0
    frame_big = (lx < 14) | (lx > 242) | (ly < 14) | (ly > 242)
    pxw, pyw = (256 - 28) / 6, (256 - 28) / 4
    mx = np.mod(lx - 14, pxw)
    my = np.mod(ly - 14, pyw)
    mull = (mx < 3) | (mx > pxw - 3) | (my < 3) | (my > pyw - 3)
    pane_id = (np.floor((lx - 14) / pxw) + 7 * np.floor((ly - 14) / pyw) + 97 * np.floor(x / 256)).astype(int)
    prand = R(seed + 4).random(4096)[np.clip(pane_id, 0, 4095)]
    broken = prand < 0.18
    glass = C('#1f2426') * (0.7 + 0.6 * (ly[..., None] / 256.0)) * (0.85 + 0.3 * prand[..., None])
    glass = mix(glass, C('#4b463f'), sstep(0.3, 0.9, norm01(grime)) * 0.55)  # grime film
    glass = np.where(broken[..., None], C('#060606'), glass)
    framec = C('#3b3d3a') * (0.9 + 0.1 * grime[..., None] / 2.5)
    framec = mix(framec, rust, sstep(0.55, 0.85, wear) * 0.7)
    wcol = np.where((frame_big | mull)[..., None], framec, glass)
    A[m] = wcol[m]
    H[m] = np.where(frame_big, 1.2, np.where(mull, 0.6, np.where(broken, -2.0, -0.4)))[m]
    RO[m] = np.where(frame_big | mull, 0.6, np.where(broken, 1.0, 0.18))[m]
    ME[m] = np.where(frame_big | mull, 0.3, 0.0)[m]
    AO[m] = np.where(broken, 0.25, 1.0)[m]
    # louvres: slats every 16 px
    r0, r1 = 512, 640
    m = band(r0, r1)
    ly = y - r0
    t = np.mod(ly, 16) / 16
    slat = t
    col = C('#565a5a') * (0.55 + 0.6 * slat[..., None]) * (0.9 + 0.1 * grime[..., None] / 2.5)
    col = mix(col, rust, sstep(0.6, 0.9, wear) * 0.8)
    A[m] = col[m]
    H[m] = (slat * 3.0)[m]
    AO[m] = (0.35 + 0.65 * slat)[m]
    RO[m] = 0.6
    ME[m] = 0.35
    # grating: bearing bars every 12 px, cross rods every 48
    r0, r1 = 640, 768
    m = band(r0, r1)
    ly = y - r0
    bar = np.mod(x, 12) < 3
    rod = np.mod(ly, 48) < 3
    hole = ~(bar | rod)
    col = np.where(hole[..., None], C('#0d0d0c'), C('#4a4a47') * (0.85 + 0.3 * wear[..., None]))
    col = mix(col, rust, (sstep(0.6, 0.9, wear) * (~hole))[..., None] * 0.7)
    A[m] = col[m]
    H[m] = np.where(hole, -3.0, np.where(rod, 1.0, 0.5))[m]
    AO[m] = np.where(hole, 0.1, 1.0)[m]
    RO[m] = 0.55
    ME[m] = np.where(hole, 0.0, 0.6)[m]
    # stencil strip: dark painted steel with bone stencils (two 64 px lines)
    r0, r1 = 768, 896
    im = Image.new('L', (n, 128), 0)
    d = ImageDraw.Draw(im)
    f1 = font('stencil', 50)
    fj = font('jp', 40)
    d.text((16, 6), 'PIER 07', font=f1, fill=255)
    d.text((230, 10), '第7埠頭', font=fj, fill=255)
    d.text((430, 6), 'MAX 40t', font=f1, fill=255)
    d.text((640, 10), '荷重注意', font=fj, fill=255)
    d.text((840, 6), 'HDF-07', font=f1, fill=255)
    f2 = font('mono', 34)
    d.text((16, 76), 'HALVARD DEEP FOUNDRY', font=f2, fill=255)
    d.text((500, 72), '高温注意', font=font('jp', 38), fill=255)
    d.text((700, 76), 'GRAUWERK', font=f2, fill=255)
    txt = np.asarray(im, np.float32) / 255
    m = band(r0, r1)
    ly = (y - r0).astype(int)
    tt = np.zeros((n, n), np.float32)
    tt[r0:r1] = txt
    tt = tt * sstep(0.25, 0.5, wear)
    col = C('#2a2c2c') * (0.85 + 0.15 * grime[..., None] / 2.5)
    col = mix(col, rust, sstep(0.7, 0.95, wear) * 0.6)
    col = mix(col, C('#cfc8b8'), tt)
    A[m] = col[m]
    H[m] = (tt * 0.2)[m]
    RO[m] = 0.62
    # bolted plate band: seam at mid + bolts every 32 px
    r0, r1 = 896, 1024
    m = band(r0, r1)
    ly = y - r0
    seam = np.abs(ly - 64) < 1.5
    bc = []
    for i in range(32):
        bc += [(i * 32 + 16, r0 + 40), (i * 32 + 16, r0 + 88)]
    db = disc_field(n, bc, 5.0)
    bolt = 1 - sstep(4.0, 5.5, db)
    col = C('#4d504f') * (0.9 + 0.2 * grime[..., None] / 2.5)
    col = mix(col, rust, np.clip(sstep(0.62, 0.9, wear) + (1 - sstep(4, 14, db)) * 0.5, 0, 1) * 0.8)
    col = col * (1 - 0.5 * seam[..., None])
    A[m] = col[m]
    H[m] = (bolt * 2.5 * (1 - db / 6.0) - seam * 1.0)[m]
    AO[m] = (1 - 0.5 * seam - 0.3 * (1 - sstep(4.5, 7, db)) * (1 - bolt))[m]
    RO[m] = 0.6
    ME[m] = 0.25
    nrm = height_to_normal(blur(H, 0.5), 1.2)
    return A, enc_normal(nrm), np.stack([AO, RO, ME], -1)


# ============================================================================ DETAIL / NOISE / DECAL
def detail(n=512, seed=71):
    x, y = grid(n)
    a = spectral(n, seed, beta=0.8, fmin=8)
    b = spectral(n, seed + 1, beta=1.4, fmin=4)
    H = a * 0.6 + b * 0.4
    nrm = height_to_normal(H, 0.35)
    alb = 0.5 + 0.12 * (a * 0.7 + b * 0.3) / 2.0
    return np.stack([np.clip(alb, 0, 1), nrm[..., 0] * 0.5 + 0.5, nrm[..., 1] * 0.5 + 0.5], -1)


def noise(n=512, seed=81):
    r = norm01(spectral(n, seed, beta=2.4, fmin=1, fmax=24))
    g = norm01(spectral(n, seed + 1, beta=1.8, fmin=3, fmax=90))
    b = norm01(spectral(n, seed + 2, beta=1.2, fmin=2, aniso=(1.0, 14.0)))
    return np.stack([r, g, b], -1)


DECAL_CELLS = {  # name: (u0, v0, u1, v1) in UV (0 = bottom-left) of the 1024 x 2048 atlas
    # top half: 4 x 4 grid of 256 px cells (ground markings)
    'num07': (0.0, 0.75, 0.5, 1.0), 'ring': (0.5, 0.75, 1.0, 1.0), 'arrow': (0.0, 0.625, 0.25, 0.75),
    'hatch': (0.25, 0.625, 0.5, 0.75), 'line': (0.5, 0.625, 0.625, 0.75), 'dash': (0.625, 0.625, 0.75, 0.75),
    'p7': (0.75, 0.625, 1.0, 0.75), 'noentry': (0.0, 0.5, 0.5, 0.625), 'stain': (0.5, 0.5, 0.75, 0.625),
    'scorch': (0.75, 0.5, 1.0, 0.625),
    # bottom half: wall runs + tyre tracks (256 x 1024 strips) and stencil digits (256 x 256)
    'streak': (0.0, 0.0, 0.25, 0.5), 'curtain': (0.25, 0.0, 0.5, 0.5), 'tracks': (0.5, 0.0, 0.75, 0.5),
    'd1': (0.75, 0.375, 1.0, 0.5), 'd2': (0.75, 0.25, 1.0, 0.375), 'd3': (0.75, 0.125, 1.0, 0.25), 'd4': (0.75, 0.0, 1.0, 0.125),
}


def _decal_top(n=1024, seed=91):
    im = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(im)
    # "07" big floor stencil (top-left 512 x 512)
    f = font('stencil', 430)
    d.text((40, -40), '07', font=f, fill=255)
    d.rectangle([236, 0, 250, 512], fill=0)  # stencil bridges
    # pad ring with ticks (top-right 512 x 512)
    cx, cy = 768, 256
    d.ellipse([cx - 236, cy - 236, cx + 236, cy + 236], outline=255, width=26)
    d.ellipse([cx - 170, cy - 170, cx + 170, cy + 170], outline=255, width=10)
    for k in range(12):
        a = k * math.pi / 6
        d.line([(cx + math.cos(a) * 180, cy + math.sin(a) * 180), (cx + math.cos(a) * 214, cy + math.sin(a) * 214)], fill=255, width=12)
    d.line([(cx - 90, cy), (cx + 90, cy)], fill=255, width=12)
    d.line([(cx, cy - 90), (cx, cy + 90)], fill=255, width=12)
    # arrow (0,512)-(256,768)
    d.polygon([(128, 520), (240, 640), (170, 640), (170, 760), (86, 760), (86, 640), (16, 640)], fill=255)
    # hazard hatch box (256,512)-(512,768)
    hb = Image.new('L', (256, 256), 0)
    hd = ImageDraw.Draw(hb)
    for k in range(-256, 512, 48):
        hd.polygon([(k, 0), (k + 24, 0), (k + 24 + 256, 256), (k + 256, 256)], fill=255)
    hd.rectangle([0, 0, 255, 255], outline=255, width=14)
    im.paste(hb, (256, 512))
    # solid lane line + dashed (vertical strips)
    d.rectangle([512 + 12, 512, 512 + 116, 768], fill=255)
    d.rectangle([640 + 12, 520, 640 + 116, 760], fill=255)
    # "P7" (768,512)-(1024,768)
    d.text((786, 520), 'P7', font=font('stencil', 200), fill=255)
    # "NO ENTRY / 立入禁止" (0,768)-(512,1024)
    d.text((20, 780), 'NO ENTRY', font=font('stencil', 120), fill=255)
    d.text((40, 910), '立入禁止', font=font('jp', 96), fill=255)
    # stain + scorch blobs
    a = np.asarray(im, np.float32) / 255
    x, y = grid(n)
    for (ox, oy, sc, k) in ((512, 768, 1.0, 0), (768, 768, 1.3, 1)):
        lx, ly = (x - ox - 128) / 128.0, (y - oy - 128) / 128.0
        r = np.sqrt(lx * lx + ly * ly)
        nz = spectral(n, seed + 3 + k, beta=2.0, fmin=4, fmax=120) * 0.25
        blob = (1 - sstep(0.55, 0.95, r + nz)) * ((x >= ox) & (x < ox + 256) & (y >= oy) & (y < oy + 256))
        a = np.maximum(a, blob * (0.7 + 0.3 * nz) if k == 0 else blob * (1 - 0.5 * sstep(0.2, 0.9, r)))
    # wear: eroded paint
    wear = norm01(spectral(n, seed + 1, beta=1.6, fmin=6, fmax=300))
    fine = norm01(spectral(n, seed + 2, beta=0.5, fmin=100))
    keep = sstep(0.1, 0.3, wear * 0.7 + fine * 0.3)
    a = a * (0.55 + 0.45 * keep) * (0.85 + 0.15 * fine)
    return a


def _decal_bottom(n=1024, seed=93):
    """Wall runs (rust 'streak', water/soot 'curtain'), crawler/tyre 'tracks', digits 1-4."""
    rg = R(seed)
    out = np.zeros((n, n), np.float32)
    x, y = grid(n, 256)                       # strip: 256 wide, n tall; y = 0 at the TOP (run origin)
    t = y / n
    # rust runs: thin drips from the top edge, lengths 25-100 %, fading + narrowing downward
    s1 = np.zeros((n, 256), np.float32)
    for i in range(46):
        cx = rg.uniform(0, 256)
        L = rg.uniform(0.25, 1.0) ** 0.8
        w = rg.uniform(1.5, 7.0)
        wob = np.sin(t * rg.uniform(6, 18) + rg.uniform(0, 6)) * rg.uniform(0.5, 3.0)
        d = np.abs(((x - cx - wob + 128) % 256) - 128)
        ww = w * (1.0 - 0.6 * np.clip(t / L, 0, 1)) + 0.6
        core = np.clip(1 - d / ww, 0, 1) ** 0.8
        fade = np.clip(1 - t / L, 0, 1) ** rg.uniform(0.6, 1.6)
        s1 = np.maximum(s1, core * fade * rg.uniform(0.55, 1.0))
    s1 = np.maximum(s1, sstep(0.06, 0.0, t) * 0.9)                  # source band (bolt line / seam)
    s1 *= 0.7 + 0.3 * norm01(spectral(n, seed + 1, beta=1.2, fmin=4, m=256))
    out[:, 0:256] = s1
    # curtain: broad water/soot staining under a parapet, streaky, strongest at the top
    st = norm01(spectral(n, seed + 2, beta=1.3, fmin=2, aniso=(1.0, 18.0), m=256))
    fine = norm01(spectral(n, seed + 3, beta=0.8, fmin=10, aniso=(1.0, 10.0), m=256))
    cur = (1 - t) ** 1.3 * (0.35 + 0.65 * sstep(0.35, 0.8, st)) * (0.8 + 0.2 * fine)
    cur *= sstep(0.0, 0.04, t) * 0.6 + 0.4
    out[:, 256:512] = np.clip(cur * 1.15, 0, 1)
    # tracks: two crawler treads along the strip, patchy
    # (r3) irregular: wandering tread edges, warped + chevroned lug spacing (different phase per
    # tread), soft lugs, heavy patchy drop-out -> no regular bar pattern (it read as a checkerboard)
    tr = np.zeros((n, 256), np.float32)
    warp = spectral(n, seed + 5, beta=2.6, fmin=1, fmax=5, m=256) * 9.0
    for k, cxt in enumerate((64.0, 192.0)):
        edge = np.sin(t * (9 + 5 * k) + k * 1.7) * 5.0
        band = sstep(46, 30, np.abs(x - cxt - edge))
        yy = y + warp + (x - cxt) * (0.35 if k == 0 else -0.35) + k * 9.0
        lug = 0.5 + 0.5 * np.sin(yy * 2 * math.pi / (21.0 + 3.0 * k))
        lug = 0.55 + 0.45 * sstep(0.35, 0.8, lug)
        tr = np.maximum(tr, band * lug)
    patch = sstep(0.25, 0.75, norm01(spectral(n, seed + 4, beta=2.0, fmin=2, aniso=(1.0, 6.0), m=256)))
    grit = norm01(spectral(n, seed + 6, beta=0.9, fmin=16, m=256))
    out[:, 512:768] = tr * (0.2 + 0.8 * patch) * (0.75 + 0.25 * grit) * 0.85
    # digits (stencil font, bridged)
    im = Image.fromarray((out * 255).astype(np.uint8), 'L')
    d = ImageDraw.Draw(im)
    f = font('stencil', 230)
    for k, ch in enumerate('1234'):
        ox, oy = 768, k * 256
        bb = d.textbbox((0, 0), ch, font=f)
        d.text((ox + 128 - (bb[0] + bb[2]) / 2, oy + 128 - (bb[1] + bb[3]) / 2), ch, font=f, fill=255)
    return np.asarray(im, np.float32) / 255


def decal(n=1024, seed=91):
    top = _decal_top(n, seed)
    return np.concatenate([top, _decal_bottom(n, seed + 2)], 0)


def water(n=512, seed=101):
    """Sea detail: R,G = tangent normal xy (directional wind-wave spectrum, periodic), B = foam
    pattern (warped cell-edge network + speckle)."""
    rg = R(seed)
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(n)[None, :] * n
    k = np.sqrt(fx * fx + fy * fy)
    ang = np.arctan2(fy, fx)
    wind = 0.45
    spread = np.abs(np.cos(ang - wind)) ** 3.0 + 0.08
    kp = 6.0
    P = np.where(k > 0, np.maximum(k, 1e-6) ** -4.3 * np.exp(-(kp / np.maximum(k, 1e-6)) ** 2 * 0.8), 0.0)
    P[k < 2] = 0.0
    P *= np.clip((150 - k) / 50, 0, 1)
    amp = np.sqrt(P) * spread
    F = (rg.standard_normal((n, n)) + 1j * rg.standard_normal((n, n))) * amp
    H = np.real(np.fft.ifft2(F)).astype(np.float32)
    H = (H - H.mean()) / (H.std() + 1e-9)
    # sharpen crests a little (choppy): h' = h - 0.25 h^2
    H = H + 0.18 * H * np.abs(H)
    nrm = height_to_normal(H, 4.0)
    F1, F2, _ = voronoi(n, 9, seed + 1, warp=(spectral(n, seed + 2, beta=2.4, fmin=2, fmax=30) * 14,
                                             spectral(n, seed + 3, beta=2.4, fmin=2, fmax=30) * 14))
    edge = sstep(9.0, 0.0, F2 - F1)
    brk = sstep(0.35, 0.75, norm01(spectral(n, seed + 4, beta=1.8, fmin=3, fmax=80)))
    speck = sstep(0.62, 0.9, norm01(spectral(n, seed + 5, beta=0.6, fmin=40)))
    foam = np.clip(edge * (0.4 + 0.6 * brk) + speck * 0.45 * brk + sstep(0.6, 2.2, H) * 0.5, 0, 1)
    return np.stack([nrm[..., 0] * 0.5 + 0.5, nrm[..., 1] * 0.5 + 0.5, foam], -1)


# ============================================================================ main
SETS = {
    'concrete': (concrete, {'d': 512}),
    'slab': (slab, {'d': 512}),
    'ash': (ash, {'a': 512, 'n': 512, 'd': 512}),
    'steel': (steel, {'a': 512, 'd': 512}),     # r4: the rust albedo only modulates value now (-165 KB)
    'corr': (corrugated, {}),
    'trim': (trim, {'d': 512}),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    only = None
    prev = None
    args = sys.argv[1:]
    if '--only' in args:
        only = args[args.index('--only') + 1].split(',')
    if '--preview' in args:
        prev = args[args.index('--preview') + 1]
    total = 0
    tiles = []
    for name, (fn, sizes) in SETS.items():
        if only and name not in only:
            continue
        t0 = time.time()
        a, nm, d = fn()
        r = write(name, a, nm, d, sizes)
        total += sum(r.values())
        print(f'{name:9s} {time.time() - t0:5.1f}s  ' + '  '.join(f'{k}={v / 1024:.0f}K' for k, v in r.items()))
        tiles.append((name, a, nm, d))
    for name, fn, q, ext in (('detail', detail, 80, '.webp'), ('noise', noise, 88, '.webp'), ('decal', decal, 80, '.webp'),
                             ('water', water, 88, '.webp')):
        if only and name not in only:
            continue
        img = fn()
        s = save(img, os.path.join(OUT, name + ext), quality=q)
        total += s
        print(f'{name:9s} {s / 1024:.0f}K')
        tiles.append((name, img, None, None))
    print(f'TOTAL {total / 1024:.0f} KiB')
    if prev:
        cells = []
        for name, a, nm, d in tiles:
            row = [a if a.ndim == 3 else np.repeat(a[..., None], 3, -1)]
            if nm is not None:
                row += [nm, d]
            ims = [Image.fromarray((np.clip(r_, 0, 1) * 255).astype(np.uint8)).resize((384, 384), Image.LANCZOS) for r_ in row]
            cells.append(ims)
        W = 384 * 3
        sheet = Image.new('RGB', (W, 384 * len(cells)), (40, 40, 40))
        for i, ims in enumerate(cells):
            for j, im in enumerate(ims):
                sheet.paste(im, (j * 384, i * 384))
        sheet.save(prev)
        print('preview', prev)


if __name__ == '__main__':
    main()
