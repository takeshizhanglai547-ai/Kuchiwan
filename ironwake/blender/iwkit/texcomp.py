"""iwkit.texcomp - numpy/PIL compositing of baked passes into final PBR maps.

Inputs are the float arrays from bake.bake_all (linear, Blender row order = bottom
first). Output: dict of uint8 RGB arrays in IMAGE order (row 0 = top):
  basecolor (sRGB), orm (linear: R=AO G=rough B=metal), normal (OpenGL, +Y up),
  emissive (sRGB).

The weathering model (all knobs in `Weathering`):
  1. paint colour (albedo pass incl. decals / hazard / variation)
  2. edge wear  - convex edges x chip noise -> paint chipped to bare steel, with a
                  darker primer rim around each chip; slight polish on worn edges
  3. flat chips - sparse scattered chips on painted faces
  4. grime/soot - cavities + low AO + fbm noise, darkens and roughens
  5. streaks    - vertical rust/soot run-off on steep faces
  6. rust       - oxidation in painted cavities
  7. ash dust   - on upward-facing surfaces (world normal)
  8. AO         - a little multiplied into albedo, full strength in ORM.R
"""
import os
from dataclasses import dataclass, field

import numpy as np
from PIL import Image


@dataclass
class Weathering:
    edge_wear: float = 1.0       # 0 = pristine edges, 1 = normal chipping, 2 = battered
    edge_lo: float = 0.10        # convexity values mapped to the 0..1 edge mask
    edge_hi: float = 0.42
    chip_threshold: float = 0.6   # lower = more / bigger chips
    flat_chips: float = 0.5      # sparse chips away from edges
    thin_suppress: float = 0.75  # keep thin parts (fins, bolts) from reading as all-edge
    edge_polish: float = 0.22    # worn-lighter paint along edges (no metal showing)
    grime: float = 1.25
    streaks: float = 1.4
    rust: float = 0.6
    dust: float = 0.45
    ao_in_albedo: float = 0.3
    ao_strength: float = 1.0
    rough_breakup: float = 0.12
    macro: float = 0.07          # large-scale value mottling of paint (+-)
    ground_dirt: float = 0.35    # darker / dirtier toward the bottom of the asset
    sun_fade: float = 0.06       # lighter, flatter paint on top surfaces
    bare_dark: tuple = (0.13, 0.13, 0.125)   # bare steel colour range (linear)
    bare_light: tuple = (0.30, 0.30, 0.29)
    soot: tuple = (0.022, 0.02, 0.018)
    rust_col: tuple = (0.085, 0.036, 0.016)
    ash: tuple = (0.20, 0.19, 0.17)
    primer_rim: float = 0.4
    extra: dict = field(default_factory=dict)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blur(a, r=1):
    """Separable box blur (radius r px, 2 passes ~ gaussian-ish)."""
    if r <= 0:
        return a
    out = a.astype(np.float32)
    for _ in range(2):
        for ax in (0, 1):
            k = 2 * r + 1
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode='edge'), axis=ax, dtype=np.float64)
            idx_hi = np.arange(k, k + out.shape[ax])
            idx_lo = np.arange(0, out.shape[ax])
            out = ((np.take(c, idx_hi, axis=ax) - np.take(c, idx_lo, axis=ax)) / k).astype(np.float32)
    return out


def lerp(a, b, t):
    if np.ndim(t) == 2 and (np.ndim(a) in (1, 3) or np.ndim(b) in (1, 3)):
        t = t[..., None]
    return a + (np.asarray(b, np.float32) - a) * t


def lin_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _uniform(n, valid):
    """Stretch a baked noise channel to ~uniform 0..1 using its 2nd/98th percentiles over
    the valid texels (noise textures cluster around 0.5; this makes thresholds meaningful)."""
    v = n[valid] if valid.any() else n.ravel()
    lo, hi = np.percentile(v, [2, 98])
    return np.clip((n - lo) / max(hi - lo, 1e-4), 0, 1)


def _hexlin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def material_channels(P, table):
    """Per-texel material constants from the 'matid' pass + the preset table (list of
    preset dicts in palette order). Returns dict of arrays."""
    idx = np.clip(np.rint(P['matid'][..., 0] * 255.0).astype(np.int32), 0, len(table) - 1)
    glow_max = max([t.get('emit_strength', 0.0) for t in table if t.get('emit')] or [1.0])

    def col(key, default):
        return np.array([t.get(key, default) for t in table], np.float32)[idx]
    emit_tab = np.zeros((len(table), 3), np.float32)
    for i, t in enumerate(table):
        if t.get('emit'):
            emit_tab[i] = _hexlin(t['emit']) * (t.get('emit_strength', 1.0) / glow_max)
    return {'metal': col('metal', 0.0), 'rough': col('rough', 0.5), 'paint': col('wear', 0.0),
            'grime': col('grime', 1.0), 'rust': col('rust', 1.0), 'dust': col('dust', 1.0),
            'emit': emit_tab[idx]}


