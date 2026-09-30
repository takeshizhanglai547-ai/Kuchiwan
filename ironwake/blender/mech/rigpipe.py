"""blender/mech/rigpipe.py - rig texture pipeline v2 (owner: mech modeler).

On top of iwkit (not modifying it):
  * TWO texture sets per rig (A = upper body + weapons, B = legs / pelvis / back pack):
    each set gets its own UV atlas, bake and composite (AO/cavity still see the whole
    rig: the other set stays visible as an occluder while one set bakes).
  * DECAL CARDS: every stencil, label, number, emblem and hazard band is a separate
    alpha-blended quad floating a few mm over its plate, textured from a dedicated
    decal atlas at 450-600 px/m (the albedo atlas only carries soot/scorch blotches).
  * WebP GLB images (EXT_texture_webp): the GLB exported by Blender + gltfpack is
    re-packed with WebP images encoded from the lossless source maps, per-map sizes
    and qualities (see run(): tex_sizes / tex_quality).
  * UE5 FBX with one T_ texture group per set + the decal atlas.
"""
import io
import json
import math
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image  # noqa: E402

import mechkit as K  # noqa: E402
from mechkit import iw  # noqa: E402
from iwkit import asset as IA  # noqa: E402
from iwkit import bake as IB  # noqa: E402
from iwkit import export as X  # noqa: E402
from iwkit import materials as M  # noqa: E402
from iwkit import texcomp as T  # noqa: E402
from iwkit.core import descendants, link, log, quiet, select_only, timed, world_bbox  # noqa: E402


# ============================================================================ decal cards
def card(a, image, loc, normal, up=(0, 0, 1), size=(0.3, None), parent='torso', density=520, offset=0.004):
    """Register a decal card: `image` (PIL RGBA) on a quad centred at `loc` (world),
    facing `normal`, image-up along `up`, `size` (w, h|None) in metres, parented to the
    pivot `parent`. `density` = atlas px per metre (text >= 450)."""
    if not hasattr(a, 'cards'):
        a.cards = []
    if size[1] is None:
        size = (size[0], size[0] * image.height / image.width)
    n = Vector(normal).normalized()
    a.cards.append(dict(img=image.convert('RGBA'), loc=Vector(loc), n=n, up=Vector(up), size=tuple(size),
                        parent=parent, density=density, offset=offset))


def _pack(specs, W, pad):
    order = sorted(range(len(specs)), key=lambda i: (-specs[i]['px'][1], -specs[i]['px'][0], i))
    x = y = sh = 0
    pos = {}
    for i in order:
        w, h = specs[i]['px']
        if x + w + 2 * pad > W:
            y += sh
            x, sh = 0, 0
        pos[i] = (x + pad, y + pad)
        x += w + 2 * pad
        sh = max(sh, h + 2 * pad)
    return pos, y + sh


def _dilate_rgb(img, steps=6):
    """Bleed opaque colours into transparent texels (no dark fringes under mipmapping)."""
    a = np.asarray(img, np.float32)
    rgb, al = a[..., :3], a[..., 3:] / 255.0
    w = (al > 0.02).astype(np.float32)
    acc, wt = rgb * w, w.copy()
    for _ in range(steps):
        pa = np.pad(acc, ((1, 1), (1, 1), (0, 0)), mode='edge')
        pw = np.pad(wt, ((1, 1), (1, 1), (0, 0)), mode='edge')
        acc2 = (pa[:-2, 1:-1] + pa[2:, 1:-1] + pa[1:-1, :-2] + pa[1:-1, 2:] + pa[1:-1, 1:-1])
        wt2 = (pw[:-2, 1:-1] + pw[2:, 1:-1] + pw[1:-1, :-2] + pw[1:-1, 2:] + pw[1:-1, 1:-1])
        fill = (wt < 0.5) & (wt2 > 0)
        acc = np.where(fill, acc2 / np.maximum(wt2, 1e-6) * 1.0, acc)
        wt = np.where(fill, 1.0, wt)
    out = np.where(wt > 0, acc, rgb)
    res = np.concatenate([out, a[..., 3:]], -1)
    return Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def _world_bvh(objs):
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in objs:
        me = o.data
        M = o.matrix_world
        base = len(verts)
        verts.extend(M @ v.co for v in me.vertices)
        polys.extend(tuple(base + i for i in p.vertices) for p in me.polygons)
    return BVHTree.FromPolygons(verts, polys)


