# tools/make_contract_fixtures.py — minimal GLBs that follow the IRONWAKE node contracts.
#
#   python3 tools/make_contract_fixtures.py -- .shots/fixtures
#   node tools/shoot.mjs --shot mech_three_quarter,gameplay_chase \
#        --params "asset.mech_player=.shots/fixtures/test_mech.glb&asset.arena=.shots/fixtures/test_arena.glb"
#
# test_mech.glb : every node of the mech contract (src/mech/rig.js) with box meshes.
# test_arena.glb: ground, COL_ colliders (incl. a rotated one), SPAWN_/OBJ_ markers.
# Use it to verify the GLB code paths, and as a reference for how Blender coordinates map
# (Blender Z-up, -Y forward -> glTF/three +Y up, +Z forward). bpy may segfault on exit
# on exit; the script ends with os._exit(0) to skip that teardown.
import bpy, math, sys, os
out = sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.shots', 'fixtures')
os.makedirs(out, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent: o.parent = parent
    return o

def cube(name, loc, size, parent=None, mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0))
    c = bpy.context.active_object
    c.name = name
    c.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if parent: c.parent = parent
    c.location = loc
    if mat: c.data.materials.append(mat)
    return c

def material(name, rgb, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 5
    return m

# ---------------- mech (Blender: Z up, faces -Y; exporter converts to +Y up, +Z forward)
reset()
M = material('armor', (0.2, 0.25, 0.3)); E = material('eye', (0,0,0), (0.2, 1.0, 0.4))
def B(x, y, z):  # contract coords (x, y_up, z_fwd) -> blender (x, -z, y)
    return (x, -z, y)
root = empty('root', (0,0,0))
pelvis = empty('pelvis', B(0,5.25,0), root); cube('pelvis_mesh', (0,0,0), (2.4,1.6,1.0), pelvis, M)
torso = empty('torso', B(0,0.9,0), pelvis); cube('torso_mesh', B(0,1.5,0), (3.4,2.4,2.2), torso, M)
head = empty('head', B(0,2.9,0.2), torso); cube('head_mesh', B(0,0.5,0), (1.1,1.4,0.8), head, M)
eye = empty('eye', B(0,0.6,0.8), head); cube('eye_mesh', (0,0,0), (0.8,0.1,0.15), eye, E)
for s, x in (('L', 1), ('R', -1)):
    arm = empty('arm_'+s, B(2.3*x, 2.0, 0), torso); cube('arm_mesh_'+s, B(0,-0.9,0), (0.8,0.8,1.8), arm, M)
    fa = empty('forearm_'+s, B(0,-1.8,0), arm); cube('fa_mesh_'+s, B(0,0,0.9), (0.8,1.8,0.8), fa, M)
    hand = empty('hand_'+s, B(0,0,1.9), fa)
    w = empty('weapon_'+s, B(0,0,0.2), hand); cube('w_mesh_'+s, B(0,0,1), (0.4,2.4,0.5), w, M)
    empty('muzzle_'+s, B(0,0,2.3), w)
    sh = empty('shoulder_'+s, B(1.4*x, 2.8, -0.7), torso); cube('sh_mesh_'+s, B(0,0.5,0), (1.2,1.8,1.0), sh, M)
    th = empty('thigh_'+s, B(1.2*x, -0.25, 0), pelvis); cube('th_mesh_'+s, B(0,-1.1,0), (1.1,1.2,2.2), th, M)
    sn = empty('shin_'+s, B(0,-2.3,0), th); cube('sn_mesh_'+s, B(0,-1.1,0), (1.2,1.3,2.2), sn, M)
    ft = empty('foot_'+s, B(0,-2.2,0), sn); cube('ft_mesh_'+s, B(0,-0.3,0.3), (1.4,2.6,0.45), ft, M)
bb = empty('booster_back', B(0,1.6,-1.3), torso)
n1 = empty('nozzle_back_1', B(0.6,0,-0.5), bb); n2 = empty('nozzle_back_2', B(-0.6,0,-0.5), bb)
empty('booster_L', B(1.8,0.7,-0.4), torso); empty('booster_R', B(-1.8,0.7,-0.4), torso)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'test_mech.glb'), export_format='GLB', export_yup=True, export_apply=False)

# ---------------- arena
reset()
G = material('ground', (0.35,0.33,0.3)); W = material('wall', (0.5,0.45,0.4))
bpy.ops.mesh.primitive_plane_add(size=520, location=(0,0,0)); bpy.context.active_object.name = 'ground'
bpy.context.active_object.data.materials.append(G)
for i, (x, y) in enumerate([(-40, 60), (50, 20), (0, -40)]):
    c = cube('block_%d' % i, (x, y, 10), (20, 20, 20), None, W)
    col = cube('COL_block_%d' % i, (x, y, 10), (20, 20, 20))
# a rotated collider-only wall
col = cube('COL_ramp', (80, -80, 5), (40, 4, 10)); col.rotation_euler = (0, 0, math.radians(30))
vis = cube('ramp_vis', (80, -80, 5), (40, 4, 10), None, W); vis.rotation_euler = (0, 0, math.radians(30))
# spawns (blender -Y = forward); SPAWN_player at south facing north (+Y blender = -Z three... )
sp = empty('SPAWN_player', (0, 150, 0))    # three: (0,0,-150)
# identity rotation = faces Blender -Y = three +Z (toward the arena center)
for i in range(5): empty('SPAWN_mt_%d' % (i+1), (-40 + i * 20, 20, 0))
for i in range(5): empty('SPAWN_drone_%d' % (i+1), (-60 + i * 30, -60, 30))
for i, (x, y) in enumerate([(-120, -120), (120, -120), (0, -180)]): empty('OBJ_relay_%d' % (i+1), (x, y, 0))
empty('SPAWN_boss_1', (0, 60, 0))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'test_arena.glb'), export_format='GLB', export_yup=True, export_extras=True)
print('fixtures written to', out)
sys.stdout.flush()
os._exit(0)  # skip bpy teardown (it can segfault on exit)