def composite(P, W=None, table=None):
    W = W or Weathering()
    valid = P['albedo'][..., 3] > 0.5
    alb = P['albedo'][..., :3].astype(np.float32)
    if 'matid' in P and table:
        mc = material_channels(P, table)
        metal0, rough0, paint = mc['metal'], mc['rough'], np.clip(mc['paint'], 0, 1)
        grime_k, rust_k, dust_k = mc['grime'], mc['rust'], mc['dust']
        emit = mc['emit']
    else:
        metal0 = P['params'][..., 0]
        rough0 = P['params'][..., 1]
        paint = np.clip(P['params'][..., 2], 0, 1)
        grime_k = P['params2'][..., 0] * 2.0
        rust_k = P['params2'][..., 1] * 2.0
        dust_k = P['params2'][..., 2] * 2.0
        emit = P['emit'][..., :3]
    convex = blur(P['masks'][..., 0], 1)
    cavity = blur(P['masks'][..., 1], 1)
    thin = blur(P['masks'][..., 2], 1)
    ao = blur(P['ao'][..., 0], 2) if 'ao' in P else np.ones_like(convex)
    ng = _uniform(P['noise'][..., 0], valid)
    ns = _uniform(P['noise'][..., 1], valid)
    nc = _uniform(P['noise'][..., 2], valid)
    wn = P['wnormal'][..., :3] * 2.0 - 1.0
    up = wn[..., 2]

    # --- 1b. macro variation: mottling, sun fade on top, dirt toward the ground
    hz = P['wpos'][..., 2] if 'wpos' in P else np.full_like(ng, 0.5)
    alb = alb * (1.0 + (ng - 0.5) * 2.0 * W.macro * paint)[..., None]
    fade = smoothstep(0.2, 0.9, up) * W.sun_fade * paint
    alb = lerp(alb, alb * 0.85 + 0.15 * alb.mean(-1, keepdims=True) + 0.02, fade)
    gd = smoothstep(0.55, 0.0, hz) * W.ground_dirt

    # --- 2. edge wear: edge mask x grunge -> chips that break up along the edges
    thin_f = smoothstep(0.8, 0.97, thin) * W.thin_suppress
    edge = smoothstep(W.edge_lo, W.edge_hi, convex) * (1.0 - thin_f)
    grunge = np.clip(nc * 0.8 + ng * 0.2, 0, 1)
    wear_raw = edge * (0.25 + 1.05 * grunge) * W.edge_wear
    wear = smoothstep(W.chip_threshold, W.chip_threshold + 0.05, wear_raw) * paint
    # --- 3. sparse flat chips
    fc = smoothstep(0.955, 0.975, nc * 0.75 + ng * 0.25) * paint * W.flat_chips
    wear = np.clip(np.maximum(wear, fc), 0, 1)
    rim = np.clip(smoothstep(W.chip_threshold - 0.14, W.chip_threshold, wear_raw) * paint - wear, 0, 1)
    bare = lerp(np.asarray(W.bare_dark, np.float32), np.asarray(W.bare_light, np.float32),
                np.clip(ng * 0.5 + nc * 0.5, 0, 1))
    polish = edge * W.edge_polish * paint * (1 - wear)
    base = alb * (1.0 + polish)[..., None]
    base = base * (1.0 - W.primer_rim * rim)[..., None]
    base = lerp(base, bare, wear)
    metal = lerp(metal0, 0.95, wear)
    rough = lerp(rough0, 0.3 + 0.15 * ng, wear)
    rough = rough - polish * 0.25
    rough = rough + (ng - 0.5) * W.rough_breakup + (nc - 0.5) * W.rough_breakup * 0.4

    # --- 4. grime / soot (cavities, occlusion, fbm)
    g = cavity * 1.2 + (1.0 - ao) * 0.7 + (ng - 0.5) * 0.45 + gd * (0.6 + 0.8 * ng)
    g = np.clip(smoothstep(0.18, 0.95, g) * grime_k * W.grime, 0, 1)
    base = lerp(base, np.asarray(W.soot, np.float32), g * 0.72)
    rough = lerp(rough, 0.86, g * 0.5)
    metal = metal * (1.0 - 0.5 * g)

    # --- 5. streaks (vertical run-off on steep faces)
    side = np.clip(1.0 - np.abs(up), 0, 1) ** 0.5
    st = smoothstep(0.62, 0.9, ns) * side * np.clip(rust_k, 0, 2) * W.streaks
    st = np.clip(st * (0.5 + 0.5 * ng), 0, 1)
    streak_col = base * 0.5 + np.asarray(W.rust_col, np.float32) * 0.5
    base = lerp(base, streak_col, st * 0.55)
    rough = rough + st * 0.06

    # --- 6. rust in painted cavities
    rp = smoothstep(0.72, 0.92, cavity * 0.75 + ng * 0.35 + nc * 0.2) * paint * rust_k * W.rust
    rp = np.clip(rp, 0, 1)
    base = lerp(base, np.asarray(W.rust_col, np.float32) * (0.75 + 0.5 * nc)[..., None], rp * 0.8)
    rough = lerp(rough, 0.88, rp)
    metal = lerp(metal, 0.1, rp)

    # --- 7. ash dust on upward faces
    dust = smoothstep(0.35, 0.95, up) * smoothstep(0.4, 0.8, ng * 0.7 + nc * 0.3) * dust_k * W.dust
    dust = np.clip(dust, 0, 1)
    base = lerp(base, np.asarray(W.ash, np.float32), dust * 0.5)
    rough = lerp(rough, 0.92, dust * 0.6)
    metal = metal * (1.0 - dust * 0.6)

    # --- 8. AO
    base = base * lerp(np.ones_like(ao), ao, W.ao_in_albedo)[..., None]
    ao_out = lerp(np.ones_like(ao), ao, W.ao_strength)

    out = {
        'basecolor': lin_to_srgb(base),
        'orm': np.stack([ao_out, np.clip(rough, 0.04, 1.0), np.clip(metal, 0, 1)], -1),
        'normal': np.clip(P['normal'][..., :3], 0, 1),
        'emissive': lin_to_srgb(emit),
    }
    masks = {'wear': wear, 'grime': g, 'streak': st, 'rust': rp, 'dust': dust, 'edge': edge}
    res = {}
    for k, v in out.items():
        res[k] = (np.clip(v[::-1], 0, 1) * 255.0 + 0.5).astype(np.uint8)  # flip to image order
    res['_masks'] = {k: (np.clip(v[::-1], 0, 1) * 255 + 0.5).astype(np.uint8) for k, v in masks.items()}
    return res


