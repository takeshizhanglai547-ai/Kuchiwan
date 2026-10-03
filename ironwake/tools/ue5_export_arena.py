"""tools/ue5_export_arena.py - Unreal Engine hand-off export of the ARENA (Halvard Deep Foundry, Pier 7).

    python3 tools/ue5_export_arena.py            (~30 s; Blender bpy 4.2, CPU only)

Re-runs the arena build script (blender/arena/build_arena.py) in this process WITHOUT touching
the game files (its GLB export and its splat-map write are replaced), then writes, into the
gitignored export folder assets/ue5/arena/:

  SM_Arena_Kit.fbx      every USED kit piece (K_<name>), each at its own origin. The web build places
                        ~1,700 copies of ~115 pieces; Unreal gets each piece ONCE.
  SM_Arena_Unique.fbx   the one-off structures (halls, stockhouse, carrier, ground pieces...), already
                        at their world position (object transform = identity).
  arena_layout.json     every kit instance (piece name + UE transform: cm, quaternion, scale), the
                        markers (SPAWN_player / SPAWN_mt_n / SPAWN_drone_n / SPAWN_boss_n / OBJ_relay_n,
                        FX_*), the collider boxes (COL_*) and the material list.
                        ue5/import_ironwake.py reads it to rebuild the level in Unreal.

FBX settings follow blender/iwkit/export.py (metres -> centimetres, -Z forward / Y up, smoothing
groups + custom normals, custom properties) except: NO tangents (Unreal recomputes MikkTSpace,
the same basis Blender used) and vertex colours written as sRGB (the arena materials carry their
paint tint in COLOR_0.rgb and a per-variant parameter in COLOR_0.a, see blender/arena/akit.py).

Coordinates: Blender (x, y, z) metres -> Unreal (x, -y, z) centimetres (the FBX importer's
"Convert Scene" mirrors Blender's Y). Kit transforms in the JSON are already converted:
M_ue = S * M_blender * S with S = diag(1, -1, 1). UNVERIFIED in Unreal (no UE in the build
container): if the rebuilt level looks mirrored, flip AXIS_MIRROR in ue5/import_ironwake.py.
"""
import json
import math
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'ue5', 'arena')
KIT_FBX = os.path.join(OUT_DIR, 'SM_Arena_Kit.fbx')
UNIQUE_FBX = os.path.join(OUT_DIR, 'SM_Arena_Unique.fbx')
LAYOUT = os.path.join(OUT_DIR, 'arena_layout.json')

sys.argv = [sys.argv[0]]          # build_arena.main() reads sys.argv; give it none
sys.path.insert(0, os.path.join(ROOT, 'blender', 'arena'))
import build_arena as BA          # noqa: E402  (imports bpy, akit, iwkit)
A = BA.A
import bpy                        # noqa: E402
from mathutils import Matrix      # noqa: E402

S4 = Matrix.Diagonal((1.0, -1.0, 1.0, 1.0))


def ue_transform(M):
    """Blender world matrix (metres) -> Unreal {loc cm, quat xyzw, scale} (see module doc)."""
    Mu = S4 @ M @ S4
    loc, rot, scale = Mu.decompose()
    return {'loc': [round(loc.x * 100, 3), round(loc.y * 100, 3), round(loc.z * 100, 3)],
            'quat': [round(rot.x, 6), round(rot.y, 6), round(rot.z, 6), round(rot.w, 6)],
            'scale': [round(scale.x, 5), round(scale.y, 5), round(scale.z, 5)]}


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def fbx_export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, use_selection=True, object_types={'MESH'},
              apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', global_scale=1.0,
              axis_forward='-Z', axis_up='Y', bake_space_transform=False, use_mesh_modifiers=True,
              mesh_smooth_type='FACE', use_tspace=False, use_custom_props=True, add_leaf_bones=False,
              path_mode='STRIP', embed_textures=False, bake_anim=False, use_armature_deform_only=False)
    try:
        bpy.ops.export_scene.fbx(**kw, colors_type='SRGB', prioritize_active_color=True)
    except TypeError:             # older exporter without the colour options
        bpy.ops.export_scene.fbx(**kw)
    return os.path.getsize(path)


