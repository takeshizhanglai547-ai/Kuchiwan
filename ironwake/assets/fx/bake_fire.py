#!/usr/bin/env python3
"""IRONWAKE fireball / smoke FLIPBOOK bake (owner: weapons/VFX artist). numpy + Pillow, deterministic.

    python3 assets/fx/bake_fire.py [--quick]     -> assets/fx/fx_fire.jpg

A small volumetric renderer: every frame is a 3D density + temperature field built from periodic
spectral noise (billowing lobes, internal churn, erosion), lit by a light from above with
self-shadowing (cumulative optical depth along +Y) and integrated front-to-back along the view
axis. The flipbook plays one explosion life: ignition (small, white-hot) -> expanding turbulent
fireball (orange with soot crust) -> cooling (dark smoke, embers deep inside) -> wispy dissipation.

Layout: 8 x 8 frames (row-major from the TOP-LEFT, frame 0 = ignition), RGB, linear data:
    R  opacity (1 - transmittance)
    G  visibility-weighted temperature 0..1 (runtime: combustion ramp #FFF4D6 -> #FFB04A -> #FF6A1A)
    B  visibility-weighted light transmittance from above (runtime: sun/ambient on the smoke)
JPEG 4:4:4 (no chroma subsampling, so the three data channels stay independent).
"""
import os
import sys
import time
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
QUICK = '--quick' in sys.argv
COLS = 8
FRAMES = COLS * COLS
CELL = 96 if QUICK else 192          # px per frame (atlas = 8 * CELL)
DEPTH = 48 if QUICK else 96          # samples along the view ray
NV = 64                              # periodic noise volume resolution


def spectral_noise(n, rng, f_lo, f_hi, beta):
    """Periodic band-limited 3D noise (power ~ f^-beta between f_lo..f_hi cycles), zero mean, unit std."""
    w = rng.standard_normal((n, n, n)).astype(np.float32)
    F = np.fft.fftn(w)
    k = np.fft.fftfreq(n) * n
    kx, ky, kz = np.meshgrid(k, k, k, indexing='ij')
    kk = np.sqrt(kx * kx + ky * ky + kz * kz)
    amp = np.where((kk >= f_lo) & (kk <= f_hi), (np.maximum(kk, 1e-3)) ** (-beta / 2), 0.0)
    v = np.real(np.fft.ifftn(F * amp)).astype(np.float32)
    v -= v.mean()
    v /= v.std() + 1e-8
    return v


