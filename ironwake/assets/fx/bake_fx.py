#!/usr/bin/env python3
"""IRONWAKE VFX texture bake (owner: weapons/VFX artist). Pure numpy + Pillow, deterministic.

    python3 assets/fx/bake_fx.py            -> assets/fx/fx_puff.webp, assets/fx/fx_misc.webp (lossless)

fx_puff.webp 1024x512 RGBA (linear data), 4x2 cells of 256 px = 8 TORN puff variants
    (0-3 thick billows that fray at the rim, 4-7 wispy dust / ash; `python3 bake_fx.py --puff`)
    R  density (0 at the cell border, ragged warped-fBm silhouette, holes, soft ramp)
    G  normal x (0.5 = flat), B  normal y (+up in UV space, i.e. after three's flipY)
    A  0.5 + 0.5 * detail noise (erosion / fire temperature breakup). Alpha is kept >= 0.5 so the
       browser's premultiply/unpremultiply round trip on image upload cannot quantise RGB.
fx_misc.webp 512x512 RGBA (linear data)
    R  2x2 cells of 256: star-shaped muzzle flashes (hot core + 4..7 uneven spikes)
    G  2x2 cells of 256: scorch decals (burn intensity, ragged edge, soot streaks)
    B  4x4 cells of 128: debris / casing silhouettes (0 = outside, 0.08..1 = lit shade)
    A  0.5 + 0.5 * 512x512 tileable fBm noise (trail breakup, heat haze, ring noise)
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RNG = np.random.default_rng(7007)


# ---------------------------------------------------------------- noise helpers
def value_noise(shape, cells, rng, tile=True):
    """Smooth value noise (cubic-interpolated lattice), tileable when tile=True."""
    h, w = shape
    cy, cx = cells
    lat = rng.random((cy + 1, cx + 1))
    if tile:
        lat[-1, :] = lat[0, :]
        lat[:, -1] = lat[:, 0]
    y = np.linspace(0, cy, h, endpoint=False)
    x = np.linspace(0, cx, w, endpoint=False)
    yi = np.floor(y).astype(int); xi = np.floor(x).astype(int)
    fy = y - yi; fx = x - xi
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = lat[yi][:, xi]; b = lat[yi][:, xi + 1]
    c = lat[yi + 1][:, xi]; d = lat[yi + 1][:, xi + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(shape, base, octaves, rng, gain=0.5, tile=True):
    out = np.zeros(shape); amp = 1.0; tot = 0.0; f = base
    for _ in range(octaves):
        out += amp * value_noise(shape, (f, f), rng, tile)
        tot += amp; amp *= gain; f *= 2
    return out / tot


def blur(img, sigma):
    """Gaussian blur via FFT (wraps; callers keep content away from the borders)."""
    h, w = img.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- billow puffs
def turbo(n, rng, freqs, gain=0.55):
    """Turbulence: sum of |value noise| octaves (0..1); 1 - turbo = billowy cells."""
    t = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for f in freqs:
        v = fbm((n, n), f, 1, rng)
        t += amp * np.abs(v * 2 - 1); tot += amp; amp *= gain
    return t / tot


def puff(n=256, seed=0, wispy=False):
    """One TORN puff. Combat r1 tell: the old cells had a clean round silhouette, so overlapping
    puffs read as discs. Now the density is a FIELD (billowy turbulence + large lobes - an
    irregular, off-centre, domain-warped envelope) pushed through a wide ramp: crinkled
    cauliflower billows that fray (cells 0-3, smoke) or streaky, wispy, broken dust / ash
    (cells 4-7). The interior keeps thick and thin parts, so the runtime erosion (fx/shaders.js,
    per-particle noise) opens it up from the inside as well as the rim."""
    rng = np.random.default_rng(1000 + seed)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1.0)
    wx = fbm((n, n), 3, 4, rng) - 0.5
    wy = fbm((n, n), 3, 4, rng) - 0.5
    ws = 0.22 if wispy else 0.14
    X = xx + wx * ws; Y = yy + wy * ws
    oc = (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04))
    # large lobes (soft-max of spherical caps)
    acc = np.zeros((n, n)); k = 26.0
    for i in range(int(rng.integers(8, 14))):
        ang = rng.random() * 2 * np.pi
        rr = 0.25 * np.sqrt(rng.random())
        r = rng.uniform(0.08, 0.17) * (1.1 - rr * 1.2)
        cx = 0.5 + oc[0] + np.cos(ang) * rr; cy = 0.5 + oc[1] + np.sin(ang) * rr * (0.7 if wispy else 0.9)
        h = np.sqrt(np.clip(r * r - ((X - cx) ** 2 + (Y - cy) ** 2), 0, None))
        acc += np.exp(k * h) * (h > 0)
    H = blur(np.log1p(acc) / k, 2.0)
    Hn = H / (H.max() + 1e-6)
    bil = 1.0 - turbo(n, rng, (4, 8, 16, 32))
    fine = fbm((n, n), 14, 2, rng)
    ex = (X - 0.5 - oc[0]) / (0.5 if wispy else 0.46)
    ey = (Y - 0.5 - oc[1]) / (0.38 if wispy else 0.43)
    rr2 = ex * ex + ey * ey
    if wispy:
        str_ = 1.0 - turbo(n, rng, (3, 6, 12), 0.6)
        field = 0.6 * str_ + 0.45 * bil + 0.2 * Hn - rr2 * 0.75 - 0.25 + (fine - 0.5) * 0.15
        dens = smoothstep(0.0, 0.62, field) ** 1.3 * (0.45 + 0.55 * str_)
    else:
        field = 0.62 * bil + 0.42 * Hn - rr2 * 0.7 - 0.12 + (fine - 0.5) * 0.08
        dens = smoothstep(0.0, 0.6, field) * (0.55 + 0.45 * bil)
    # cell safety: exactly 0 near the cell border
    radial = np.maximum(np.abs(xx - 0.5), np.abs(yy - 0.5))
    dens = blur(np.clip(dens, 0, None), 0.7) * smoothstep(0.49, 0.42, radial)
    # normals: large billows + billow ridges (image rows go DOWN; UV v goes UP after flipY)
    hgt = blur(Hn * 0.9 + bil * np.exp(-rr2) * 0.3, 1.6)
    gy, gx = np.gradient(hgt * n * 0.12)
    nx = -gx; ny = gy; nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= ln; ny /= ln
    m = smoothstep(0.0, 0.08, dens)
    nx *= m; ny *= m
    detail = 0.55 * bil + 0.45 * fbm((n, n), 9, 4, rng, gain=0.55)
    detail = (detail - detail.min()) / (detail.max() - detail.min() + 1e-6)
    return dens, nx, ny, detail


def bake_puffs():
    W, Hh, n = 1024, 512, 256
    out = np.zeros((Hh, W, 4))
    for i in range(8):
        cx, cy = i % 4, i // 4
        d, nx, ny, det = puff(n, i, wispy=i >= 4)
        sl = (slice(cy * n, cy * n + n), slice(cx * n, cx * n + n))
        out[sl + (0,)] = np.clip(d / max(d.max(), 1e-6), 0, 1)
        out[sl + (1,)] = nx * 0.5 + 0.5
        out[sl + (2,)] = ny * 0.5 + 0.5
        out[sl + (3,)] = 0.5 + 0.5 * det
    q = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
    # normals + detail at 7 bits (invisible after filtering; ~15% smaller lossless file)
    q[..., 1:] = (q[..., 1:] // 2) * 2 + 1
    img = Image.fromarray(q, 'RGBA')
    p = os.path.join(HERE, 'fx_puff.webp')
    img.save(p, 'WEBP', lossless=True, method=6, exact=True)
    return p


# ---------------------------------------------------------------- misc atlas
def star(n, seed):
    rng = np.random.default_rng(2000 + seed)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1.0) - 0.5
    r = np.hypot(xx, yy) * 2; th = np.arctan2(yy, xx)
    val = np.zeros((n, n))
    spikes = int(rng.integers(4, 8))
    base = rng.random() * np.pi
    for k in range(spikes):
        a = base + k * 2 * np.pi / spikes + rng.normal(0, 0.18)
        L = rng.uniform(0.5, 0.97)
        wdt = rng.uniform(0.09, 0.2)
        da = np.angle(np.exp(1j * (th - a)))
        across = np.abs(da) * r  # arc distance from the spike axis
        along = np.clip(r / L, 0, 1.5)
        prof = np.exp(-(across / (wdt * (1.05 - along * 0.9) + 1e-3)) ** 2) * smoothstep(1.0, 0.25, along) * (np.cos(da) > 0)
        val = np.maximum(val, prof * rng.uniform(0.7, 1.0))
    core = np.exp(-(r / 0.26) ** 2)
    halo = np.exp(-(r / 0.45) ** 2) * 0.25
    ragged = 0.55 + 0.7 * fbm((n, n), 9, 3, rng)
    v = np.clip(np.maximum(val * ragged, core) + halo * ragged, 0, 1)
    v *= smoothstep(1.0, 0.85, r)
    return v


def scorch(n, seed):
    rng = np.random.default_rng(3000 + seed)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1.0) - 0.5
    r = np.hypot(xx, yy) * 2; th = np.arctan2(yy, xx)
    warp = fbm((n, n), 4, 4, rng)
    rag = 0.62 + 0.3 * (warp - 0.5) * 2
    burn = smoothstep(rag + 0.15, rag - 0.25, r)
    # radial soot streaks
    streak = np.zeros((n, n))
    for k in range(int(rng.integers(7, 13))):
        a = rng.random() * 2 * np.pi; L = rng.uniform(0.6, 0.98); w = rng.uniform(0.04, 0.1)
        da = np.abs(np.angle(np.exp(1j * (th - a))))
        streak = np.maximum(streak, np.exp(-(da / w) ** 2) * smoothstep(L, L * 0.5, r) * rng.uniform(0.5, 0.9))
    grit = fbm((n, n), 12, 3, rng)
    v = np.clip(np.maximum(burn, streak * 0.8) * (0.7 + 0.3 * grit) + 0.25 * smoothstep(0.35, 0.0, r), 0, 1)
    v *= smoothstep(1.0, 0.82, r)
    return v


def chunk(n, seed):
    rng = np.random.default_rng(4000 + seed)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1.0) - 0.5
    th = np.arctan2(yy, xx); r = np.hypot(xx, yy) * 2
    k = int(rng.integers(5, 9))
    angs = np.sort(rng.random(k) * 2 * np.pi)
    rads = rng.uniform(0.45, 0.85, k)
    # polygon radius as a function of angle (piecewise linear between vertices)
    ext_a = np.concatenate([angs - 2 * np.pi, angs, angs + 2 * np.pi])
    ext_r = np.concatenate([rads, rads, rads])
    thp = np.mod(th, 2 * np.pi)
    R = np.interp(thp, ext_a, ext_r)
    inside = smoothstep(R, R - 0.05, r)
    # facet shading: light from upper-left in UV space (image up = -rows)
    facet = 0.55 + 0.45 * np.cos(np.round(thp / (2 * np.pi / k)) * (2 * np.pi / k) - 2.3) * smoothstep(0.1, 0.7, r / np.maximum(R, 1e-3))
    shade = np.clip(facet * (0.8 + 0.2 * fbm((n, n), 6, 2, rng)), 0.1, 1)
    return np.where(inside > 0.02, 0.08 + 0.92 * shade * inside, 0.0)


def bake_misc():
    S = 512
    out = np.zeros((S, S, 4))
    for i in range(4):
        cx, cy = i % 2, i // 2
        sl = (slice(cy * 256, cy * 256 + 256), slice(cx * 256, cx * 256 + 256))
        out[sl + (0,)] = star(256, i)
        out[sl + (1,)] = scorch(256, i)
    for i in range(16):
        cx, cy = i % 4, i // 4
        sl = (slice(cy * 128, cy * 128 + 128), slice(cx * 128, cx * 128 + 128))
        out[sl + (2,)] = chunk(128, i)
    rng = np.random.default_rng(5005)
    nz = fbm((S, S), 4, 6, rng, gain=0.55)
    out[..., 3] = 0.5 + 0.5 * (nz - nz.min()) / (nz.max() - nz.min())
    img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    p = os.path.join(HERE, 'fx_misc.webp')
    img.save(p, 'WEBP', lossless=True, method=6, exact=True)
    return p


if __name__ == '__main__':
    import sys
    todo = (bake_puffs,) if '--puff' in sys.argv else (bake_puffs, bake_misc)
    for p in (f() for f in todo):
        print(p, os.path.getsize(p) // 1024, 'KB')
