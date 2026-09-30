"""iwkit.preview - Cycles CPU look-dev renders for visual inspection.

studio(): 3-point area lights (warm key, cool rim, soft fill) + a procedural
"HDRI-like" world (graded sky/horizon/ground with two soft-box hot spots that give
metal something to reflect) + a dark concrete floor with contact shadows.
render(): frames the given objects from an azimuth/elevation and renders a still
(OpenImageDenoise when available).
"""
import math
import os

import bpy
from mathutils import Vector

from .core import link, log, quiet, timed, world_bbox
from .materials import NB, hexlin

STUDIO_TAG = '__iw_studio'


def _world(strength=1.0):
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = hexlin('#0E0F11')
    cr.elements[1].position = 1.0
    cr.elements[1].color = hexlin('#2B3038')
    for pos, col in ((0.47, '#15161A'), (0.5, '#6A625A'), (0.53, '#4A4A4E'), (0.7, '#343A44')):
        e = cr.elements.new(pos)
        e.color = hexlin(col)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs[2], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], ramp.inputs[0])
    col = ramp.outputs[0]
    # soft boxes (bright blobs for reflections)
    for d, power, tint in (((-0.55, -0.6, 0.58), 6.0, '#FFE7C8'), ((0.8, 0.45, 0.4), 3.5, '#C8DAFF')):
        dv = Vector(d).normalized()
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        nt.links.new(tc.outputs['Generated'], dot.inputs[0])
        dot.inputs[1].default_value = dv
        sm = nt.nodes.new('ShaderNodeMapRange')
        sm.interpolation_type = 'SMOOTHSTEP'
        sm.inputs['From Min'].default_value = 0.93
        sm.inputs['From Max'].default_value = 0.985
        sm.inputs['To Max'].default_value = power
        nt.links.new(dot.outputs['Value'], sm.inputs['Value'])
        add = nt.nodes.new('ShaderNodeMix')
        add.data_type = 'RGBA'
        add.blend_type = 'ADD'
        add.inputs['Factor'].default_value = 1.0
        nt.links.new(col, add.inputs[6])
        mul = nt.nodes.new('ShaderNodeVectorMath')
        mul.operation = 'SCALE'
        mul.inputs[0].default_value = hexlin(tint)[:3]
        nt.links.new(sm.outputs[0], mul.inputs['Scale'])
        nt.links.new(mul.outputs['Vector'], add.inputs[7])
        col = add.outputs[2]
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new(col, bg.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])


def _area(name, loc, target, power, size, color, shape='RECTANGLE', size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.shape = shape
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob[STUDIO_TAG] = True
    link(ob)
    ob.location = loc
    d = (Vector(target) - Vector(loc)).normalized()
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def clear_studio():
    for o in list(bpy.context.scene.objects):
        if o.get(STUDIO_TAG):
            data = o.data
            bpy.data.objects.remove(o)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Light):
                    bpy.data.lights.remove(data)
                elif isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)


def studio(objs, key=1.0, floor=True, world_strength=0.45, floor_color='#18191B'):
    """Build the look-dev studio around objs (list of objects)."""
    clear_studio()
    lo, hi = world_bbox(objs)
    c = (lo + hi) * 0.5
    size = max((hi - lo).length, 0.5)
    _world(world_strength)
    s = size
    _area('key', c + Vector((-1.1, -1.3, 1.2)) * s, c, 125.0 * key * s * s, 0.8 * s, (1.0, 0.9, 0.78))
    _area('rim', c + Vector((1.3, 1.4, 0.8)) * s, c, 260.0 * key * s * s, 0.3 * s, (0.72, 0.84, 1.0),
          size_y=1.3 * s)
    _area('fill', c + Vector((1.6, -1.0, 0.1)) * s, c, 22.0 * key * s * s, 2.0 * s, (0.85, 0.9, 1.0))
    _area('top', c + Vector((0.0, 0.2, 1.8)) * s, c, 30.0 * key * s * s, 1.2 * s, (1.0, 0.97, 0.92))
    if floor:
        me = bpy.data.meshes.new('floor')
        R = 40.0 * s
        z = lo.z - 0.002
        me.from_pydata([(-R, -R, z), (R, -R, z), (R, R, z), (-R, R, z)], [], [(0, 1, 2, 3)])
        fl = bpy.data.objects.new('floor', me)
        fl[STUDIO_TAG] = True
        link(fl)
        m = bpy.data.materials.get('__floor') or bpy.data.materials.new('__floor')
        b = NB(m)
        bsdf = b.n('ShaderNodeBsdfPrincipled')
        tc = b.n('ShaderNodeTexCoord')
        nz = b.noise(tc.outputs['Object'], 0.6, 6.0, 0.6)
        ramp = b.n('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = hexlin(floor_color)
        ramp.color_ramp.elements[1].color = hexlin('#2A2927')
        b.link(nz, ramp.inputs[0])
        b.link(ramp.outputs[0], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.78
        out = b.n('ShaderNodeOutputMaterial')
        b.link(bsdf.outputs[0], out.inputs['Surface'])
        me.materials.append(m)
    return c, size


def camera(objs, azimuth=-35.0, elevation=12.0, lens=55.0, fill=0.86, aspect=16 / 9, target=None,
           distance=None, shift=(0.0, 0.0)):
    """Camera looking at the objects' bbox centre (or `target`) from azimuth/elevation
    (azimuth 0 = from -Y = the asset's front, positive = clockwise seen from above).
    The distance is solved so the 8 bbox corners fill `fill` of the frame (0..1); with
    an explicit target (close-ups) use fill > 1 to crop into the asset."""
    lo, hi = world_bbox(objs)
    c = Vector(target) if target else (lo + hi) * 0.5
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.sensor_fit = 'HORIZONTAL'
    cd.shift_x, cd.shift_y = shift
    az, el = math.radians(azimuth), math.radians(elevation)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    fwd = -d
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    tx = 18.0 / lens
    ty = tx / aspect
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]

    def extent(D):
        cam = c + d * D
        m = 0.0
        for p in corners:
            v = p - cam
            z = v.dot(fwd)
            if z <= 1e-3:
                return 1e9
            m = max(m, abs(v.dot(right)) / (z * tx), abs(v.dot(up)) / (z * ty))
        return m
    if distance is None:
        a, b = 0.05, 1000.0
        for _ in range(60):
            mid = (a + b) * 0.5
            if extent(mid) > fill:
                a = mid
            else:
                b = mid
        distance = b
    ob = bpy.data.objects.new('cam', cd)
    ob[STUDIO_TAG] = True
    link(ob)
    ob.location = c + d * distance
    ob.rotation_euler = (c - ob.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def render(path, res=(1280, 720), samples=48, denoise=True, exposure=0.0, look='AgX - Medium High Contrast'):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 2
    sc.cycles.use_denoising = denoise
    if denoise:
        try:
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except TypeError:
            pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = look
    except TypeError:
        pass
    sc.view_settings.exposure = exposure
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with timed(f'render.{os.path.basename(path)}'):
        with quiet():
            bpy.ops.render.render(write_still=True)
    return path
