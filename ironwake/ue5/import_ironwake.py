"""
IRONWAKE -> Unreal Engine 5: import ue5/assets into /Game/Ironwake and build simple materials.

!!! UNVERIFIED !!!  This script was written in a Linux container WITHOUT Unreal Engine. It has
never run inside Unreal. It only uses documented Unreal Python APIs and every step is wrapped
so one failure does not stop the rest, but expect to fix small things on the first run.

HOW TO RUN (Unreal Editor 5.x):
  1. Edit > Plugins > search "Python Editor Script Plugin" > tick Enabled > restart the editor
     (in most UE5 projects it is already enabled).
  2. Open the level you want the arena in (File > New Level > Basic, then File > Save Current
     Level As... "L_Pier7").
  3. Tools > Execute Python Script... > pick THIS file (ue5/import_ironwake.py).
  4. Wait (1-5 minutes; a progress bar shows). Watch Window > Output Log; lines start "[IRONWAKE]".
IF IT FAILS:
  Window > Output Log > right-click > Copy All (or select all, Ctrl+C) and paste it to Claude Code:
  "I ran ue5/import_ironwake.py and got this log. Please fix the script." Claude Code can then
  edit this file and you run it again (it is safe to run several times: assets are replaced and
  the level actors it placed are removed first).

WHAT IT DOES
  Content Browser:
    /Game/Ironwake/Player    SM_mech_player (RIG-07 IRONWAKE), T_mech_player_*, MI_mech_player_*
    /Game/Ironwake/Rival     SM_mech_boss   (GC-X1 CINDERHOUND), T_mech_boss_*,  MI_mech_boss_*
    /Game/Ironwake/Enemies   SM_enemy_mt (PK-2 PICKET), SM_enemy_drone (GNAT), SM_enemy_relay (relay generator)
    /Game/Ironwake/Arena     SM_Arena_<piece> (kit), SM_Arena_<structure> (one-off), MI_Arena_<base>
    /Game/Ironwake/Materials M_IW_Rig, M_IW_Decal, M_IW_Arena (simple masters) + their instances
  Level (only if PLACE_IN_LEVEL): the arena (~1,700 kit instances + 64 structures) in the outliner
  folder "Ironwake/Arena", TargetPoints for every SPAWN_/OBJ_ marker, a PlayerStart at
  SPAWN_player, and the five models standing next to the player start for a first look.

UNITS / AXES: FBX files are centimetres; Blender (x, y, z) m -> Unreal (x*100, -y*100, z*100).
The rigs face +Y after import (like the UE mannequin): rotate the mesh component -90 deg (yaw)
in a Character Blueprint so it faces +X. If the placed arena looks MIRRORED compared to
the web game (the sea must be NORTH of the player start, i.e. towards +Y), set AXIS_MIRROR_Y
below to False, run again, and tell Claude Code.
"""
import json
import os

import unreal

# ------------------------------------------------------------------------------ settings
GAME_ROOT = '/Game/Ironwake'
IMPORT_RIGS = True            # player rig, rival rig, enemies
IMPORT_ARENA = True           # arena kit + one-off structures
PLACE_IN_LEVEL = True         # place the arena, markers and model previews into the OPEN level
RIG_COMBINE_MESHES = True     # True: one static mesh per model (easy). False: one mesh per part (for animation)
ARENA_COMPLEX_COLLISION = True  # arena meshes collide with their exact shape
AXIS_MIRROR_Y = True          # see "UNITS / AXES" above
REMOVE_BASIC_FLOOR = True     # delete the 'Floor' plane of a "Basic" level (the arena has its own deck)
ASSETS_DIR = ''               # leave empty: found next to this script (ue5/assets)

TAG = 'IRONWAKE'
_log = []


def log(msg):
    _log.append(msg)
    unreal.log('[IRONWAKE] ' + msg)


def warn(msg):
    _log.append('WARNING: ' + msg)
    unreal.log_warning('[IRONWAKE] WARNING: ' + msg)


def err(msg):
    _log.append('ERROR: ' + msg)
    unreal.log_error('[IRONWAKE] ERROR: ' + msg)


