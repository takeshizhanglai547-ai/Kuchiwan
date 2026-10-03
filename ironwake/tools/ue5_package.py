#!/usr/bin/env python3
"""tools/ue5_package.py - build the committed Unreal hand-off folder ue5/assets/ from the
Blender exports in assets/ue5/ (gitignored).

    python3 tools/ue5_package.py [--check]        (~1 min; python3 + numpy + Pillow, no bpy)

Sources (all produced by the Blender build scripts; nothing here re-bakes anything):
    assets/ue5/SM_mech_player.fbx + T_mech_player_*     blender/mech/build_player.py   (full build)
    assets/ue5/SM_mech_boss.fbx   + T_mech_boss_*       blender/mech/build_boss.py
    assets/ue5/SM_enemy_{mt,drone,relay}.fbx + T_*      blender/enemies/build_{mt,drone,relay}.py
    assets/ue5/arena/*                                  tools/ue5_export_arena.py
    assets/arena/tex/*.webp                             the arena's tiling texture sets

Output ue5/assets/{Player,Rival,Enemies,Arena}/ + ue5/assets/MANIFEST.json, kept under 40 MB:
  * FBX: tangent + binormal layers removed (55 % of each file; Unreal recomputes MikkTSpace
    tangents on import, the same basis Blender baked the normal maps with), texture references
    reduced to bare file names next to the FBX (the exporter wrote absolute container paths).
    The binary FBX writer below re-encodes the node tree exactly like Blender's exporter: an
    unmodified file round-trips byte-identically (checked on every run).
  * Base colour (T_*_BC): JPEG (q 85, 4:4:4, PSNR >= 38 dB) unless it has alpha (decals stay PNG).
    Normal (T_*_N, already DirectX / green-down), ORM (R AO, G roughness, B metal) and emissive
    (T_*_E): lossless PNG.
  * Arena tiling sets (only with --arena-textures): T_Arena_<Set>_BC (JPEG), T_Arena_<Set>_N (PNG,
    flipped to DirectX), T_Arena_<Set>_ORM (PNG) or a documented _M mask where the web build packs
    other data.
--check            only verify the FBX round-trip and print the plan (writes nothing).
--arena-textures   also write ue5/assets/Arena/Textures/T_Arena_* (~11 MB; NOT committed: the 40 MB cap).
"""
import io
import json
import os
import shutil
import struct
import sys
import time
import zlib

import numpy as np
from PIL import Image
try:
    import oxipng
except ImportError:
    oxipng = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC = os.path.join(ROOT, 'assets', 'ue5')
OUT = os.path.join(ROOT, 'ue5', 'assets')
LIMIT = 40e6
JPEG_Q = 85      # 4:4:4; PSNR >= 38.4 dB (mean 40) vs the lossless bakes; needed for the 40 MB cap

GROUPS = {   # source asset name -> (output folder, display name)
    'mech_player': ('Player', 'RIG-07 IRONWAKE (player rig)'),
    'mech_boss': ('Rival', 'GC-X1 CINDERHOUND (rival rig / boss)'),
    'enemy_mt': ('Enemies', 'PK-2 PICKET (sentry walker)'),
    'enemy_drone': ('Enemies', 'GNAT (drone)'),
    'enemy_relay': ('Enemies', 'Relay generator (stage 2 objective)'),
}


# ============================================================================ binary FBX
class Elem:
    __slots__ = ('id', 'props', 'kids', 'nested')

    def __init__(self, id_, props, kids, nested):
        self.id, self.props, self.kids, self.nested = id_, props, kids, nested

    def kid(self, name):
        for k in self.kids:
            if k.id == name:
                return k
        return None

    def string(self, i=0):
        t, raw = self.props[i]
        return raw[4:] if t in b'SR' else None


_SCALAR = {ord('Y'): 2, ord('C'): 1, ord('I'): 4, ord('F'): 4, ord('D'): 8, ord('L'): 8}