def snap_cards(a, reach=0.45, offset=0.004):
    """Seat every card on the actual surface: rays along -normal from the centre and the
    four corners; the card rides at the highest hit (+ offset) so ridges, bolts and bevels
    never poke through it. Cards with no hit keep their authored position."""
    bpy.context.view_layer.update()
    bvh = _world_bvh(a.bake_objects())
    moved = 0
    for s in getattr(a, 'cards', []):
        n, u = s['n'], s['up']
        x = u.cross(n).normalized()
        y = n.cross(x).normalized()
        hw, hh = s['size'][0] * 0.5, s['size'][1] * 0.5
        best = None
        for sx, sy in ((0, 0), (-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9), (0, -0.9), (0, 0.9)):
            o = s['loc'] + x * (sx * hw) + y * (sy * hh) + n * reach
            hit, hn, fi, d = bvh.ray_cast(o, -n, reach * 2.0)
            if hit is None:
                continue
            h = (hit - s['loc']).dot(n)
            if abs(h) > 0.2:      # another part in front / nothing near the authored plane
                continue
            best = h if best is None else max(best, h)
        if best is not None:
            s['loc'] = s['loc'] + n * best
            s['offset'] = offset
            moved += 1
    log(f'decal cards: {moved}/{len(getattr(a, "cards", []))} seated on the surface')