def sample(vol, x, y, z):
    """Trilinear, periodic sampling of vol at voxel coordinates (float arrays, any shape)."""
    n = vol.shape[0]
    x0 = np.floor(x); y0 = np.floor(y); z0 = np.floor(z)
    fx = (x - x0).astype(np.float32); fy = (y - y0).astype(np.float32); fz = (z - z0).astype(np.float32)
    x0 = x0.astype(np.int64) % n; y0 = y0.astype(np.int64) % n; z0 = z0.astype(np.int64) % n
    x1 = (x0 + 1) % n; y1 = (y0 + 1) % n; z1 = (z0 + 1) % n
    flat = vol.reshape(-1)
    def g(a, b, c):
        return flat[(a * n + b) * n + c]
    c00 = g(x0, y0, z0) * (1 - fx) + g(x1, y0, z0) * fx
    c10 = g(x0, y1, z0) * (1 - fx) + g(x1, y1, z0) * fx
    c01 = g(x0, y0, z1) * (1 - fx) + g(x1, y0, z1) * fx
    c11 = g(x0, y1, z1) * (1 - fx) + g(x1, y1, z1) * fx
    c0 = c00 * (1 - fy) + c10 * fy
    c1 = c01 * (1 - fy) + c11 * fy
    return c0 * (1 - fz) + c1 * fz


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def main():
    t0 = time.time()
    rng = np.random.default_rng(9119)
    V1 = spectral_noise(NV, rng, 1.5, 5.0, 2.0)    # big lobes
    V2 = spectral_noise(NV, rng, 3.0, 10.0, 1.6)   # billows
    V3 = spectral_noise(NV, rng, 6.0, 14.0, 1.2)   # fine erosion / wisps
    VW = [spectral_noise(NV, rng, 1.5, 4.0, 2.0) for _ in range(3)]  # domain warp

    # view grid: x right, y up, z toward the camera (front = +1)
    ax = (np.arange(CELL, dtype=np.float32) + 0.5) / CELL * 2 - 1
    az = (np.arange(DEPTH, dtype=np.float32) + 0.5) / DEPTH * 2 - 1
    Y, X, Z = np.meshgrid(-ax, ax, az[::-1], indexing='ij')  # rows top->bottom, depth front->back
    dz = 2.0 / DEPTH
    atlas = np.zeros((COLS * CELL, COLS * CELL, 3), np.float32)

    def turb(vol, d, f, off):
        """|noise| on the unit direction d (a displacement map on the sphere => clean billows)."""
        return np.abs(sample(vol, d[0] * f + off[0], d[1] * f + off[1], d[2] * f + off[2]))

    for f in range(FRAMES):
        t = f / (FRAMES - 1)
        # ---- shape evolution
        grow = 1 - (1 - min(t / 0.45, 1.0)) ** 2.4
        R = 0.2 + 0.42 * grow + 0.06 * max(0.0, t - 0.45)
        cy = -0.1 + 0.12 * t ** 1.3
        ch = 6.0 * t + 3.0 * t * t                 # churn: drift through the noise (rolling billows)
        q = np.stack([X / R, (Y - cy) / R, Z / R])
        # gentle domain warp (more as the ball rolls and breaks up)
        ws = 0.06 + 0.16 * t
        sc = NV * 0.12
        p = q + ws * np.stack([sample(VW[k], q[0] * sc + 3.1 * k, q[1] * sc - ch, q[2] * sc + 7.7 * k) for k in range(3)])
        r = np.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) + 1e-5
        d = p / r
        # pyroclastic surface: turbulence on the sphere, octaves 1.5 / 3 / 6 / 12 cycles
        tb = (0.5 * turb(V1, d, NV * 0.1, (1.0, -ch * 0.8, 2.0)) + 0.3 * turb(V2, d, NV * 0.13, (5.0, -ch * 1.3, 9.0))
              + 0.15 * turb(V2, d, NV * 0.27, (13.0, -ch * 1.8, 4.0)) + 0.09 * turb(V3, d, NV * 0.33, (21.0, -ch * 2.5, 17.0))
              + 0.05 * turb(V3, d, NV * 0.7, (3.0, -ch * 3.5, 11.0)))
        amp = 0.22 + 0.3 * min(1.0, t * 2.5)
        surf = 0.6 + amp * (tb - 0.35) + 0.1 * sample(V1, q[0] * NV * 0.06, q[1] * NV * 0.06 - ch * 0.3, q[2] * NV * 0.06)
        sd = r - surf                                   # < 0 inside
        s3 = NV * 0.3
        fine = sample(V3, p[0] * s3 + 29 + ch * 0.4, p[1] * s3 - ch * 0.9, p[2] * s3 + ch * 0.6)
        mid = sample(V2, p[0] * NV * 0.12 + 7 + ch * 0.2, p[1] * NV * 0.12 - ch * 0.5, p[2] * NV * 0.12 + ch * 0.3)
        # density: solid core with a soft skin; erosion grows with age (smoke breaks into big wisps)
        soft = 0.05 + 0.22 * t * t
        dens = smoothstep(soft, -soft - 0.04, sd)
        erode = 0.95 * smoothstep(0.32, 1.0, t)
        brk = 0.65 * mid + 0.35 * fine
        dens = np.clip(dens * (1.0 + 0.25 * fine) - erode * smoothstep(-0.9, 0.9, brk + 0.8 * sd), 0, 1)
        sigma = (30.0 - 22.0 * smoothstep(0.4, 1.0, t)) / R      # optical density per unit length
        # ---- temperature: whole skin glowing at first, hot billow faces, soot crust spreading with age
        tmax = 1.0 if t < 0.05 else float(np.exp(-((t - 0.05) / 0.34) ** 1.35))
        n_t = sample(V2, d[0] * NV * 0.16 + 41, d[1] * NV * 0.16 - ch * 1.3, d[2] * NV * 0.16 + 3)
        depth_in = np.clip(-sd / (surf + 1e-3), 0, 1)                      # 0 at the skin -> 1 at the centre
        base = 0.95 - 0.55 * smoothstep(0.04, 0.5, t)
        hot = np.clip(base + 0.9 * depth_in + (0.12 + 0.3 * min(1.0, t * 3)) * np.tanh(n_t) + 0.12 * fine - 0.25 * (tb - 0.35), 0, 1)
        crust = smoothstep(0.4, 0.0, depth_in) * smoothstep(0.06, 0.45, t) * smoothstep(0.4, -0.6, n_t - 1.2 * t)
        temp = np.clip(hot * tmax * (1.0 - 0.9 * crust), 0, 1)
        if t < 0.06:
            temp = np.maximum(temp, (1 - t / 0.06) * smoothstep(1.0, 0.2, r / surf))  # ignition: white-hot
        # ---- light from above: optical depth accumulated top -> down (axis 0 = rows from top)
        ext = sigma * dens * dz
        tau_l = np.cumsum(ext, axis=0) - ext * 0.5
        light = np.exp(-tau_l * 0.55)                                         # forward-scattering smoke
        # ---- integrate along the view (axis 2 = front -> back)
        tau_v = np.cumsum(ext, axis=2) - ext
        Tv = np.exp(-tau_v)
        wgt = Tv * (1 - np.exp(-ext))
        alpha = wgt.sum(axis=2)
        lit = (wgt * light).sum(axis=2) / np.maximum(alpha, 1e-4)
        tmp = (wgt * temp).sum(axis=2) / np.maximum(alpha, 1e-4)
        # keep undefined (empty) pixels neutral so bilinear filtering never bleeds garbage
        a = np.clip(alpha, 0, 1)
        m = smoothstep(0.0, 0.03, a)
        lit = lit * m + 1.0 * (1 - m)
        tmp = tmp * m
        # cell edge safety margin (mipmaps / bilinear never pick up the neighbour)
        e = smoothstep(1.0, 0.94, np.maximum(np.abs(X[:, :, 0]), np.abs(Y[:, :, 0])))
        a *= e
        cx, cyc = f % COLS, f // COLS
        sl = (slice(cyc * CELL, cyc * CELL + CELL), slice(cx * CELL, cx * CELL + CELL))
        atlas[sl + (0,)] = a
        atlas[sl + (1,)] = tmp
        atlas[sl + (2,)] = lit
        if f % 8 == 0:
            print(f'frame {f:2d}  t={t:.2f}  R={R:.2f}  alpha max {a.max():.2f}  temp max {tmp.max():.2f}  {time.time() - t0:.1f}s', flush=True)

    img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    out = os.path.join(HERE, 'fx_fire.jpg')
    img.save(out, 'JPEG', quality=90, subsampling=0, optimize=True)
    print(out, os.path.getsize(out) // 1024, 'KB', f'{time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