def export_ue(_out, pack=True):
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)
    kit_by_mesh = {k['mesh'].name: name for name, k in A.KIT.items()}
    objs = list(A.OUT_COL.objects)
    instances = [o for o in objs if o.type == 'MESH' and o.data.name in kit_by_mesh]
    uniques = [o for o in objs if o.type == 'MESH' and o.data.name not in kit_by_mesh]
    empties = [o for o in objs if o.type == 'EMPTY']
    used = sorted({kit_by_mesh[o.data.name] for o in instances})

    # kit templates (one object per USED piece, at its own origin, named K_<piece>)
    kit_objs = []
    for name in used:
        me = A.KIT[name]['mesh']
        tmpl = bpy.data.objects.get('K_' + name)
        if tmpl is None or tmpl.data is not me:
            tmpl = bpy.data.objects.new('K_' + name, me)
            bpy.context.scene.collection.objects.link(tmpl)
        if tmpl.name not in bpy.context.view_layer.objects:
            bpy.context.scene.collection.objects.link(tmpl)
        tmpl.matrix_world = Matrix.Identity(4)
        kit_objs.append(tmpl)
    # the kit collection is excluded from rendering / may be hidden: make the templates exportable
    for c in bpy.data.collections:
        c.hide_viewport = False
        c.hide_render = False
    for lc in bpy.context.view_layer.layer_collection.children:
        lc.exclude = False
        lc.hide_viewport = False

    kit_bytes = fbx_export(KIT_FBX, kit_objs)
    uniq_bytes = fbx_export(UNIQUE_FBX, uniques)

    layout = {
        'about': 'IRONWAKE arena (Halvard Deep Foundry, Pier 7) for Unreal. Generated by tools/ue5_export_arena.py. '
                 'Units: Unreal centimetres, Z up; Blender (x, y, z) m -> Unreal (x*100, -y*100, z*100). UNVERIFIED in Unreal.',
        'kit_fbx': os.path.basename(KIT_FBX), 'unique_fbx': os.path.basename(UNIQUE_FBX),
        'pieces': {name: {'mesh': 'K_' + name, 'tris': A.KIT[name]['tris'], 'count': A.KIT[name]['n'],
                          'materials': [m.name for m in A.KIT[name]['mesh'].materials]} for name in used},
        'uniques': {o.name: {'tris': tri_count(o.data), 'materials': [m.name for m in o.data.materials]} for o in uniques},
        'instances': [dict(piece=kit_by_mesh[o.data.name], **ue_transform(o.matrix_world)) for o in instances],
        'markers': [], 'fx': [], 'colliders': [],
        'materials': sorted({m.name for o in uniques for m in o.data.materials} |
                            {m.name for n in used for m in A.KIT[n]['mesh'].materials}),
        'material_notes': {
            'COLOR_0': 'rgb = paint / tint colour (sRGB in the FBX), a = per-variant parameter '
                       '(steel/corr: rust wear 0..1, concrete: stain, decal: opacity, glow: intensity/16)',
            'preview_colors': dict(A.PREVIEW),
        },
    }
    for e in empties:
        t = ue_transform(e.matrix_world)
        if e.name.startswith('COL_'):
            # cube empty: world scale = HALF extents (m) -> full box size in cm
            t['size_cm'] = [round(abs(s) * 200, 2) for s in t['scale']]
            layout['colliders'].append(t)
        elif e.name.startswith('FX_'):
            layout['fx'].append(dict(name=e.name, extras={k: (v if isinstance(v, (int, float, str)) else str(v)) for k, v in e.items()}, **t))
        else:
            layout['markers'].append(dict(name=e.name, **t))
    with open(LAYOUT, 'w') as f:
        json.dump(layout, f, separators=(',', ':'))
    kt = sum(A.KIT[n]['tris'] for n in used)
    ut = sum(tri_count(o.data) for o in uniques)
    print(f'[ue5-arena] {len(used)} kit pieces ({kt / 1e3:.0f}k tris) -> {KIT_FBX} {kit_bytes / 1e6:.2f} MB')
    print(f'[ue5-arena] {len(uniques)} unique meshes ({ut / 1e3:.0f}k tris) -> {UNIQUE_FBX} {uniq_bytes / 1e6:.2f} MB')
    print(f'[ue5-arena] {len(instances)} instances, {len(layout["markers"])} markers, {len(layout["fx"])} fx, '
          f'{len(layout["colliders"])} colliders -> {LAYOUT} {os.path.getsize(LAYOUT) / 1e6:.2f} MB  ({time.time() - t0:.1f} s)')
    sys.stdout.flush()


A.export = export_ue              # build_arena.main() calls A.export(out, pack=...)
BA.splat = lambda path: None      # never rewrite the game's splat map
BA.main()                         # ends with os._exit(0)