def fbx_read(path):
    b = open(path, 'rb').read()
    if not b.startswith(b'Kaydara FBX Binary  \x00'):
        raise ValueError(f'{path}: not a binary FBX')
    ver = struct.unpack_from('<I', b, 23)[0]
    wide = ver >= 7500
    meta, fmt = (24, '<3Q') if wide else (12, '<3I')
    null = meta + 1

    def node(off):
        end, nprop, plen = struct.unpack_from(fmt, b, off)
        if end == 0:
            return None, off + null
        nl = b[off + meta]
        name = b[off + meta + 1: off + meta + 1 + nl]
        q = off + meta + 1 + nl
        props = []
        for _ in range(nprop):
            t = b[q]
            q0 = q + 1
            if t in b'fdlib':
                cl = struct.unpack_from('<III', b, q0)[2]
                q = q0 + 12 + cl
            elif t in b'SR':
                q = q0 + 4 + struct.unpack_from('<I', b, q0)[0]
            else:
                q = q0 + _SCALAR[t]
            props.append((bytes([t]), b[q0:q]))
        kids, nested = [], q < end
        while q < end - null:
            k, q = node(q)
            if k is None:
                break
            kids.append(k)
        return Elem(name, props, kids, nested), end

    top, off = [], 27
    while True:
        e, off = node(off)
        if e is None:
            break
        top.append(e)
    return ver, top


def fbx_write(path, ver, top):
    wide = ver >= 7500
    meta, fmt = (24, '<3Q') if wide else (12, '<3I')
    null = b'\0' * (meta + 1)
    out = io.BytesIO()
    out.write(b'Kaydara FBX Binary  \x00\x1a\x00' + struct.pack('<I', ver))

    def size(e):
        n = meta + 1 + len(e.id) + sum(1 + len(r) for _, r in e.props)
        if e.kids or e.nested:
            n += sum(size(k) for k in e.kids) + len(null)
        return n

    def write(e):
        start = out.tell()
        end = start + size(e)
        out.write(struct.pack(fmt, end, len(e.props), sum(1 + len(r) for _, r in e.props)))
        out.write(bytes([len(e.id)]) + e.id)
        for t, r in e.props:
            out.write(t + r)
        if e.kids or e.nested:
            for k in e.kids:
                write(k)
            out.write(null)
        assert out.tell() == end, 'FBX offset mismatch'

    for e in top:
        write(e)
    out.write(null)
    # footer, exactly as blender/io_scene_fbx/encode_bin.py writes it
    out.write(b'\xfa\xbc\xab\x09\xd0\xc8\xd4\x66\xb1\x76\xfb\x83\x1c\xf7\x26\x7e' + b'\0' * 4)
    ofs = out.tell()
    pad = ((ofs + 15) & ~15) - ofs
    out.write(b'\0' * (pad or 16))
    out.write(struct.pack('<I', ver) + b'\0' * 120)
    out.write(b'\xf8\x5a\x8c\x6a\xde\xf5\xd9\x7e\xec\xe9\x0c\xe3\x75\x8f\x29\x0b')
    data = out.getvalue()
    if path:
        with open(path, 'wb') as f:
            f.write(data)
    return data


def sprop(s):
    return (b'S', struct.pack('<I', len(s)) + s)


DROP_LAYERS = (b'LayerElementTangent', b'LayerElementBinormal')


def fbx_strip_and_relink(top, relink):
    """Drop tangent/binormal layers; relink(path_bytes) -> new bare file name or None (keep)."""
    objects = next((e for e in top if e.id == b'Objects'), None)
    stats = {'layers': 0, 'paths': 0}
    for e in objects.kids if objects else []:
        if e.id == b'Geometry':
            n0 = len(e.kids)
            e.kids = [k for k in e.kids if k.id not in DROP_LAYERS]
            stats['layers'] += n0 - len(e.kids)
            for lay in (k for k in e.kids if k.id == b'Layer'):
                lay.kids = [le for le in lay.kids if not (le.id == b'LayerElement' and le.kid(b'Type') is not None
                                                         and le.kid(b'Type').string() in DROP_LAYERS)]
        elif e.id in (b'Video', b'Texture'):
            for k in e.kids:
                if k.id in (b'FileName', b'Filename', b'RelativeFilename') and k.props and k.props[0][0] == b'S':
                    new = relink(k.string())
                    if new is not None:
                        k.props[0] = sprop(new)
                        stats['paths'] += 1
                elif k.id == b'Properties70':
                    for p in k.kids:
                        if p.props and p.string(0) == b'Path' and p.props[-1][0] == b'S':
                            new = relink(p.string(len(p.props) - 1))
                            if new is not None:
                                p.props[-1] = sprop(new)
                                stats['paths'] += 1
    return stats


def fbx_recompress(top, level=9):
    """Re-deflate every zlib-compressed array (Blender writes them at level 1). Lossless."""
    saved = 0
    stack = list(top)
    while stack:
        e = stack.pop()
        stack.extend(e.kids)
        for i, (t, raw) in enumerate(e.props):
            if t in (b'f', b'd', b'l', b'i', b'b'):
                n, enc, cl = struct.unpack_from('<III', raw, 0)
                if enc == 1:
                    data = zlib.compress(zlib.decompress(raw[12:12 + cl]), level)
                    if len(data) < cl:
                        e.props[i] = (t, struct.pack('<III', n, 1, len(data)) + data)
                        saved += cl - len(data)
    return saved