def setp(obj, name, value):
    """set_editor_property that tolerates properties missing in this engine version."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as e:  # noqa: BLE001
        warn(f'{type(obj).__name__}.{name} not set ({e})')
        return False


def find_assets_dir():
    if ASSETS_DIR and os.path.isdir(ASSETS_DIR):
        return ASSETS_DIR
    cands = []
    try:
        cands.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets'))
    except NameError:
        pass
    cands.append(os.path.join(unreal.Paths.project_dir(), 'ue5', 'assets'))
    cands.append(os.path.join(unreal.Paths.project_dir(), 'IronwakeAssets'))
    for c in cands:
        if os.path.isfile(os.path.join(c, 'MANIFEST.json')):
            return c
    return None


EAL = unreal.EditorAssetLibrary
MEL = unreal.MaterialEditingLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()


# ------------------------------------------------------------------------------ import helpers
def import_files(files, dest, options=None):
    tasks = []
    for f in files:
        t = unreal.AssetImportTask()
        t.set_editor_property('filename', f)
        t.set_editor_property('destination_path', dest)
        t.set_editor_property('replace_existing', True)
        t.set_editor_property('automated', True)
        t.set_editor_property('save', True)
        if options is not None:
            t.set_editor_property('options', options)
        tasks.append(t)
    TOOLS.import_asset_tasks(tasks)
    out = []
    for t in tasks:
        paths = list(t.get_editor_property('imported_object_paths') or [])
        if not paths:
            warn(f'nothing imported from {os.path.basename(t.filename)}')
        out += paths
    return out


def fbx_options(combine, collision, vertex_colors, lightmap_uvs=True):
    ui = unreal.FbxImportUI()
    setp(ui, 'import_mesh', True)
    setp(ui, 'import_textures', False)      # textures are imported separately (correct settings)
    setp(ui, 'import_materials', False)     # materials are built below
    setp(ui, 'import_as_skeletal', False)
    setp(ui, 'import_animations', False)
    setp(ui, 'mesh_type_to_import', unreal.FBXImportType.FBXIT_STATIC_MESH)
    sm = ui.get_editor_property('static_mesh_import_data')
    setp(sm, 'combine_meshes', combine)
    setp(sm, 'auto_generate_collision', collision)
    setp(sm, 'generate_lightmap_u_vs', lightmap_uvs)
    setp(sm, 'normal_import_method', unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS)
    setp(sm, 'normal_generation_method', unreal.FBXNormalGenerationMethod.MIKK_T_SPACE)
    if vertex_colors:
        setp(sm, 'vertex_color_import_option', unreal.VertexColorImportOption.REPLACE)
    setp(sm, 'import_uniform_scale', 1.0)
    setp(sm, 'convert_scene', True)
    return ui


TEX_KIND = {  # suffix -> (sRGB, compression)
    '_BC': (True, 'TC_DEFAULT'), '_E': (True, 'TC_DEFAULT'), '_N': (False, 'TC_NORMALMAP'),
    '_ORM': (False, 'TC_MASKS'), '_M': (False, 'TC_MASKS'), '_H': (False, 'TC_GRAYSCALE'),
}


def tex_kind(name):
    stem = os.path.splitext(name)[0]
    for suf, kind in TEX_KIND.items():
        if stem.endswith(suf):
            return kind
    return (True, 'TC_DEFAULT')


def import_textures(folder, dest):
    files = sorted(os.path.join(folder, f) for f in os.listdir(folder)
                   if f.startswith('T_') and f.lower().endswith(('.png', '.jpg', '.jpeg')))
    if not files:
        return {}
    import_files(files, dest)
    out = {}
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        path = f'{dest}/{name}'
        tex = EAL.load_asset(path)
        if tex is None:
            warn(f'texture {path} missing after import')
            continue
        srgb, comp = tex_kind(name)
        setp(tex, 'srgb', srgb)
        setp(tex, 'compression_settings', getattr(unreal.TextureCompressionSettings, comp))
        EAL.save_loaded_asset(tex)
        out[name] = tex
    log(f'{len(out)} textures -> {dest}')
    return out


def static_meshes_in(dest):
    out = {}
    for p in EAL.list_assets(dest, recursive=False, include_folder=False):
        a = EAL.load_asset(p)
        if isinstance(a, unreal.StaticMesh):
            out[a.get_name()] = a
    return out


# ------------------------------------------------------------------------------ materials
def load_engine(path):
    a = EAL.load_asset(path)
    if a is None:
        warn(f'engine asset {path} not found')
    return a


def new_material(name, folder):
    """Returns (material, created). An existing master is kept as it is (re-run safe; delete it in
    the Content Browser to have it rebuilt)."""
    path = f'{folder}/{name}'
    if EAL.does_asset_exist(path):
        return EAL.load_asset(path), False
    return TOOLS.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew()), True


def tex_param(mat, name, tex, sampler, x, y):
    e = MEL.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, x, y)
    setp(e, 'parameter_name', name)
    if tex is not None:
        setp(e, 'texture', tex)
    setp(e, 'sampler_type', sampler)
    return e


def scalar_param(mat, name, value, x, y):
    e = MEL.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, x, y)
    setp(e, 'parameter_name', name)
    setp(e, 'default_value', value)
    return e


def vector_param(mat, name, rgb, x, y):
    e = MEL.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, x, y)
    setp(e, 'parameter_name', name)
    setp(e, 'default_value', unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    return e


def multiply(mat, a, a_out, b, b_out, x, y):
    m = MEL.create_material_expression(mat, unreal.MaterialExpressionMultiply, x, y)
    MEL.connect_material_expressions(a, a_out, m, 'A')
    MEL.connect_material_expressions(b, b_out, m, 'B')
    return m


def build_rig_master(folder, sample):
    """M_IW_Rig: BaseColor / Normal / ORM (R AO, G roughness, B metal) / Emissive x strength."""
    mat, created = new_material('M_IW_Rig', folder)
    if not created:
        return mat
    S = unreal.MaterialSamplerType
    bc = tex_param(mat, 'BaseColor', sample.get('BC'), S.SAMPLERTYPE_COLOR, -700, -300)
    n = tex_param(mat, 'Normal', sample.get('N'), S.SAMPLERTYPE_NORMAL, -700, 0)
    orm = tex_param(mat, 'ORM', sample.get('ORM'), S.SAMPLERTYPE_MASKS, -700, 300)
    em = tex_param(mat, 'Emissive', sample.get('E'), S.SAMPLERTYPE_COLOR, -700, 600)
    k = scalar_param(mat, 'EmissiveStrength', 8.0, -450, 750)
    P = unreal.MaterialProperty
    MEL.connect_material_property(bc, 'RGB', P.MP_BASE_COLOR)
    MEL.connect_material_property(n, 'RGB', P.MP_NORMAL)
    MEL.connect_material_property(orm, 'R', P.MP_AMBIENT_OCCLUSION)
    MEL.connect_material_property(orm, 'G', P.MP_ROUGHNESS)
    MEL.connect_material_property(orm, 'B', P.MP_METALLIC)
    MEL.connect_material_property(multiply(mat, em, 'RGB', k, '', -250, 650), '', P.MP_EMISSIVE_COLOR)
    MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    return mat


def build_decal_master(folder, sample):
    """M_IW_Decal: masked stencils / warning labels (alpha = shape)."""
    mat, created = new_material('M_IW_Decal', folder)
    if not created:
        return mat
    setp(mat, 'blend_mode', unreal.BlendMode.BLEND_MASKED)
    S, P = unreal.MaterialSamplerType, unreal.MaterialProperty
    bc = tex_param(mat, 'BaseColor', sample, S.SAMPLERTYPE_COLOR, -600, 0)
    r = scalar_param(mat, 'Roughness', 0.75, -350, 250)
    MEL.connect_material_property(bc, 'RGB', P.MP_BASE_COLOR)
    MEL.connect_material_property(bc, 'A', P.MP_OPACITY_MASK)
    MEL.connect_material_property(r, '', P.MP_ROUGHNESS)
    MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    return mat


def build_arena_master(folder):
    """M_IW_Arena: vertex colour (the web build's per-variant paint tint) x BaseTint; emissive =
    vertex colour x vertex alpha x EmissiveFromVertex (glow strips, sodium lamps, slag)."""
    mat, created = new_material('M_IW_Arena', folder)
    if not created:
        return mat
    P = unreal.MaterialProperty
    vc = MEL.create_material_expression(mat, unreal.MaterialExpressionVertexColor, -800, 0)
    tint = vector_param(mat, 'BaseTint', (1, 1, 1), -800, -250)
    MEL.connect_material_property(multiply(mat, vc, '', tint, '', -500, -100), '', P.MP_BASE_COLOR)
    MEL.connect_material_property(scalar_param(mat, 'Roughness', 0.8, -500, 150), '', P.MP_ROUGHNESS)
    MEL.connect_material_property(scalar_param(mat, 'Metallic', 0.0, -500, 250), '', P.MP_METALLIC)
    glow = multiply(mat, vc, '', vc, 'A', -500, 400)
    k = scalar_param(mat, 'EmissiveFromVertex', 0.0, -500, 550)
    MEL.connect_material_property(multiply(mat, glow, '', k, '', -250, 450), '', P.MP_EMISSIVE_COLOR)
    MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    return mat


def make_instance(name, folder, parent, textures=None, scalars=None, vectors=None):
    path = f'{folder}/{name}'
    if EAL.does_asset_exist(path):
        mi = EAL.load_asset(path)
    else:
        mi = TOOLS.create_asset(name, folder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    MEL.set_material_instance_parent(mi, parent)
    for k, v in (textures or {}).items():
        if v is not None:
            MEL.set_material_instance_texture_parameter_value(mi, k, v)
    for k, v in (scalars or {}).items():
        MEL.set_material_instance_scalar_parameter_value(mi, k, v)
    for k, v in (vectors or {}).items():
        MEL.set_material_instance_vector_parameter_value(mi, k, unreal.LinearColor(v[0], v[1], v[2], 1.0))
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    return mi


def assign_slots(mesh, pick):
    """pick(slot_name) -> material or None. Returns the number of slots set."""
    n = 0
    for i, s in enumerate(mesh.get_editor_property('static_materials')):
        m = pick(str(s.get_editor_property('material_slot_name')))
        if m is not None:
            mesh.set_material(i, m)
            n += 1
    EAL.save_loaded_asset(mesh)
    return n


# ------------------------------------------------------------------------------ rigs
def import_rigs(root, manifest, masters):
    dests, meshes = {}, {}
    for a in manifest['assets']:
        if a['name'] == 'arena':
            continue
        folder = os.path.join(root, a['folder'])
        dest = f'{GAME_ROOT}/{a["folder"]}'
        if dest not in dests:
            dests[dest] = import_textures(folder, dest + '/Textures')
        tex = dests[dest]
        name = a['name']
        before = set(static_meshes_in(dest))
        import_files([os.path.join(folder, a['fbx'])], dest, fbx_options(RIG_COMBINE_MESHES, True, False))
        mine = {k: v for k, v in static_meshes_in(dest).items() if k not in before or name in k}
        if RIG_COMBINE_MESHES and f'SM_{name}' not in mine:
            for k in list(mine):     # some importers name the combined mesh after the file without the prefix
                if k.endswith(name):
                    EAL.rename_asset(mine[k].get_path_name().split('.')[0], f'{dest}/SM_{name}')
                    mine = {f'SM_{name}': EAL.load_asset(f'{dest}/SM_{name}')}
                    break
        sets = sorted({k.split('_')[-2] for k in tex if k.startswith(f'T_{name}_') and k.split('_')[-2] in ('A', 'B')}) or ['']
        mis = {}
        if masters.get('rig') is None:
            first = sets[0]
            pre = f'T_{name}_{first}_' if first else f'T_{name}_'
            masters['rig'] = build_rig_master(f'{GAME_ROOT}/Materials', {s: tex.get(pre + s) for s in ('BC', 'N', 'ORM', 'E')})
        for s in sets:
            pre = f'T_{name}_{s}_' if s else f'T_{name}_'
            mis[s] = make_instance(f'MI_{name}{"_" + s if s else ""}', dest, masters['rig'],
                                   {'BaseColor': tex.get(pre + 'BC'), 'Normal': tex.get(pre + 'N'),
                                    'ORM': tex.get(pre + 'ORM'), 'Emissive': tex.get(pre + 'E')},
                                   {'EmissiveStrength': 8.0})
        decal = tex.get(f'T_{name}_Decal_BC')
        if decal is not None:
            if masters.get('decal') is None:
                masters['decal'] = build_decal_master(f'{GAME_ROOT}/Materials', decal)
            mis['decal'] = make_instance(f'MI_{name}_Decal', dest, masters['decal'], {'BaseColor': decal})

        def pick(slot):
            low = slot.lower()
            if 'decal' in low:
                return mis.get('decal')
            for s in sets:                      # M_<name>_A_glow -> set A
                if s and f'_{s.lower()}_' in low + '_':
                    return mis[s]
            return mis.get(sets[0])
        n = sum(assign_slots(m, pick) for m in mine.values())
        meshes[name] = list(mine.values())
        log(f'{a["title"]}: {len(mine)} static mesh(es), {len(mis)} material instance(s), {n} slots assigned -> {dest}')
    return meshes


# ------------------------------------------------------------------------------ arena
ARENA_LOOK = {   # base -> (BaseTint linear rgb, roughness, metallic, emissive-from-vertex)
    'concrete': ((0.25, 0.23, 0.20), 0.85, 0.0, 0.0), 'heap': ((0.08, 0.07, 0.06), 0.95, 0.0, 0.0),
    'ground': ((0.20, 0.19, 0.17), 0.9, 0.0, 0.0), 'steel': ((1, 1, 1), 0.55, 0.6, 0.0),
    'corr': ((1, 1, 1), 0.6, 0.5, 0.0), 'trim': ((1, 1, 1), 0.6, 0.3, 0.0),
    'decal': ((1, 1, 1), 0.8, 0.0, 0.0), 'glow': ((1, 1, 1), 0.5, 0.0, 16.0 * 8.0),
    'slag': ((1, 1, 1), 0.7, 0.0, 16.0 * 6.0), 'sea': ((0.012, 0.022, 0.025), 0.08, 0.0, 0.0),
    'belt': ((0.015, 0.015, 0.015), 0.9, 0.0, 0.0), 'far': ((0.16, 0.14, 0.12), 0.95, 0.0, 0.0),
}


def import_arena(root, entry, masters):
    folder = os.path.join(root, entry['folder'])
    dest = f'{GAME_ROOT}/Arena'
    layout = json.load(open(os.path.join(folder, 'arena_layout.json')))
    tex_dir = os.path.join(folder, 'Textures')
    if os.path.isdir(tex_dir):
        import_textures(tex_dir, dest + '/Textures')
    else:
        log('arena tiling textures not included (optional: python3 tools/ue5_package.py --arena-textures)')
    meshes = {}
    for fbx, sub in ((layout['kit_fbx'], 'Kit'), (layout['unique_fbx'], 'Structures')):
        d = f'{dest}/{sub}'
        # Arena pieces are vertex-colour only (M_IW_Arena); many have no UV channel at all
        # (QA r1: 62/114 kit, 20/64 structures), so no lightmap UVs are generated for them
        # (UE5's default Lumen lighting does not use lightmaps).
        import_files([os.path.join(folder, fbx)], d, fbx_options(False, False, True, lightmap_uvs=False))
        found = static_meshes_in(d)
        log(f'{fbx}: {len(found)} static meshes -> {d}')
        for k, m in found.items():
            meshes[(sub, k)] = m
    # piece name -> mesh  (the importer may name a node "K_crane", "SM_Arena_Kit_K_crane", ...)
    pieces, uniques = {}, {}
    for (sub, k), m in meshes.items():
        if sub == 'Kit':
            for p in layout['pieces']:
                if k == 'K_' + p or k.endswith('_K_' + p) or k == 'SM_Arena_' + p:
                    pieces[p] = m
        else:
            for u in layout['uniques']:
                if k == u or k.endswith('_' + u) or k == 'SM_Arena_' + u:
                    uniques[u] = m
    missing = [p for p in layout['pieces'] if p not in pieces]
    if missing:
        warn(f'{len(missing)} kit pieces not found after import, e.g. {missing[:5]}')
    # rename to UE convention
    for p, m in list(pieces.items()):
        want = f'{dest}/Kit/SM_Arena_{p}'
        cur = m.get_path_name().split('.')[0]
        if cur != want and EAL.rename_asset(cur, want):
            pieces[p] = EAL.load_asset(want)
    for u, m in list(uniques.items()):
        want = f'{dest}/Structures/SM_Arena_{u}'
        cur = m.get_path_name().split('.')[0]
        if cur != want and EAL.rename_asset(cur, want):
            uniques[u] = EAL.load_asset(want)
    # materials
    if masters.get('arena') is None:
        masters['arena'] = build_arena_master(f'{GAME_ROOT}/Materials')
    mis = {}
    for mname in layout['materials']:
        base = mname[2:] if mname.startswith('M_') else mname
        tint, rough, metal, emit = ARENA_LOOK.get(base, ((0.2, 0.2, 0.2), 0.8, 0.0, 0.0))
        mis[mname] = make_instance(f'MI_Arena_{base}', f'{dest}/Materials', masters['arena'],
                                   scalars={'Roughness': rough, 'Metallic': metal, 'EmissiveFromVertex': emit},
                                   vectors={'BaseTint': tint})
    for m in list(pieces.values()) + list(uniques.values()):
        assign_slots(m, lambda slot: mis.get(slot) or mis.get('M_' + slot.split('_')[-1]))
        if ARENA_COMPLEX_COLLISION:
            try:
                bs = m.get_editor_property('body_setup')
                bs.set_editor_property('collision_trace_flag', unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
                EAL.save_loaded_asset(m)
            except Exception as e:  # noqa: BLE001
                warn(f'collision setting failed on {m.get_name()}: {e}')
    log(f'arena: {len(pieces)} kit pieces, {len(uniques)} structures, {len(mis)} material instances')
    return layout, pieces, uniques


# ------------------------------------------------------------------------------ level
def ue_xform(t):
    loc, q, s = t['loc'], t['quat'], t['scale']
    if not AXIS_MIRROR_Y:     # undo the y mirror baked into the layout (see the module doc)
        loc = [loc[0], -loc[1], loc[2]]
        q = [-q[0], q[1], -q[2], q[3]]
    rot = unreal.Quat(q[0], q[1], q[2], q[3]).rotator()
    return unreal.Vector(*loc), rot, unreal.Vector(*s)


def place_level(layout, pieces, uniques, rig_meshes):
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    # remove what an earlier run placed
    old = [a for a in actors.get_all_level_actors() if TAG in [str(t) for t in a.get_editor_property('tags')]]
    for a in old:
        actors.destroy_actor(a)
    if old:
        log(f'removed {len(old)} actors from an earlier run')
    if REMOVE_BASIC_FLOOR:
        for a in actors.get_all_level_actors():
            if isinstance(a, unreal.StaticMeshActor) and a.get_actor_label() == 'Floor':
                actors.destroy_actor(a)
                log('removed the Basic level "Floor" plane')

    def tag(a, label, folder):
        a.set_actor_label(label)
        a.set_folder_path(folder)
        try:
            a.set_editor_property('tags', list(a.get_editor_property('tags')) + [TAG])
        except Exception as e:  # noqa: BLE001
            warn(f'could not tag {label}: {e}')

    def spawn(asset_or_class, t, label, folder, converted=None):
        loc, rot, scale = converted if converted is not None else ue_xform(t)
        if isinstance(asset_or_class, type):
            a = actors.spawn_actor_from_class(asset_or_class, loc, rot)
        else:
            a = actors.spawn_actor_from_object(asset_or_class, loc, rot)
        if a is None:
            return None
        a.set_actor_scale3d(scale)
        tag(a, label, folder)
        return a

    ident = {'loc': [0, 0, 0], 'quat': [0, 0, 0, 1], 'scale': [1, 1, 1]}
    n = len(layout['instances']) + len(uniques)
    with unreal.ScopedSlowTask(n, 'IRONWAKE: placing the arena') as task:
        task.make_dialog(True)
        for u, m in uniques.items():
            task.enter_progress_frame(1)
            spawn(m, ident, f'Arena_{u}', 'Ironwake/Arena/Structures')
        for i, inst in enumerate(layout['instances']):
            if task.should_cancel():
                warn('placement cancelled')
                break
            task.enter_progress_frame(1)
            m = pieces.get(inst['piece'])
            if m is not None:
                spawn(m, inst, f'{inst["piece"]}_{i}', f'Ironwake/Arena/Kit/{inst["piece"]}')
    player = None
    for mk in layout['markers']:
        spawn(unreal.TargetPoint, mk, mk['name'], 'Ironwake/Markers')
        if mk['name'] == 'SPAWN_player':
            player = mk
    if player is not None:
        loc, rot, _ = ue_xform(player)
        # the marker's forward is its local +Y; a PlayerStart looks along its local +X
        ps_rot = unreal.Rotator(roll=0.0, pitch=0.0, yaw=rot.yaw + 90.0)
        ps = actors.spawn_actor_from_class(unreal.PlayerStart, loc + unreal.Vector(0.0, 0.0, 120.0), ps_rot)
        if ps is not None:
            tag(ps, 'PlayerStart_Pier7', 'Ironwake/Markers')
        # the five models in a row 30 m ahead of the player start, for a first look
        x = -2400.0
        one = unreal.Vector(1.0, 1.0, 1.0)
        for name, ms in rig_meshes.items():
            for m in (ms[:1] if RIG_COMBINE_MESHES else ms):
                lift = 600.0 if name == 'enemy_drone' else 0.0     # the drone's pivot is its body centre
                spawn(m, None, f'Preview_{name}', 'Ironwake/Previews',
                      converted=(unreal.Vector(loc.x + x, loc.y + 3000.0, loc.z + lift), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0), one))
            x += 1200.0
    log(f'level: {n} arena actors, {len(layout["markers"])} markers, PlayerStart at SPAWN_player')


# ------------------------------------------------------------------------------ main
def main():
    root = find_assets_dir()
    if root is None:
        err('ue5/assets not found. Set ASSETS_DIR at the top of this script to the full path of the '
            'ue5/assets folder (the one that contains MANIFEST.json), then run it again.')
        return
    log(f'assets: {root}')
    manifest = json.load(open(os.path.join(root, 'MANIFEST.json')))
    for d in (GAME_ROOT, f'{GAME_ROOT}/Materials'):
        EAL.make_directory(d)
    masters, rig_meshes, layout, pieces, uniques = {}, {}, None, {}, {}
    if IMPORT_RIGS:
        try:
            rig_meshes = import_rigs(root, manifest, masters)
        except Exception as e:  # noqa: BLE001
            err(f'rig import failed: {e!r}')
    arena = next((a for a in manifest['assets'] if a['name'] == 'arena'), None)
    if IMPORT_ARENA and arena is not None:
        try:
            layout, pieces, uniques = import_arena(root, arena, masters)
        except Exception as e:  # noqa: BLE001
            err(f'arena import failed: {e!r}')
    if PLACE_IN_LEVEL and layout is not None:
        try:
            place_level(layout, pieces, uniques, rig_meshes)
        except Exception as e:  # noqa: BLE001
            err(f'level placement failed: {e!r}')
    try:
        EAL.save_directory(GAME_ROOT, only_if_is_dirty=True, recursive=True)
    except Exception as e:  # noqa: BLE001
        warn(f'save failed: {e!r}')
    errors = [m for m in _log if m.startswith('ERROR')]
    warns = [m for m in _log if m.startswith('WARNING')]
    log(f'DONE: {len(errors)} error(s), {len(warns)} warning(s). '
        + ('Copy the Output Log to Claude Code to fix them.' if errors or warns else 'Save the level (Ctrl+S).'))


main()
