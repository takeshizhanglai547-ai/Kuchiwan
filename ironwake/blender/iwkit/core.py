"""iwkit.core - scene utilities, pivots, parenting, seeded RNG, timing, logging.

Everything here is headless-safe (python3 + `import bpy`, no UI, no GPU).
"""
import math
import os
import random
import sys
import time
from contextlib import contextmanager

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

# ----------------------------------------------------------------------------- paths
IRONWAKE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS_DIR = os.path.join(IRONWAKE_ROOT, 'assets')
UE5_DIR = os.path.join(ASSETS_DIR, 'ue5')
WORK_ROOT = os.environ.get('IWKIT_WORK', '/tmp/claude-0/iwkit_work')


def work_dir(asset_name):
    """Scratch directory for intermediate bakes of one asset (outside the repo)."""
    d = os.path.join(WORK_ROOT, asset_name)
    os.makedirs(d, exist_ok=True)
    return d


# ----------------------------------------------------------------------------- logging / timing
_T0 = time.time()
TIMINGS = {}


def log(*args):
    msg = ' '.join(str(a) for a in args)
    sys.stdout.write(f'[iwkit {time.time() - _T0:7.1f}s] {msg}\n')
    sys.stdout.flush()


@contextmanager
def timed(label):
    """with timed('bake.masks'): ...   -> records TIMINGS[label] (seconds) and logs it."""
    t = time.time()
    try:
        yield
    finally:
        dt = time.time() - t
        TIMINGS[label] = TIMINGS.get(label, 0.0) + dt
        log(f'{label}: {dt:.1f}s')


@contextmanager
def quiet():
    """Silence Blender's C-level stdout spam (bake 'Info:' lines, exporter chatter)."""
    try:
        fd = sys.stdout.fileno()
    except Exception:  # pragma: no cover
        yield
        return
    sys.stdout.flush()
    saved = os.dup(fd)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, fd)
    try:
        yield
    finally:
        sys.stdout.flush()
        os.dup2(saved, fd)
        os.close(devnull)
        os.close(saved)


# ----------------------------------------------------------------------------- RNG
class RNG(random.Random):
    """Seeded RNG. Use `rng.fork('name')` to derive independent deterministic streams
    so adding a greeble in one place never shifts random numbers elsewhere."""

    def __init__(self, seed=0):
        super().__init__(seed)
        self._seed = seed

    def fork(self, tag):
        h = 2166136261
        for ch in f'{self._seed}:{tag}':
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
        return RNG(h)

    def jitter(self, v, amount):
        return v + self.uniform(-amount, amount)


# ----------------------------------------------------------------------------- scene
def reset_scene(unit_scale=1.0):
    """Empty factory scene: metric units, 1 BU = 1 m, Cycles CPU, no default objects."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = unit_scale
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    try:
        bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'NONE'
    except Exception:
        pass
    sc.render.threads_mode = 'AUTO'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    return sc


def collection(name, parent=None):
    """Get or create a collection linked under parent (default: scene root)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(obj, col=None):
    col = col or bpy.context.scene.collection
    if obj.name not in col.objects:
        col.objects.link(obj)
    return obj


def to_matrix(location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    """rotation: Euler degrees (XYZ) tuple, a Quaternion, or a 3x3/4x4 Matrix."""
    if isinstance(rotation, Quaternion):
        R = rotation.to_matrix().to_4x4()
    elif isinstance(rotation, Matrix):
        R = rotation.to_4x4() if len(rotation) == 3 else rotation.copy()
    else:
        R = Euler([math.radians(a) for a in rotation], 'XYZ').to_matrix().to_4x4()
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    S = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return Matrix.Translation(Vector(location)) @ R @ S


def empty(name, location=(0, 0, 0), rotation=(0, 0, 0), parent=None, col=None,
          display='PLAIN_AXES', size=0.25, props=None):
    """Named empty = a pivot node the engine can rotate (glTF node with no mesh).
    location/rotation are WORLD space; the parent relation keeps the world transform."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    link(ob, col)
    ob.matrix_world = to_matrix(location, rotation)
    if parent is not None:
        set_parent(ob, parent)
    for k, v in (props or {}).items():
        ob[k] = v
    return ob


def set_parent(child, parent, keep_world=True):
    """Parent without a parent-inverse matrix, so the glTF local transform == what the
    engine sees (clean TRS values on every node)."""
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)
    if keep_world:
        bpy.context.view_layer.update()
        child.matrix_world = mw
    return child


def set_props(ob, **props):
    """Custom properties -> exported as glTF `extras` (export_extras=True)."""
    for k, v in props.items():
        ob[k] = v
    return ob


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def descendants(ob, include_self=True):
    out = [ob] if include_self else []
    for c in ob.children:
        out.extend(descendants(c, True))
    return out


def meshes_under(root):
    return [o for o in descendants(root) if o.type == 'MESH']


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        me = o.data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def apply_modifiers(ob):
    """Apply every modifier on ob (headless-safe)."""
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob],
                                   selected_editable_objects=[ob]):
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def look_rotation(forward, up=(0, 0, 1)):
    """Matrix3 whose +Z points along `forward` and +Y roughly along `up` (for aligning
    primitives authored along +Z)."""
    f = Vector(forward).normalized()
    u = Vector(up)
    if abs(f.dot(u.normalized())) > 0.999:
        u = Vector((1, 0, 0)) if abs(f.x) < 0.9 else Vector((0, 1, 0))
    x = u.cross(f).normalized()
    y = f.cross(x).normalized()
    return Matrix((x, y, f)).transposed()
