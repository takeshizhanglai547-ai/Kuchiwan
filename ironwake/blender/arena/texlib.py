"""blender/arena/texlib.py - periodic (tileable) procedural texture toolkit (numpy + PIL).

Everything here is seamless by construction: spectral noise is synthesised with integer
FFT frequencies, Voronoi uses wrapped jittered grids, blurs and gradients wrap around.
No bpy dependency (runs in plain python3). Deterministic per seed.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, '..', 'iwkit', 'fonts')
FONTS = {
    'stencil': os.path.join(FONT_DIR, 'BigShoulders-Bold.ttf'),
    'mono': os.path.join(FONT_DIR, 'JetBrainsMono-Bold.ttf'),
    'jp': '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
}


def font(kind, size):
    p = FONTS.get(kind)
    if p and os.path.exists(p):
        return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def R(seed):
    return np.random.default_rng(seed)


# ----------------------------------------------------------------------------- noise
def spectral(n, seed, beta=2.0, fmin=1.0, fmax=None, aniso=(1.0, 1.0), m=None):
    """Periodic fractal noise (n x m), power spectrum ~ f^-beta between fmin..fmax
    (in cycles per tile). aniso=(ax, ay): ay > 1 stretches features along Y (streaks).
    Returns zero-mean, unit-std float32."""
    m = m or n
    w = R(seed).standard_normal((n, m))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(m)[None, :] * m
    f = np.sqrt((fx * aniso[0]) ** 2 + (fy * aniso[1]) ** 2)
    amp = np.where(f > 0, np.maximum(f, 1e-6), 1.0) ** (-beta / 2.0)
    amp[f < fmin] = 0.0
    if fmax is not None:
        amp *= np.clip((fmax * 1.25 - f) / (fmax * 0.25), 0, 1)
    out = np.real(np.fft.ifft2(F * amp)).astype(np.float32)
    out -= out.mean()
    s = out.std()
    return out / (s if s > 0 else 1.0)


def blur(a, sigma):
    """Periodic gaussian blur (FFT). sigma in pixels."""
    if sigma <= 0:
        return a
    n, m = a.shape[:2]
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(m)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)
    return np.stack([blur(a[..., c], sigma) for c in range(a.shape[2])], -1)


def norm01(a):
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo if hi > lo else 1.0)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid(n, m=None):
    m = m or n
    y, x = np.mgrid[0:n, 0:m].astype(np.float32)
    return x, y


def voronoi(n, cells, seed, jitter=0.9, warp=None, m=None, cells_y=None):
    """Periodic Voronoi on an n x m image with cells x cells_y jittered sites.
    Returns (F1, F2, id) with distances in pixels. warp=(dx, dy) pixel offsets."""
    m = m or n
    cy = cells_y or cells
    rg = R(seed)
    jx = rg.random((cy, cells)) * jitter + (1 - jitter) / 2
    jy = rg.random((cy, cells)) * jitter + (1 - jitter) / 2
    x, y = grid(n, m)
    if warp is not None:
        x = x + warp[0]
        y = y + warp[1]
    sx, sy = m / cells, n / cy
    ci = np.floor(x / sx).astype(np.int64)
    cj = np.floor(y / sy).astype(np.int64)
    F1 = np.full((n, m), 1e9, np.float32)
    F2 = np.full((n, m), 1e9, np.float32)
    ID = np.zeros((n, m), np.int64)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ii, jj = ci + di, cj + dj
            wi, wj = ii % cells, jj % cy
            px = (ii + jx[wj, wi]) * sx
            py = (jj + jy[wj, wi]) * sy
            d = np.sqrt((x - px) ** 2 + (y - py) ** 2).astype(np.float32)
            idn = wj * cells + wi
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, idn, ID)
            F1 = np.where(closer, d, F1)
    return F1, F2, ID


def height_to_normal(h, strength, px_per_unit=1.0):
    """Tangent-space normal (OpenGL, +Y up in image = up in world) from a periodic
    height field (image rows grow downward, so dy is negated)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L, ny / L, nz / L], -1)


def enc_normal(nrm):
    return np.clip(nrm * 0.5 + 0.5, 0, 1)


def srgb(hexstr):
    hexstr = hexstr.lstrip('#')
    return np.array([int(hexstr[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def lerp(a, b, t):
    t = t[..., None] if (np.ndim(t) == 2 and np.ndim(a) == 3 or np.ndim(b) == 3) else t
    return a + (b - a) * t


def save(img01, path, quality=85, size=None, fmt=None):
    a = np.clip(img01, 0, 1)
    if a.ndim == 2:
        im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'L')
    else:
        im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')
    if size and im.size[0] != size:
        im = im.resize((size, size * im.size[1] // im.size[0]), Image.LANCZOS)
    fmt = fmt or ('WEBP' if path.endswith('.webp') else 'JPEG')
    kw = {'quality': quality}
    if fmt == 'WEBP':
        kw['method'] = 6
    else:
        kw['optimize'] = True
        kw['subsampling'] = 0 if quality >= 90 else 2
    im.save(path, fmt, **kw)
    return os.path.getsize(path)


# ----------------------------------------------------------------------------- stamps
def disc_field(n, centers, radius, m=None):
    """Min distance (px) to a set of centers (wrapped), limited to radius*3 around each."""
    m = m or n
    out = np.full((n, m), 1e9, np.float32)
    r3 = int(math.ceil(radius * 3)) + 1
    ys, xs = np.mgrid[-r3:r3 + 1, -r3:r3 + 1].astype(np.float32)
    for (cx, cy) in centers:
        ix, iy = int(round(cx)), int(round(cy))
        d = np.sqrt((xs + ix - cx) ** 2 + (ys + iy - cy) ** 2)
        rows = (np.arange(iy - r3, iy + r3 + 1)) % n
        cols = (np.arange(ix - r3, ix + r3 + 1)) % m
        sub = out[np.ix_(rows, cols)]
        out[np.ix_(rows, cols)] = np.minimum(sub, d)
    return out


def line_dist_periodic(coord, period):
    """Distance (px) from coord to the nearest multiple of period."""
    r = np.mod(coord, period)
    return np.minimum(r, period - r)
