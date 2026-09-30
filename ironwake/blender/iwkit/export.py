"""iwkit.export - GLB (three.js runtime) and FBX (Unreal Engine) export.

GLB: glTF 2.0 binary, +Y up, node names preserved (pivot empties = engine contract),
custom properties -> `extras`, tangents exported (normal maps were baked with the same
MikkTSpace basis), JPEG/WebP images embedded. Optional post-pass with gltfpack
(blender/tools/node_modules/.bin/gltfpack) -> EXT_meshopt_compression + quantization,
which three.js decodes with MeshoptDecoder (see src/core/assets.js). -kn keeps named
nodes, -km named materials, -ke extras.

FBX (UE5): metres in Blender -> FBX_SCALE_UNITS (UE imports centimetres correctly),
-Z forward / Y up (UE's importer converts), smoothing groups + custom normals + tangents,
textures embedded, plus T_<asset>_{BC,ORM,N,E}.png written next to it (N converted to
DirectX green-down, as UE expects).
"""
import json
import os
import shutil
import struct
import subprocess

import bpy
import numpy as np
from PIL import Image

from .core import IRONWAKE_ROOT, UE5_DIR, descendants, log, quiet, select_only, timed

GLTFPACK = os.path.join(IRONWAKE_ROOT, 'blender', 'tools', 'node_modules', 'gltfpack', 'cli.js')
NODE_CANDIDATES = ['/opt/node22/bin/node', shutil.which('node') or '']


def _node():
    for n in NODE_CANDIDATES:
        if n and os.path.exists(n):
            return n
    return None


def gltfpack_available():
    return os.path.exists(GLTFPACK) and _node() is not None


def export_glb(root, path, image_format='JPEG', quality=90, compress=True, extra_args=()):
    """Export `root` and all its descendants to GLB. Returns final file size (bytes)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = descendants(root)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    select_only(objs, root)
    raw = path if not compress else path[:-4] + '.raw.glb'
    with timed('export.glb'):
        with quiet():
            bpy.ops.export_scene.gltf(
                filepath=raw, export_format='GLB', use_selection=True, export_extras=True,
                export_yup=True, export_apply=True, export_tangents=True, export_normals=True,
                export_texcoords=True, export_materials='EXPORT', export_image_format=image_format,
                export_jpeg_quality=quality, export_image_quality=quality, export_cameras=False,
                export_lights=False, export_animations=False, export_skins=False, export_morph=False,
                export_vertex_color='NONE', export_attributes=False, check_existing=False)
    size = os.path.getsize(raw)
    if compress:
        if gltfpack_available():
            args = [_node(), GLTFPACK, '-i', raw, '-o', path, '-cc', '-ce', 'ext', '-kn', '-km', '-ke',
                    '-vn', '10', '-vt', '14', *extra_args]
            with timed('export.gltfpack'):
                r = subprocess.run(args, capture_output=True, text=True)
            if r.returncode != 0 or not os.path.exists(path):
                log('gltfpack failed, keeping uncompressed GLB:', r.stderr.strip()[:400])
                shutil.move(raw, path)
            else:
                os.remove(raw)
        else:
            log('gltfpack not installed (npm install in blender/tools); GLB left uncompressed')
            shutil.move(raw, path)
    size = os.path.getsize(path)
    log(f'GLB -> {path} ({size / 1024:.0f} KiB)')
    return size


def glb_json(path):
    """Parse the JSON chunk of a GLB (for validation / inspection)."""
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'
    clen, ctype = struct.unpack_from('<II', data, 12)
    return json.loads(data[20:20 + clen].decode('utf-8'))


def glb_report(path):
    j = glb_json(path)
    rep = {
        'bytes': os.path.getsize(path),
        'nodes': [n.get('name') for n in j.get('nodes', [])],
        'meshes': len(j.get('meshes', [])),
        'materials': [m.get('name') for m in j.get('materials', [])],
        'images': [(im.get('name'), im.get('mimeType')) for im in j.get('images', [])],
        'extensionsUsed': j.get('extensionsUsed', []),
    }
    return rep


def export_fbx(root, path, textures=None, tex_prefix=None, embed=False):
    """FBX for UE5 + UE-convention textures next to it:
    T_<asset>_BC.png (sRGB), T_<asset>_ORM.png (linear, R=AO G=rough B=metal),
    T_<asset>_N.png (DirectX: green flipped), T_<asset>_E.png (sRGB).
    textures: {'basecolor','orm','normal','emissive'} -> image-order PNGs (texcomp.save_maps).
    The FBX materials reference the T_ files by relative path (embed=False keeps the
    FBX small; UE picks the textures up from the same folder on import)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    d = os.path.dirname(path)
    pre = tex_prefix or ('T_' + os.path.splitext(os.path.basename(path))[0].replace('SM_', ''))
    written = {}
    if textures:
        names = {'basecolor': 'BC', 'orm': 'ORM', 'normal': 'N', 'emissive': 'E'}
        for k, suffix in names.items():
            src = textures.get(k)
            if not src or not os.path.exists(src):
                continue
            im = Image.open(src).convert('RGB')
            if k == 'normal':  # OpenGL (+Y) -> DirectX (-Y) for Unreal
                a = np.array(im)
                a[..., 1] = 255 - a[..., 1]
                im = Image.fromarray(a)
            dst = os.path.join(d, f'{pre}_{suffix}.png')
            im.save(dst)
            written[os.path.abspath(src)] = dst
    # point the atlas images at the T_ files while exporting
    swapped = []
    for img in bpy.data.images:
        fp = os.path.abspath(bpy.path.abspath(img.filepath)) if img.filepath else ''
        if fp in written:
            swapped.append((img, img.filepath))
            img.filepath = written[fp]
    objs = descendants(root)
    select_only(objs, root)
    try:
        with timed('export.fbx'):
            with quiet():
                bpy.ops.export_scene.fbx(
                    filepath=path, use_selection=True, object_types={'EMPTY', 'MESH'},
                    apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', global_scale=1.0,
                    axis_forward='-Z', axis_up='Y', bake_space_transform=False, use_mesh_modifiers=True,
                    mesh_smooth_type='FACE', use_tspace=True, use_custom_props=True, add_leaf_bones=False,
                    path_mode='COPY' if embed else 'RELATIVE', embed_textures=embed, bake_anim=False,
                    use_armature_deform_only=False)
    finally:
        for img, fp in swapped:
            img.filepath = fp
    log(f'FBX -> {path} ({os.path.getsize(path) / 1024:.0f} KiB) + {len(written)} T_ textures')
    return path