def build_cards(a, W=2048, max_h=2048, pad=4, density_scale=0.86):
    """Pack every registered card into the decal atlas and build one card mesh per pivot
    (named '<pivot>_decals', material M_<asset>_decal). Call after baking."""
    specs = getattr(a, 'cards', [])
    if not specs:
        return None
    snap_cards(a)
    scale = density_scale
    for _ in range(12):
        for s in specs:
            d = s['density'] * scale
            s['px'] = (max(12, int(round(s['size'][0] * d))), max(12, int(round(s['size'][1] * d))))
        pos, H = _pack(specs, W, pad)
        if H <= max_h:
            break
        scale *= 0.92
    Hp = max(256, int(math.ceil(H / 128.0)) * 128)   # NPOT height is fine in WebGL2 (mipmapped)
    atlas = Image.new('RGBA', (W, Hp), (0, 0, 0, 0))
    for i, s in enumerate(specs):
        im = s['img'].resize(s['px'], Image.LANCZOS)
        atlas.alpha_composite(im, pos[i])
    # smooth + quantise the (worn, sprayed) alpha: the per-pixel erosion noise of the decal
    # generators costs ~40% of the file and reads as sparkle when minified
    from PIL import ImageFilter
    al = np.asarray(atlas.getchannel('A').filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255.0
    al = np.round(al * 15.0) / 15.0
    atlas.putalpha(Image.fromarray((al * 255.0 + 0.5).astype(np.uint8)))
    atlas = _dilate_rgb(atlas)
    path = os.path.join(a.work, f'{a.name}_decals.png')
    atlas.save(path)
    img = bpy.data.images.load(path, check_existing=False)
    img.name = f'{a.name}_decals'
    img.colorspace_settings.name = 'sRGB'
    mat = decal_material(f'M_{a.name}_decal', img)
    by_parent = {}
    for i, s in enumerate(specs):
        by_parent.setdefault(s['parent'], []).append(i)
    obs = []
    bpy.context.view_layer.update()
    for parent, idx in sorted(by_parent.items()):
        par = a.pivots[parent]
        inv = par.matrix_world.inverted()
        verts, faces, uvs = [], [], []
        for i in idx:
            s = specs[i]
            n, u = s['n'], s['up']
            x = u.cross(n).normalized()
            y = n.cross(x).normalized()
            c = s['loc'] + n * s['offset']
            hw, hh = s['size'][0] * 0.5, s['size'][1] * 0.5
            px, py = pos[i]
            w, h = s['px']
            u0, u1 = px / W, (px + w) / W
            v1, v0 = 1.0 - py / Hp, 1.0 - (py + h) / Hp
            k = len(verts)
            for (sx, sy, uu, vv) in ((-1, -1, u0, v0), (1, -1, u1, v0), (1, 1, u1, v1), (-1, 1, u0, v1)):
                verts.append(tuple(inv @ (c + x * (sx * hw) + y * (sy * hh))))
                uvs.append((uu, vv))
            faces.append((k, k + 1, k + 2, k + 3))
        me = bpy.data.meshes.new(f'{parent}_decals')
        me.from_pydata(verts, [], faces)
        me.uv_layers.new(name='UVMap')
        for li, lp in enumerate(me.loops):
            me.uv_layers[0].data[li].uv = uvs[lp.vertex_index]
        me.materials.append(mat)
        me.update()
        ob = bpy.data.objects.new(f'{parent}_decals', me)
        link(ob, a.col)
        ob.parent = par
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob['iw_decal'] = 1
        ob['iw_noshadow'] = 1
        obs.append(ob)
    a.card_objects = obs
    a.decal_atlas = path
    log(f'decal cards: {len(specs)} cards in {len(obs)} meshes, atlas {W}x{Hp} (scale {scale:.2f})')
    return path


def decal_material(name, img, rough=0.62):
    m = bpy.data.materials.new(name)
    b = M.NB(m)
    t = b.n('ShaderNodeTexImage', image=img)
    t.interpolation = 'Linear'
    bsdf = b.n('ShaderNodeBsdfPrincipled')
    b.link(t.outputs['Color'], bsdf.inputs['Base Color'])
    b.link(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    out = b.n('ShaderNodeOutputMaterial')
    b.link(bsdf.outputs[0], out.inputs['Surface'])
    for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    return m


# ============================================================================ texture sets
def uv_png(objs, path, res=1024):
    """Debug: draw the UV triangles of objs (one colour per object)."""
    from PIL import ImageDraw
    im = Image.new('RGB', (res, res), (12, 12, 12))
    d = ImageDraw.Draw(im)
    for k, o in enumerate(objs):
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers[0].data
        col = tuple(int(60 + 195 * ((k * f) % 7) / 6) for f in (3, 5, 2))
        for t in me.loop_triangles:
            d.polygon([(uv[l].uv.x * res, (1 - uv[l].uv.y) * res) for l in t.loops], fill=col)
    im.save(path)
    return path


def _bake_pass_occluders(asset, pass_name, res, samples=None, margin_px=None, shader_kw=None):
    """iwkit.bake.bake_pass, except that the OTHER texture set's meshes stay visible as
    occluders (AO / cavity across the set boundary) instead of being hidden."""
    sc = bpy.context.scene
    objs = asset.bake_objects()
    keep = set(getattr(asset, '_all_bake_objects', objs))
    samples = samples or IB.PASS_SAMPLES.get(pass_name, 4)
    margin_px = margin_px if margin_px is not None else max(4, res // 128)
    img = IB._image(f'__bake_{pass_name}', res)
    builder = M.PASS_SHADERS[pass_name]
    kw = dict(shader_kw or {})
    pass_mats = []
    for i, pm in enumerate(asset.palette):
        preset = asset.presets.get(pm.name, M.PRESETS['paint_primary'])
        mat = bpy.data.materials.new(f'__{pass_name}_{pm.name}')
        extra = {'index': i} if pass_name == 'matid' else {}
        builder(mat, preset, img, asset.seed, asset.decal_specs(), **kw, **extra)
        pass_mats.append(mat)
    saved = {}
    for o in objs:
        saved[o.name] = [s.material for s in o.material_slots]
        for i in range(len(o.material_slots)):
            o.material_slots[i].material = pass_mats[i] if i < len(pass_mats) else pass_mats[0]
    hidden = []
    for o in bpy.context.scene.objects:
        if o not in objs and o not in keep and not o.hide_render and o.type in ('MESH', 'CURVE', 'SURFACE', 'FONT'):
            o.hide_render = True
            hidden.append(o)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 2 if pass_name == 'normal' else 0
    bk = sc.render.bake
    bk.margin = margin_px
    bk.margin_type = 'EXTEND'
    bk.use_clear = True
    bk.target = 'IMAGE_TEXTURES'
    bk.use_selected_to_active = False
    if pass_name == 'normal':
        bk.normal_space = 'TANGENT'
        bk.normal_r, bk.normal_g, bk.normal_b = 'POS_X', 'POS_Y', 'POS_Z'
    select_only(objs)
    with timed(f'bake.{asset.name}.{pass_name}'):
        with quiet():
            bpy.ops.object.bake(type='NORMAL' if pass_name == 'normal' else 'EMIT', margin=margin_px, use_clear=True)
    arr = IB.to_numpy(img)
    for o in objs:
        for i, m in enumerate(saved[o.name]):
            o.material_slots[i].material = m
    for o in hidden:
        o.hide_render = False
    for m in pass_mats:
        bpy.data.materials.remove(m)
    bpy.data.images.remove(img)
    return arr


def clean_normal(nrm, flat=0.012):
    """Snap near-flat texels of an OpenGL normal map (uint8 RGB, image order) to exactly
    flat: removes the bake's sampling noise on plain faces (cleaner shading, smaller file)."""
    n = nrm.astype(np.float32) / 127.5 - 1.0
    dev = np.hypot(n[..., 0], n[..., 1])
    out = nrm.copy()
    out[dev < flat] = (128, 128, 255)
    return out


def bake_sets(a, sets, weathering=None, reuse=False, sizes=None, **bake_kw):
    """Bake each texture set {tag: [objs]} into its own atlas + material M_<asset>_<tag>.
    Returns {tag: {'paths': final map paths}}."""
    all_objs = a.bake_objects()
    lo, hi = world_bbox(all_objs)
    name0, bo0, bbox0, pass0 = a.name, a.bake_objects, IA.world_bbox, IB.bake_pass
    a._all_bake_objects = list(all_objs)
    IA.world_bbox = lambda objs: (lo.copy(), hi.copy())   # macro gradients over the WHOLE rig
    IB.bake_pass = _bake_pass_occluders
    out = {}
    try:
        for tag, objs in sets.items():
            a.bake_objects = (lambda objs=objs: list(objs))
            a.name = f'{name0}_{tag}'
            a.bake(weathering=weathering, reuse=reuse, **bake_kw)
            a.raw = None
            a.maps.pop('_masks', None)
            paths = finalize_set(a, (sizes or {}).get(tag, {}))
            out[tag] = {'paths': paths, 'maps': a.maps}
    finally:
        a.name, a.bake_objects, IA.world_bbox, IB.bake_pass = name0, bo0, bbox0, pass0
    a.set_results = out
    return out


def finalize_set(a, sizes):
    """Roughness floor + normal cleanup, re-save the maps (PNG, lossless) at their final
    sizes and point this set's atlas material images at them."""
    old = {k: os.path.abspath(v) for k, v in a.map_paths.items()}
    orm = a.maps['orm']
    np.maximum(orm[..., 1], np.uint8(round(K.ROUGH_FLOOR * 255)), out=orm[..., 1])
    a.maps['normal'] = clean_normal(a.maps['normal'])
    out = os.path.join(a.work, 'final')
    paths = T.save_maps(a.maps, out, a.name + '_f', sizes=sizes)
    for img in list(bpy.data.images):
        fp = os.path.abspath(bpy.path.abspath(img.filepath)) if img.filepath else ''
        for k, p in old.items():
            if fp == p:
                img.filepath = paths[k]
                img.reload()
                img.name = os.path.splitext(os.path.basename(paths[k]))[0]
    a.map_paths = paths
    return paths


# ============================================================================ GLB WebP repack
def _glb_read(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, total = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67
    off = 12
    js, bn = None, b''
    while off < total:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bn = chunk
        off += 8 + clen
    return js, bn


def _glb_write(path, js, bn):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bn += b'\0' * ((4 - len(bn) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bn)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(bn), 0x004E4942))
        f.write(bn)


def webp_bytes(src, kind, size=None, quality=85):
    im = Image.open(src)
    im = im.convert('RGBA' if kind == 'decals' else 'RGB')
    if size and size != im.width:
        h = int(round(im.height * size / im.width))
        im = im.resize((size, h), Image.LANCZOS)
    b = io.BytesIO()
    if quality >= 101:
        im.save(b, 'WEBP', lossless=True, quality=100, method=6)
    elif kind == 'decals':
        im.save(b, 'WEBP', quality=int(quality), method=6, alpha_quality=55)
    else:
        im.save(b, 'WEBP', quality=int(quality), method=6)
    return b.getvalue()


def repack_glb_webp(path, sources, quality, sizes=None, decal_mat=None):
    """Replace every GLB image with a WebP encoded from its lossless source.
    sources: {image name: png path}; quality/sizes: {kind: q | px} (kind = suffix after
    the last '_': basecolor, orm, normal, emissive, decals; q >= 101 = lossless).
    Rebuilds the BIN chunk (plain and EXT_meshopt_compression views) and adds
    EXT_texture_webp (required). Also turns the decal material into an alpha-blended one."""
    js, bn = _glb_read(path)
    views = js['bufferViews']
    new_img = {}
    for ii, im in enumerate(js.get('images', [])):
        nm = im.get('name', '')
        kind = nm.rsplit('_', 1)[-1]
        src = sources.get(nm)
        if src is None:
            log('webp: no source for image', nm, '(kept)')
            continue
        new_img[im['bufferView']] = webp_bytes(src, kind, (sizes or {}).get(nm, (sizes or {}).get(kind)),
                                              quality.get(nm, quality.get(kind, 85)))
        im['mimeType'] = 'image/webp'
    # relayout buffer 0
    refs = []   # (offset, length, setter)
    for vi, v in enumerate(views):
        ext = v.get('extensions', {}).get('EXT_meshopt_compression')
        if ext is not None and ext.get('buffer', 0) == 0:
            refs.append((ext.get('byteOffset', 0), ext['byteLength'], vi, ext))
        elif v.get('buffer', 0) == 0:
            refs.append((v.get('byteOffset', 0), v['byteLength'], vi, v))
    refs.sort(key=lambda r: (r[0], r[2]))
    out = bytearray()
    for off, ln, vi, holder in refs:
        data = new_img.get(vi) if holder is views[vi] else None
        if data is None:
            data = bn[off:off + ln]
        out += b'\0' * ((4 - len(out) % 4) % 4)
        holder['byteOffset'] = len(out)
        holder['byteLength'] = len(data)
        out += data
    js['buffers'][0]['byteLength'] = len(out)
    for t in js.get('textures', []):
        if 'source' in t:
            src = t.pop('source')
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': src}
    for key in ('extensionsUsed', 'extensionsRequired'):
        lst = js.setdefault(key, [])
        if 'EXT_texture_webp' not in lst:
            lst.append('EXT_texture_webp')
    for m in js.get('materials', []):
        m['doubleSided'] = False
        if decal_mat and m.get('name') == decal_mat:
            m['alphaMode'] = 'BLEND'
            for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
                m.pop(k, None)
            pbr = m.setdefault('pbrMetallicRoughness', {})
            pbr.pop('metallicRoughnessTexture', None)
            pbr['metallicFactor'] = 0.0
            pbr['roughnessFactor'] = 0.62
    _glb_write(path, js, bytes(out))
    return os.path.getsize(path)


def glb_breakdown(path):
    js, bn = _glb_read(path)
    views = js['bufferViews']
    imgs = {}
    for im in js.get('images', []):
        v = views[im['bufferView']]
        imgs[im.get('name')] = v['byteLength']
    return {'bytes': os.path.getsize(path), 'images': imgs, 'image_bytes': sum(imgs.values()),
            'geometry_bytes': os.path.getsize(path) - sum(imgs.values())}


# ============================================================================ FBX (UE5)
def export_fbx_sets(a, path=None):
    """SM_<asset>.fbx + T_<asset>_<set>_{BC,ORM,N,E}.png per set + T_<asset>_Decal_BC.png."""
    path = path or os.path.join(X.UE5_DIR, f'SM_{a.name}.fbx')
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    written = {}
    names = {'basecolor': 'BC', 'orm': 'ORM', 'normal': 'N', 'emissive': 'E'}
    for tag, r in a.set_results.items():
        for k, suf in names.items():
            src = r['paths'].get(k)
            im = Image.open(src).convert('RGB')
            if k == 'normal':
                arr = np.array(im)
                arr[..., 1] = 255 - arr[..., 1]
                im = Image.fromarray(arr)
            dst = os.path.join(d, f'T_{a.name}_{tag}_{suf}.png')
            im.save(dst)
            written[os.path.abspath(src)] = dst
    if getattr(a, 'decal_atlas', None):
        dst = os.path.join(d, f'T_{a.name}_Decal_BC.png')
        Image.open(a.decal_atlas).save(dst)
        written[os.path.abspath(a.decal_atlas)] = dst
    # legacy single-set files from the previous pipeline would confuse an import
    for suf in names.values():
        p = os.path.join(d, f'T_{a.name}_{suf}.png')
        if os.path.exists(p):
            os.remove(p)
    swapped = []
    for img in bpy.data.images:
        fp = os.path.abspath(bpy.path.abspath(img.filepath)) if img.filepath else ''
        if fp in written:
            swapped.append((img, img.filepath))
            img.filepath = written[fp]
    a.cleanup_decals()
    objs = descendants(a.root)
    select_only(objs, a.root)
    try:
        with timed('export.fbx'):
            with quiet():
                bpy.ops.export_scene.fbx(
                    filepath=path, use_selection=True, object_types={'EMPTY', 'MESH'},
                    apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', global_scale=1.0,
                    axis_forward='-Z', axis_up='Y', bake_space_transform=False, use_mesh_modifiers=True,
                    mesh_smooth_type='FACE', use_tspace=True, use_custom_props=True, add_leaf_bones=False,
                    path_mode='RELATIVE', embed_textures=False, bake_anim=False, use_armature_deform_only=False)
    finally:
        for img, fp in swapped:
            img.filepath = fp
    log(f'FBX -> {path} ({os.path.getsize(path) / 1024:.0f} KiB) + {len(written)} T_ textures')
    return path


# ============================================================================ driver
DEFAULT_QUALITY = {'basecolor': 80, 'orm': 72, 'normal': 82, 'emissive': 88, 'decals': 80}


def export_glb_lean(root, path, strip_tangents=True, quality=60):
    """Blender glTF export (placeholder JPEGs, replaced by WebP later) -> optional TANGENT
    strip (three.js then builds the tangent frame per pixel from UV derivatives; ~15% less
    vertex data) -> gltfpack meshopt/quantisation (-vn 8)."""
    import shutil
    import subprocess
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = descendants(root)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    select_only(objs, root)
    raw = path[:-4] + '.raw.glb'
    with timed('export.glb'):
        with quiet():
            bpy.ops.export_scene.gltf(
                filepath=raw, export_format='GLB', use_selection=True, export_extras=True,
                export_yup=True, export_apply=True, export_tangents=not strip_tangents, export_normals=True,
                export_texcoords=True, export_materials='EXPORT', export_image_format='JPEG',
                export_jpeg_quality=quality, export_image_quality=quality, export_cameras=False,
                export_lights=False, export_animations=False, export_skins=False, export_morph=False,
                export_vertex_color='NONE', export_attributes=False, check_existing=False)
    if X.gltfpack_available():
        args = [X._node(), X.GLTFPACK, '-i', raw, '-o', path, '-cc', '-ce', 'ext', '-kn', '-km', '-ke',
                '-vn', '8', '-vt', '14']
        with timed('export.gltfpack'):
            r = subprocess.run(args, capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(path):
            log('gltfpack failed, keeping uncompressed GLB:', r.stderr.strip()[:400])
            shutil.move(raw, path)
        else:
            os.remove(raw)
    else:
        shutil.move(raw, path)
    return os.path.getsize(path)


def run(name, build_fn, decal_fn, set_of, scheme='player', colors=None, seed=7, obj_weight=None, weathering=None,
        views=None, clay=None, bake_kw=None, tex_sizes=None, tex_quality=None, poses=None, strip_tangents=True):
    """Rig build CLI (v2 pipeline).
        --blockout [--poses] [--views a,b]   geometry + clay renders only (fast)
        --quick                              1024 bakes, GLB, 2 previews at 1280x720
        (default)                            2048 bakes, GLB + FBX, all previews at 1600x900
    set_of(obj_name) -> 'A' | 'B' picks each part's texture set."""
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=2048)
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--blockout', action='store_true')
    ap.add_argument('--poses', action='store_true')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--no-fbx', action='store_true')
    ap.add_argument('--reuse-bakes', action='store_true')
    ap.add_argument('--views', default='')
    ap.add_argument('--seg-scale', type=float, default=0.66)
    ap.add_argument('--out', default=os.path.join(K.ASSETS, name + '.glb'))
    args = ap.parse_args([x for x in sys.argv[1:] if x != '--'])
    if args.quick:
        args.res, args.samples = 1024, 24
    K.P.SEG_SCALE = args.seg_scale
    t0 = time.time()
    os.makedirs(K.PREVIEW, exist_ok=True)
    iw.reset_scene()
    a = iw.Asset(name, seed=seed, scheme=scheme, res=args.res, kind='mech', colors=colors)
    tris = build_fn(a)
    st = a.stats()
    iw.log('model:', st['tris'], 'tris in', st['parts'], 'parts')
    iw.log('parts:', json.dumps(dict(sorted(tris.items(), key=lambda kv: -kv[1]))))
    work = os.path.join(a.work, 'clay')
    if args.blockout:
        sel = args.views.split(',') if args.views else list(clay)
        paths = K.clay_views(a, os.path.join(work, 'clay'), {k: clay[k] for k in sel})
        K.contact(paths, os.path.join(work, 'clay_sheet.png'))
        if args.poses:
            pp = []
            for pose, view in (poses or {}).items():
                K.set_pose(a, K.POSES[pose] if isinstance(pose, str) and pose in K.POSES else pose)
                pp += K.clay_views(a, os.path.join(work, f'pose_{pose}'), {'v': view}, res=(640, 360), samples=8)
            K.contact(pp, os.path.join(work, 'pose_sheet.png'))
            K.set_pose(a, {})
        iw.log('clay ->', work)
        return a
    decal_fn(a)
    a.triangulate()
    sets = {}
    for o in a.bake_objects():
        sets.setdefault(set_of(o.name), []).append(o)
    sets = dict(sorted(sets.items()))
    td = {}
    for tag, objs in sets.items():
        td[tag] = K._unwrap_weighted(objs, args.res, max(4, args.res // 512), 66.0, shape='CONCAVE',
                                     obj_weight=obj_weight)
        cov, ovl = iw.uv.coverage(objs, 512)
        td[tag] = {'texel_px_per_m': round(td[tag], 1), 'coverage': round(cov, 3), 'overlap': round(ovl, 4),
                   'tris': iw.tri_count(objs)}
        iw.log(f'set {tag}: {len(objs)} meshes, {td[tag]}')
        uv_png(objs, os.path.join(a.work, f'uv_{tag}.png'))
    a.texel_density = min(v['texel_px_per_m'] for v in td.values())
    kw = dict(edge=0.035, cavity=0.085, ao_dist=1.1, bevel_radius=0.016)
    kw.update(bake_kw or {})
    sizes = {}
    for tag in sets:
        sz = dict((tex_sizes or {}).get(tag, {}))
        if args.quick:
            sz = {k: max(256, v // 2) for k, v in sz.items()}
        sizes[tag] = sz
    bake_sets(a, sets, weathering=weathering, reuse=args.reuse_bakes, sizes=sizes, **kw)
    build_cards(a)
    # Blender -> GLB (placeholder JPEGs) -> gltfpack (meshopt) -> WebP from the lossless sources
    a.cleanup_decals()
    a.root['iw_tris'] = iw.tri_count(a.parts)
    a.root['iw_texture_res'] = args.res
    a.root['iw_texture_sets'] = ','.join(sets)
    export_glb_lean(a.root, args.out, strip_tangents=strip_tangents)
    sources = {}
    for tag, r in a.set_results.items():
        for k, p in r['paths'].items():
            sources[os.path.splitext(os.path.basename(p))[0]] = p
    if getattr(a, 'decal_atlas', None):
        sources[f'{name}_decals'] = a.decal_atlas
    q = dict(DEFAULT_QUALITY)
    q.update(tex_quality or {})
    size = repack_glb_webp(args.out, sources, q, decal_mat=f'M_{name}_decal')
    bd = glb_breakdown(args.out)
    rep = iw.export.glb_report(args.out)
    missing = [n for n in iw.MECH_NODES if n not in rep['nodes']]
    iw.log('GLB contract nodes:', 'OK' if not missing else f'MISSING {missing}', f'{size / 1e6:.2f} MB',
           json.dumps(bd))
    fbx = None
    if not args.no_fbx and not args.quick:
        fbx = export_fbx_sets(a)
    previews = []
    if not args.no_render:
        iw.preview.studio(a.parts)
        names = args.views.split(',') if args.views else (['hero', 'back'] if args.quick else list(views))
        for n in names:
            iw.preview.camera(a.parts, **views[n])
            p = os.path.join(K.PREVIEW, f'{name}_{n}.png')
            iw.preview.render(p, res=(1600, 900) if not args.quick else (1280, 720), samples=args.samples)
            previews.append(p)
    r = a.report({'glb_bytes': size, 'glb_breakdown': bd, 'missing_nodes': missing, 'fbx': fbx,
                  'previews': previews, 'parts_tris': tris, 'texture_sets': td,
                  'cards': len(getattr(a, 'cards', [])), 'total_s': round(time.time() - t0, 1)})
    with open(os.path.join(K.ASSETS, name + '_report.json'), 'w') as f:
        json.dump(r, f, indent=1, ensure_ascii=False)
    iw.log('REPORT', json.dumps({k: r[k] for k in ('tris', 'glb_bytes', 'total_s')}), json.dumps(td))
    return a