def fbx_models(top):
    objects = next((e for e in top if e.id == b'Objects'), None)
    out = []
    for e in objects.kids if objects else []:
        if e.id == b'Model' and len(e.props) >= 3:
            out.append((e.string(1).split(b'\x00\x01')[0].decode(), e.string(2).decode()))
    return out


# ============================================================================ textures
def save_jpeg(src, dst):
    im = Image.open(src).convert('RGB')
    im.save(dst, 'JPEG', quality=JPEG_Q, subsampling=0, optimize=True)
    a = np.asarray(im, dtype=np.float32)
    b = np.asarray(Image.open(dst).convert('RGB'), dtype=np.float32)
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def save_png(src_or_img, dst, flip_green=False, mode='RGB'):
    im = src_or_img if isinstance(src_or_img, Image.Image) else Image.open(src_or_img)
    im = im.convert(mode)
    if flip_green:
        a = np.array(im)
        a[..., 1] = 255 - a[..., 1]
        im = Image.fromarray(a)
    im.save(dst, 'PNG', optimize=True, compress_level=9)
    if oxipng is not None:          # lossless re-encode, ~5 % smaller (pip install pyoxipng)
        oxipng.optimize(dst, level=3)


# ============================================================================ packaging
def package_rig(name, check, manifest, warnings):
    folder, title = GROUPS[name]
    fbx_src = os.path.join(SRC, f'SM_{name}.fbx')
    if not os.path.exists(fbx_src):
        warnings.append(f'{fbx_src} missing: run the full (non --quick) Blender build of {name}')
        return
    dst_dir = os.path.join(OUT, folder)
    ver, top = fbx_read(fbx_src)
    raw = open(fbx_src, 'rb').read()
    if fbx_write(None, ver, top) != raw:
        raise SystemExit(f'[ue5] FBX round-trip is NOT byte-identical for {fbx_src}; refusing to rewrite it')
    textures = sorted(f for f in os.listdir(SRC) if f.startswith(f'T_{name}_') and f.endswith('.png'))
    plan = {}       # source texture file name -> output file name
    for t in textures:
        has_alpha = Image.open(os.path.join(SRC, t)).mode in ('RGBA', 'LA')
        plan[t] = t[:-4] + '.jpg' if t.endswith('_BC.png') and not has_alpha else t
    extra = {}      # absolute decal atlases referenced from the Blender work dir -> T_<name>_Decal_BC.png
    if check:
        print(f'[ue5] {name}: FBX round-trip OK ({len(raw) / 1e6:.2f} MB), {len(textures)} textures')
        return

    def relink(p):
        raw_path = p.decode('utf-8', 'replace')
        base = os.path.basename(raw_path)
        if base in plan:
            return plan[base].encode()
        if base.endswith('_decals.png'):
            # the decal atlas lives in the Blender work dir (absolute FileName, relative RelativeFilename)
            src = raw_path if os.path.isabs(raw_path) else os.path.normpath(os.path.join(SRC, raw_path))
            if os.path.exists(src) or base in decal_seen:
                if os.path.exists(src):
                    extra[base] = src
                decal_seen.add(base)
                return f'T_{name}_Decal_BC.png'.encode()
            if f'{name}:{base}' not in warned:
                warned.add(f'{name}:{base}')
                warnings.append(f'{name}: decal atlas {src} not found (the decal mesh imports untextured)')
        return base.encode()

    decal_seen, warned = set(), set()
    st = fbx_strip_and_relink(top, relink)
    fbx_recompress(top)
    os.makedirs(dst_dir, exist_ok=True)
    fbx_dst = os.path.join(dst_dir, f'SM_{name}.fbx')
    fbx_write(fbx_dst, ver, top)
    files = [{'file': f'{folder}/SM_{name}.fbx', 'bytes': os.path.getsize(fbx_dst),
              'note': f'{len(fbx_models(top))} nodes; tangent/binormal layers removed ({st["layers"]}), {st["paths"]} texture paths relinked'}]
    for src_name, out_name in plan.items():
        src, dst = os.path.join(SRC, src_name), os.path.join(dst_dir, out_name)
        if out_name.endswith('.jpg'):
            psnr = save_jpeg(src, dst)
            note = f'JPEG q{JPEG_Q} 4:4:4, PSNR {psnr:.1f} dB vs the lossless bake'
        else:
            save_png(src, dst, mode=Image.open(src).mode if Image.open(src).mode in ('RGB', 'RGBA') else 'RGB')
            note = 'PNG (lossless)'
        files.append({'file': f'{folder}/{out_name}', 'bytes': os.path.getsize(dst), 'note': note})
    for base, src in extra.items():
        out_name = f'T_{name}_Decal_BC.png'
        dst = os.path.join(dst_dir, out_name)
        save_png(src, dst, mode='RGBA')
        files.append({'file': f'{folder}/{out_name}', 'bytes': os.path.getsize(dst), 'note': 'decal atlas (RGBA PNG)'})
    manifest['assets'].append({'name': name, 'title': title, 'folder': folder, 'fbx': f'SM_{name}.fbx',
                               'nodes': [m for m, _ in fbx_models(top)], 'files': files})