def save_maps(maps, out_dir, prefix, sizes=None, jpeg_quality=None):
    """Write PNG maps: <prefix>_basecolor.png ... sizes: {'orm': 1024} downsizes a map.
    Returns {name: path}."""
    os.makedirs(out_dir, exist_ok=True)
    sizes = sizes or {}
    paths = {}
    for k in ('basecolor', 'orm', 'normal', 'emissive'):
        im = Image.fromarray(maps[k], 'RGB')
        s = sizes.get(k)
        if s and s != im.width:
            im = im.resize((s, s), Image.LANCZOS)
        if jpeg_quality:
            p = os.path.join(out_dir, f'{prefix}_{k}.jpg')
            im.save(p, quality=jpeg_quality, subsampling=0 if k == 'normal' else 2, optimize=True)
        else:
            p = os.path.join(out_dir, f'{prefix}_{k}.png')
            im.save(p, optimize=False, compress_level=4)
        paths[k] = p
    return paths


def contact_sheet(maps, path, tile=512):
    """Inspection sheet: left 2x2 = basecolor, orm, normal, emissive; right 2x2 = the
    wear / grime / streak / dust masks."""
    sheet = Image.new('RGB', (tile * 4, tile * 2), (20, 20, 20))
    for i, k in enumerate(['basecolor', 'orm', 'normal', 'emissive']):
        sheet.paste(Image.fromarray(maps[k]).resize((tile, tile), Image.LANCZOS), ((i % 2) * tile, (i // 2) * tile))
    for i, k in enumerate(['wear', 'grime', 'streak', 'dust']):
        m = maps['_masks'].get(k)
        if m is not None:
            im = Image.fromarray(m).convert('RGB').resize((tile, tile), Image.LANCZOS)
            sheet.paste(im, (2 * tile + (i % 2) * tile, (i // 2) * tile))
    sheet.save(path)
    return path
