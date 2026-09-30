"""iwkit.asset - `Asset`: the per-asset pipeline object.

    a = Asset('sample', seed=7, scheme='player')
    pv = a.pivot('forearm_R', (0, 0, 1.2))            # named empty (engine contract node)
    a.part('forearm_R_geo', geo, parent=pv)           # geo authored in WORLD coordinates
    a.collider('COL_body', size=(1, 1, 2), center=(0, 0, 1))
    a.decal(decals.emblem(), loc, normal=(1, 0, 0), up=(0, 0, 1), size=(0.4, 0.4))
    a.unwrap(); a.bake(); a.export_glb(path); a.export_fbx(path)

Hierarchy: root (empty) > pivots (empties) > part meshes (identity local transform).
Mesh nodes are named '<pivot>_geo' style (no dots: three.js strips '.' from names).
"""
import json
import os
import time

import bpy
from mathutils import Matrix, Vector

from . import bake as B
from . import decals as D
from . import export as X
from . import materials as M
from . import texcomp as T
from . import uv as U
from .core import (RNG, TIMINGS, collection, descendants, empty, link, log, set_parent, timed, tri_count,
                   work_dir, world_bbox)
from .geo import Geo


class Asset:
    def __init__(self, name, seed=1, scheme='player', colors=None, res=2048, kind='mech', root_name='root',
                 root_location=(0, 0, 0)):
        self.name = name
        self.seed = seed
        self.rng = RNG(seed)
        self.res = res
        self.kind = kind
        self.col = collection(name)
        self.presets = M.resolve_presets(colors, scheme)
        self.palette = M.make_palette(self.presets)
        self.root = empty(root_name, root_location, col=self.col, display='ARROWS', size=0.5,
                          props={'iw_asset': name, 'iw_kind': kind, 'iw_seed': seed})
        self.pivots = {root_name: self.root}
        self.parts = []
        self.colliders = []
        self.decals = []
        self.maps = None
        self.map_paths = None
        self.texel_density = 0.0
        self.work = work_dir(name)
        self.t0 = time.time()

    # ----------------------------------------------------------------- hierarchy
    def pivot(self, name, location=(0, 0, 0), parent=None, rotation=(0, 0, 0), **props):
        """Named empty (glTF node) at a WORLD location, parented under `parent` (name or obj)."""
        par = self._obj(parent) if parent is not None else self.root
        ob = empty(name, location, rotation, parent=par, col=self.col, props=props)
        self.pivots[name] = ob
        return ob

    def _aimed_empty(self, name, location, axis_dir, local_axis, parent, props):
        """Empty whose Blender local `local_axis` (+Y or -Y) points along axis_dir."""
        from mathutils import Vector as V
        d = V(axis_dir).normalized()
        want = d if local_axis == '+Y' else -d
        q = V((0, 1, 0)).rotation_difference(want)
        par = self._obj(parent) if parent is not None else self.root
        ob = empty(name, location, q.to_matrix(), parent=par, col=self.col, props=props)
        self.pivots[name] = ob
        return ob

    def nozzle(self, name, location, exhaust=(0, 1, 0), parent=None, **props):
        """nozzle_<group>_<n> node: exhaust direction (Blender world) becomes the node's
        glTF local -Z (= Blender local +Y), as src/mech/rig.js expects. Place it at the
        nozzle EXIT centre."""
        props.setdefault('iw_fx', 'boost')
        return self._aimed_empty(name, location, exhaust, '+Y', parent, props)

    def muzzle(self, name, location, fire=(0, -1, 0), parent=None, **props):
        """muzzle_* node: projectiles leave along glTF local +Z (= Blender local -Y)."""
        props.setdefault('iw_fx', 'muzzle')
        return self._aimed_empty(name, location, fire, '-Y', parent, props)

    def marker(self, name, location, yaw_deg=0.0, parent=None, **props):
        """Arena marker empty (SPAWN_player, SPAWN_mt_0, OBJ_relay_0 ...). yaw 0 faces
        Blender -Y (= glTF +Z, the 'forward' of spawns)."""
        par = self._obj(parent) if parent is not None else self.root
        ob = empty(name, location, (0, 0, yaw_deg), parent=par, col=self.col, display='SINGLE_ARROW', props=props)
        self.pivots[name] = ob
        return ob

    def _obj(self, x):
        if isinstance(x, str):
            return self.pivots.get(x) or bpy.data.objects[x]
        return x

    def part(self, name, geo, parent=None, sharp_angle=40.0, weighted=True, **props):
        """Mesh object from a Geo authored in WORLD coordinates, parented (identity local
        transform) under the pivot `parent`."""
        par = self._obj(parent) if parent is not None else self.root
        bpy.context.view_layer.update()
        geo.transform(par.matrix_world.inverted())
        geo.canonicalize()  # deterministic element order -> deterministic UVs / bakes
        ob = geo.to_object(name, self.palette, sharp_angle=sharp_angle, weighted=weighted, col=self.col)
        geo.free()
        ob.parent = par
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob['iw_part'] = par.name
        for k, v in props.items():
            ob[k] = v
        self.parts.append(ob)
        return ob

    def collider(self, name, size=None, center=(0, 0, 0), geo=None, parent=None, shape='box', **props):
        """Invisible collision proxy named COL_<name> (src/world/arena.js: the node's local
        bounding box x world matrix becomes a box collider; COL_ nodes are not rendered).
        Extras: {iw_shape: 'box'|'mesh', size: [x, y, z] in glTF axes}. Never baked."""
        from .prims import collider_box
        if not name.startswith('COL_'):
            name = 'COL_' + name
        par = self._obj(parent) if parent is not None else self.root
        g = geo or collider_box(size, center)
        bpy.context.view_layer.update()
        g.transform(par.matrix_world.inverted())
        ob = g.to_object(name, [], weighted=False, col=self.col)
        g.free()
        ob.data.materials.clear()
        ob.parent = par
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob.hide_render = True
        ob.display_type = 'WIRE'
        ob['iw_shape'] = shape if geo is None else 'mesh'   # informational; COL_ name is the contract
        if size is not None:
            ob['size'] = [size[0], size[2], size[1]]  # glTF (Y-up) axis order
        for k, v in props.items():
            ob[k] = v
        self.colliders.append(ob)
        return ob

    # ----------------------------------------------------------------- decals
    def decal(self, image, location, normal, up=(0, 0, 1), size=(0.3, 0.3), depth=0.06, opacity=1.0,
              facing=0.35, name=None):
        """Box-projected decal baked into the albedo of paint materials.
        image: PIL image or file path. size: (width, height) in metres; if height is None
        it follows the image aspect. normal: direction the decal faces (out of the surface)."""
        idx = len(self.decals)
        name = name or f'decal_{idx:02d}'
        if not isinstance(image, str):
            if size[1] is None:
                size = (size[0], size[0] * image.height / image.width)
            path = os.path.join(self.work, f'{name}.png')
            image.save(path)
        else:
            path = image
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = 'sRGB'
        n = Vector(normal).normalized()
        u = Vector(up)
        x = u.cross(n).normalized()
        y = n.cross(x).normalized()
        R = Matrix((x, y, n)).transposed().to_4x4()
        e = bpy.data.objects.new('__' + name, None)
        link(e, self.col)
        e.empty_display_type = 'CUBE'
        e.matrix_world = Matrix.Translation(Vector(location)) @ R @ Matrix.Diagonal(
            (size[0] * 0.5, size[1] * 0.5, depth, 1.0))
        self.decals.append({'empty': e, 'image': img, 'axis': tuple(n), 'opacity': opacity, 'facing': facing})
        return e

    def decal_specs(self):
        return self.decals

    # ----------------------------------------------------------------- pipeline
    def geometry_hash(self):
        """Hash of every baked mesh (positions, UVs, material ids) + decals: keys the bake
        cache so stale bakes are never reused after the model changes."""
        import hashlib

        import numpy as np
        h = hashlib.sha1()
        for o in self.bake_objects():
            me = o.data
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get('co', co)
            h.update(o.name.encode())
            h.update(np.round(co, 5).tobytes())
            if me.uv_layers:
                uv = np.empty(len(me.uv_layers[0].data) * 2, np.float32)
                me.uv_layers[0].data.foreach_get('uv', uv)
                h.update(np.round(uv, 6).tobytes())
            mi = np.empty(len(me.polygons), np.int32)
            me.polygons.foreach_get('material_index', mi)
            h.update(mi.tobytes())
            h.update(np.array(o.matrix_world, np.float32).round(5).tobytes())
        for d in self.decals:
            try:
                with open(bpy.path.abspath(d['image'].filepath), 'rb') as f:
                    h.update(hashlib.md5(f.read()).digest())
            except OSError:
                pass
            h.update(repr((d['image'].filepath, d['axis'], d['opacity'],
                           [list(r) for r in d['empty'].matrix_world])).encode())
        h.update(repr(sorted((k, sorted(v.items())) for k, v in self.presets.items())).encode())
        return h.hexdigest()[:12]

    def bake_objects(self):
        return [o for o in self.parts if o.type == 'MESH']

    def stats(self):
        return {'tris': tri_count(self.parts), 'parts': len(self.parts), 'colliders': len(self.colliders),
                'decals': len(self.decals)}

    def triangulate(self):
        """Triangulate all parts (keeping custom normals) so Cycles' bake tangents, the
        glTF exporter's tangents and three.js all see the exact same triangles."""
        for o in self.bake_objects():
            m = o.modifiers.new('tri', 'TRIANGULATE')
            m.quad_method = 'BEAUTY'
            m.ngon_method = 'BEAUTY'
            m.min_vertices = 4
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o],
                                           selected_editable_objects=[o]):
                bpy.ops.object.modifier_apply(modifier=m.name)

    def unwrap(self, margin_px=None, angle=62.0, triangulate=True, small=0.07, small_scale=0.5, stack=True):
        if triangulate:
            with timed('triangulate'):
                self.triangulate()
        with timed('uv'):
            self.texel_density = U.unwrap(self.bake_objects(), self.res, margin_px or max(4, self.res // 256),
                                          angle, small=small, small_scale=small_scale, stack=stack)
        self.root['iw_texel_density_px_per_m'] = round(self.texel_density, 1)
        return self.texel_density

    def bake(self, weathering=None, edge=0.02, cavity=0.07, ao_dist=0.8, bevel_radius=0.012, samples=None,
             noise_scale=1.0, passes=B.DEFAULT_PASSES, reuse=False):
        """Bake every pass, composite, build the atlas material(s). Returns map paths."""
        if reuse:
            os.environ['IWKIT_REUSE_BAKES'] = '1'
        shader_kw = {'masks': {'edge': edge, 'cavity': cavity, 'thin': edge * 4.0},
                     'ao': {'ao_dist': ao_dist},
                     'normal': {'radius': bevel_radius},
                     'noise': {'scale': noise_scale}}
        lo, hi = world_bbox(self.bake_objects())
        shader_kw['wpos'] = {'lo': tuple(round(x, 4) for x in lo), 'hi': tuple(round(x, 4) for x in hi)}
        glow_max = max([p.get('emit_strength', 0.0) for p in self.presets.values() if p.get('emit')] or [1.0])
        shader_kw['emit'] = {'max_strength': glow_max}
        with timed('bake.total'):
            cache = os.path.join(self.work, 'bake_' + self.geometry_hash())
            os.makedirs(cache, exist_ok=True)
            raw = B.bake_all(self, self.res, passes, samples, shader_kw, cache_dir=cache)
        self.raw = raw
        with timed('composite'):
            table = [self.presets.get(m.name, M.PRESETS['paint_primary']) for m in self.palette]
            self.maps = T.composite(raw, weathering, table)
            self.map_paths = T.save_maps(self.maps, self.work, self.name)
            T.contact_sheet(self.maps, os.path.join(self.work, f'{self.name}_maps_sheet.png'))
        self.apply_atlas(glow_max)
        return self.map_paths

    def apply_atlas(self, glow_strength=8.0, normal_strength=1.0):
        """Replace the semantic slots with the baked atlas material. Faces of emissive
        presets get M_<asset>_glow (same textures) so the engine can pulse them."""
        p = self.map_paths
        imgs = {}
        for k in ('basecolor', 'orm', 'normal', 'emissive'):
            im = bpy.data.images.load(p[k], check_existing=True)
            im.colorspace_settings.name = 'sRGB' if k in ('basecolor', 'emissive') else 'Non-Color'
            imgs[k] = im
        base = M.atlas_material(f'M_{self.name}', imgs['basecolor'], imgs['orm'], imgs['normal'], None, 0.0,
                                normal_strength)
        glow = M.atlas_material(f'M_{self.name}_glow', imgs['basecolor'], imgs['orm'], imgs['normal'],
                                imgs['emissive'], glow_strength, normal_strength)
        glow_idx = {i for i, m in enumerate(self.palette) if self.presets.get(m.name, {}).get('emit')}
        for o in self.bake_objects():
            me = o.data
            used_glow = any(pl.material_index in glow_idx for pl in me.polygons)
            new_idx = [1 if pl.material_index in glow_idx else 0 for pl in me.polygons]
            me.materials.clear()
            me.materials.append(base)
            if used_glow:
                me.materials.append(glow)
            me.polygons.foreach_set('material_index', new_idx if used_glow else [0] * len(new_idx))
            me.update()
        self.atlas = (base, glow)
        return base, glow

    def show_mask(self, name):
        """Debug view: replace every part's material with an unlit display of one map:
        a composite mask ('wear', 'grime', 'streak', 'rust', 'dust', 'edge'), a raw bake
        channel ('masks.0' = convexity, 'masks.1' = cavity, 'masks.2' = AO, 'noise.2'...)
        or a final map ('basecolor', 'orm', 'normal')."""
        import numpy as np
        if name in self.maps.get('_masks', {}):
            a = self.maps['_masks'][name][::-1].astype(np.float32) / 255.0
            rgb = np.stack([a, a, a], -1)
        elif '.' in name:
            k, c = name.split('.')
            a = self.raw[k][..., int(c)]
            rgb = np.stack([a, a, a], -1)
        else:
            rgb = self.maps[name][::-1].astype(np.float32) / 255.0
        h, w = rgb.shape[:2]
        img = bpy.data.images.new('__mask_' + name, w, h, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        px = np.ones((h, w, 4), np.float32)
        px[..., :3] = rgb
        img.pixels.foreach_set(px.ravel())
        mat = bpy.data.materials.new('__mask_' + name)
        b = M.NB(mat)
        t = b.n('ShaderNodeTexImage', image=img)
        e = b.n('ShaderNodeEmission')
        b.link(t.outputs[0], e.inputs[0])
        o = b.n('ShaderNodeOutputMaterial')
        b.link(e.outputs[0], o.inputs['Surface'])
        for p in self.bake_objects():
            for i in range(len(p.material_slots)):
                p.material_slots[i].material = mat
        return mat

    def cleanup_decals(self):
        for d in self.decals:
            e = d.pop('empty', None)
            if e is None:
                continue
            try:
                bpy.data.objects.remove(e)
            except ReferenceError:
                pass

    def export_glb(self, path, image_format='JPEG', quality=90, compress=True):
        self.cleanup_decals()
        self.root['iw_tris'] = tri_count(self.parts)
        self.root['iw_texture_res'] = self.res
        size = X.export_glb(self.root, path, image_format, quality, compress)
        return size

    def export_fbx(self, path=None):
        path = path or os.path.join(X.UE5_DIR, f'SM_{self.name}.fbx')
        self.cleanup_decals()
        return X.export_fbx(self.root, path, self.map_paths)

    def report(self, extra=None):
        r = dict(self.stats())
        r['texel_density_px_per_m'] = round(self.texel_density, 1)
        r['res'] = self.res
        r['timings_s'] = {k: round(v, 1) for k, v in TIMINGS.items()}
        r['elapsed_s'] = round(time.time() - self.t0, 1)
        if extra:
            r.update(extra)
        return r