# arena data-map packing (blender/arena/textures.py); 'orm' = (AO, rough, metal) in that order
ARENA_SETS = {
    'concrete': ('Concrete', 'aoh'), 'slab': ('Slab', 'aoh'), 'ash': ('Ash', 'aoh'),
    'steel': ('Steel', 'mask'), 'corr': ('Corrugated', 'mask'), 'trim': ('Trim', 'orm'),
}
ARENA_SINGLES = {
    'detail': ('T_Arena_Detail_M', 'R albedo detail, G/B detail normal X/Y (1 m tile, near-camera overlay)'),
    'noise': ('T_Arena_Noise_M', 'R blotch fBm, G mid fBm, B vertical streaks (world-space macro breakup)'),
    'decal': ('T_Arena_Decal_M', 'greyscale decal coverage atlas (stencils, arrows, stains); colour comes from vertex colour'),
    'splat': ('T_Arena_GroundSplat_M', '512 m x 512 m yard splat: R rust/oxide, G wet, B soot (centred on the origin)'),
    'water': ('T_Arena_Water_N', 'sea normal / foam data (web build water.js)'),
}


def package_arena(check, manifest, warnings):
    src_dir = os.path.join(SRC, 'arena')
    tex_dir = os.path.join(ROOT, 'assets', 'arena', 'tex')
    need = ['SM_Arena_Kit.fbx', 'SM_Arena_Unique.fbx', 'arena_layout.json']
    if not all(os.path.exists(os.path.join(src_dir, f)) for f in need):
        warnings.append('assets/ue5/arena/* missing: run python3 tools/ue5_export_arena.py')
        return
    if check:
        for f in need[:2]:
            ver, top = fbx_read(os.path.join(src_dir, f))
            assert fbx_write(None, ver, top) == open(os.path.join(src_dir, f), 'rb').read()
        print('[ue5] arena: FBX round-trip OK')
        return
    dst_dir = os.path.join(OUT, 'Arena')
    os.makedirs(dst_dir, exist_ok=True)
    files = []
    for f in need:
        if f.endswith('.fbx'):
            ver, top = fbx_read(os.path.join(src_dir, f))
            fbx_recompress(top)
            fbx_write(os.path.join(dst_dir, f), ver, top)
        else:
            shutil.copyfile(os.path.join(src_dir, f), os.path.join(dst_dir, f))
        files.append({'file': f'Arena/{f}', 'bytes': os.path.getsize(os.path.join(dst_dir, f)),
                      'note': 'kit pieces at their own origin' if 'Kit' in f else
                      'one-off structures at world position' if 'Unique' in f else 'instances, markers, colliders (UE units)'})
    tex_notes = {}
    layout = json.load(open(os.path.join(src_dir, 'arena_layout.json')))
    entry = {'name': 'arena', 'title': 'Halvard Deep Foundry, Pier 7 (arena)', 'folder': 'Arena',
             'pieces': len(layout['pieces']), 'uniques': len(layout['uniques']),
             'instances': len(layout['instances']), 'texture_notes': tex_notes, 'files': files}
    manifest['assets'].append(entry)
    if not ARENA_TEXTURES:
        entry['textures'] = ('not included (40 MB cap): run  python3 tools/ue5_package.py --arena-textures  to write '
                             'ue5/assets/Arena/Textures/T_Arena_* from assets/arena/tex/*.webp')
        return
    dst_dir = os.path.join(dst_dir, 'Textures')
    os.makedirs(dst_dir, exist_ok=True)
    for key, (title, packing) in ARENA_SETS.items():
        a, n, d = (os.path.join(tex_dir, f'{key}_{m}.webp') for m in 'and')
        if not all(os.path.exists(p) for p in (a, n, d)):
            warnings.append(f'arena texture set {key} incomplete')
            continue
        out = {}
        dst = os.path.join(dst_dir, f'T_Arena_{title}_BC.jpg')
        Image.open(a).convert('RGB').save(dst, 'JPEG', quality=95, subsampling=0, optimize=True)
        out['BC'] = dst
        dst = os.path.join(dst_dir, f'T_Arena_{title}_N.png')
        save_png(n, dst, flip_green=True)
        out['N'] = dst
        darr = np.asarray(Image.open(d).convert('RGB'))
        if packing == 'orm':
            dst = os.path.join(dst_dir, f'T_Arena_{title}_ORM.png')
            save_png(Image.fromarray(darr), dst)
            tex_notes[title] = 'ORM = R AO, G roughness, B metal'
        elif packing == 'aoh':
            orm = darr.copy()
            orm[..., 2] = 0       # web build: B = height -> separate map; concrete is not metal
            dst = os.path.join(dst_dir, f'T_Arena_{title}_ORM.png')
            save_png(Image.fromarray(orm), dst)
            out['ORM'] = dst
            dst = os.path.join(dst_dir, f'T_Arena_{title}_H.png')
            save_png(Image.fromarray(darr[..., 2]), dst, mode='L')
            tex_notes[title] = 'ORM = R AO, G roughness, B metal (0); _H = height'
        else:
            dst = os.path.join(dst_dir, f'T_Arena_{title}_M.png')
            save_png(Image.fromarray(darr), dst)
            tex_notes[title] = ('_BC = bare rust / underlayer albedo (the paint colour comes from the vertex colour); '
                                '_M = R paint coverage 0..1 (threshold it with the vertex alpha "wear"), '
                                'G underlayer roughness, B paint grime multiplier')
        out[packing] = dst
    for key, (stem, note) in ARENA_SINGLES.items():
        src = os.path.join(tex_dir, f'{key}.webp')
        if not os.path.exists(src):
            continue
        dst = os.path.join(dst_dir, stem + '.png')
        save_png(src, dst, flip_green=False)
        tex_notes[stem] = note
    for f in sorted(os.listdir(dst_dir)):
        if f.startswith('T_Arena_'):
            files.append({'file': f'Arena/Textures/{f}', 'bytes': os.path.getsize(os.path.join(dst_dir, f))})


ARENA_TEXTURES = '--arena-textures' in sys.argv


def main():
    check = '--check' in sys.argv
    t0 = time.time()
    warnings = []
    manifest = {
        'about': 'IRONWAKE -> Unreal Engine 5 hand-off assets. UNVERIFIED IN UNREAL: built in a Linux container '
                 'without Unreal Engine. Generated by tools/ue5_package.py from the Blender exports.',
        'units': 'FBX in centimetres (exported from metres with FBX_SCALE_UNITS); -Z forward / Y up in the file, '
                 'Unreal converts to Z up on import.',
        'normals': 'T_*_N are DirectX (green down) tangent-space normal maps. Import FBX normals, let Unreal compute '
                   'MikkTSpace tangents.',
        'assets': [],
    }
    if not check and os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for name in GROUPS:
        package_rig(name, check, manifest, warnings)
    package_arena(check, manifest, warnings)
    for w in warnings:
        print('[ue5] WARNING:', w)
    if check:
        return
    total = sum(f['bytes'] for a in manifest['assets'] for f in a['files'])
    manifest['total_bytes'] = total
    with open(os.path.join(OUT, 'MANIFEST.json'), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    for a in manifest['assets']:
        print(f'[ue5] {a["folder"]:8s} {a["name"]:12s} {sum(f["bytes"] for f in a["files"]) / 1e6:6.2f} MB  ({len(a["files"])} files)')
    print(f'[ue5] ue5/assets total {total / 1e6:.2f} MB (limit {LIMIT / 1e6:.0f} MB)  {time.time() - t0:.1f} s')
    if total > LIMIT and not ARENA_TEXTURES:
        print('[ue5] ERROR: over the size limit')
        sys.exit(1)
    if ARENA_TEXTURES:
        print('[ue5] note: --arena-textures output is for local use; the committed package excludes Arena/Textures')
    print('UE5 PACKAGE PASSED' if not warnings else 'UE5 PACKAGE PASSED (with warnings)')


if __name__ == '__main__':
    main()
