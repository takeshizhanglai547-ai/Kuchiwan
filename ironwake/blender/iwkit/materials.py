"""iwkit.materials - semantic material presets, bake-pass shaders and the final
glTF-mappable atlas material.

Modelling uses SEMANTIC materials (one bpy material per preset name). Baking swaps
them for per-pass emission shaders that write data (albedo, metal/rough, masks...)
into a shared per-asset atlas. After compositing, every part gets ONE atlas material
(`M_<asset>`; emissive parts get `M_<asset>_glow` sharing the same textures) whose node
layout the Blender glTF exporter maps 1:1 onto glTF PBR:
    baseColorTexture (sRGB), metallicRoughnessTexture + occlusionTexture (one ORM image:
    R=AO G=rough B=metal), normalTexture (tangent, OpenGL +Y), emissiveTexture
    (+ KHR_materials_emissive_strength).
"""
import math

import bpy

# ----------------------------------------------------------------------------- colour


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h, alpha=1.0):
    """'#3E4449' -> linear RGBA tuple."""
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b), alpha)


# ----------------------------------------------------------------------------- presets
# color: sRGB hex. metal/rough: PBR. wear: paint that chips to bare metal at edges (0..1).
# grime: cavity soot multiplier. rust: streak/rust multiplier. dust: ash on upward faces.
# emit: emissive colour + strength (HDR; bloom in engine). pattern: procedural albedo pattern.
# var: per-island/mottle colour variation amount. decals: receives projected decals.
PRESETS = {
    'paint_primary':   dict(color='#3E4449', metal=0.0, rough=0.58, wear=1.0, grime=1.0, rust=1.0, dust=1.0, var=0.06, decals=True),
    'paint_secondary': dict(color='#C9C2B4', metal=0.0, rough=0.62, wear=1.0, grime=1.1, rust=1.0, dust=0.8, var=0.05, decals=True),
    'paint_accent':    dict(color='#E8641E', metal=0.0, rough=0.48, wear=1.0, grime=0.9, rust=0.8, dust=0.8, var=0.05, decals=True),
    'paint_dark':      dict(color='#24272A', metal=0.0, rough=0.6, wear=0.8, grime=0.8, rust=0.8, dust=1.0, var=0.05, decals=True),
    'hazard':          dict(color='#D8A31A', color2='#1A1A1A', metal=0.0, rough=0.55, wear=1.0, grime=1.0, rust=1.0, dust=0.8, var=0.05,
                            pattern='hazard', stripe=0.11, decals=False),
    'steel':           dict(color='#8E9296', metal=1.0, rough=0.36, wear=0.0, grime=0.9, rust=0.5, dust=0.6, var=0.04, decals=False),
    'steel_dark':      dict(color='#35383A', metal=0.9, rough=0.4, wear=0.0, grime=0.8, rust=0.4, dust=0.6, var=0.04, decals=False),
    'chrome':          dict(color='#D9DBDD', metal=1.0, rough=0.1, wear=0.0, grime=0.25, rust=0.0, dust=0.15, var=0.0, decals=False),
    'rubber':          dict(color='#1B1B1C', metal=0.0, rough=0.82, wear=0.0, grime=0.5, rust=0.0, dust=0.7, var=0.03, decals=False),
    'nozzle_inner':    dict(color='#3A302A', metal=0.8, rough=0.42, wear=0.0, grime=0.4, rust=0.0, dust=0.0, var=0.06, pattern='heat', decals=False),
    'glow':            dict(color='#1A1410', metal=0.0, rough=0.4, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                            emit='#FFB04A', emit_strength=8.0, decals=False),
    'lens':            dict(color='#081014', metal=0.0, rough=0.06, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0,
                            emit='#8FF0FF', emit_strength=5.0, decals=False),
    'concrete':        dict(color='#7D7870', metal=0.0, rough=0.9, wear=0.0, grime=1.3, rust=0.6, dust=1.2, var=0.1, pattern='concrete', decals=True),
    'rust':            dict(color='#6B3A22', metal=0.35, rough=0.82, wear=0.0, grime=1.0, rust=1.5, dust=1.0, var=0.12, pattern='rust', decals=False),
    'galvanized':      dict(color='#8E9296', metal=0.9, rough=0.5, wear=0.0, grime=1.0, rust=0.8, dust=1.0, var=0.08, pattern='galv', decals=False),
    'collider':        dict(color='#FF00FF', metal=0.0, rough=1.0, wear=0.0, grime=0.0, rust=0.0, dust=0.0, var=0.0, decals=False),
}

# Paint schemes from docs/AC6_BENCHMARK.md s5 (original IRONWAKE palette)
SCHEMES = {
    'player': {'paint_primary': '#3E4449', 'paint_secondary': '#C9C2B4', 'paint_accent': '#E8641E', 'lens': '#8FF0FF'},
    'grauwerk': {'paint_primary': '#5C2E24', 'paint_secondary': '#BDB39A', 'paint_accent': '#D8A31A', 'lens': '#FF2A2A'},
}


def resolve_presets(overrides=None, scheme=None):
    """Copy of PRESETS with a colour scheme and per-asset overrides applied.
    overrides: {'paint_primary': '#hex'} or {'paint_primary': {...preset keys...}}"""
    out = {k: dict(v) for k, v in PRESETS.items()}
    ov = {}
    if scheme:
        ov.update(SCHEMES[scheme] if isinstance(scheme, str) else scheme)
    ov.update(overrides or {})
    for k, v in ov.items():
        if k not in out:
            out[k] = dict(PRESETS['paint_primary'])
        if isinstance(v, str):
            if 'emit' in out[k] and k in ('lens', 'glow'):
                out[k]['emit'] = v
            else:
                out[k]['color'] = v
        else:
            out[k].update(v)
    return out


# ----------------------------------------------------------------------------- node helpers
class NB:
    """Tiny node-tree builder."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 180
        for k, v in props.items():
            if k.startswith('in_'):
                key = k[3:]
                sock = node.inputs[key] if not key.isdigit() else node.inputs[int(key)]
                sock.default_value = v
            else:
                setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)
        return b

    def math(self, op, a, b=None, clamp=False):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n('ShaderNodeVectorMath', operation=op)
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else m.outputs['Vector']

    def mix(self, fac, a, b):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        self._in(m.inputs['Factor'], fac)
        self._in(m.inputs[6], a)
        self._in(m.inputs[7], b)
        return m.outputs[2]

    def combine(self, r, g, b):
        c = self.n('ShaderNodeCombineColor')
        for i, v in enumerate((r, g, b)):
            self._in(c.inputs[i], v)
        return c.outputs[0]

    def _in(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            if sock.type in ('RGBA',) and isinstance(v, (int, float)):
                v = (v, v, v, 1.0)
            elif sock.type == 'VECTOR' and isinstance(v, (int, float)):
                v = (v, v, v)
            elif sock.type == 'VECTOR' and len(v) == 4:
                v = tuple(v[:3])
            elif sock.type == 'RGBA' and len(v) == 3:
                v = (*v, 1.0)
            sock.default_value = v

    def emit_out(self, color, image=None):
        em = self.n('ShaderNodeEmission', in_Strength=1.0)
        self._in(em.inputs['Color'], color)
        out = self.n('ShaderNodeOutputMaterial', target='CYCLES')
        self.link(em.outputs[0], out.inputs['Surface'])
        if image is not None:
            self.bake_target(image)
        return out

    def bake_target(self, image):
        t = self.n('ShaderNodeTexImage', image=image)
        self.nt.nodes.active = t
        t.select = True
        return t

    def geometry(self):
        return self.n('ShaderNodeNewGeometry')

    def noise(self, vec, scale=1.0, detail=4.0, rough=0.55, w=0.0, lac=2.0, ntype='FBM'):
        nz = self.n('ShaderNodeTexNoise', noise_dimensions='4D', in_Scale=scale, in_Detail=detail,
                    in_Roughness=rough, in_W=w, in_Lacunarity=lac)
        try:
            nz.noise_type = ntype
        except Exception:
            pass
        self._in(nz.inputs['Vector'], vec)
        return nz.outputs['Fac']


# ----------------------------------------------------------------------------- palette
def make_palette(presets):
    """One simple Principled material per semantic preset (for modelling, quick previews
    and as the slot order of every part mesh). Returns list of materials."""
    pal = []
    for name, p in presets.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        b = NB(m)
        bsdf = b.n('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Base Color'].default_value = hexlin(p['color'])
        bsdf.inputs['Metallic'].default_value = p['metal']
        bsdf.inputs['Roughness'].default_value = p['rough']
        if p.get('emit'):
            bsdf.inputs['Emission Color'].default_value = hexlin(p['emit'])
            bsdf.inputs['Emission Strength'].default_value = p.get('emit_strength', 1.0)
        out = b.n('ShaderNodeOutputMaterial')
        b.link(bsdf.outputs[0], out.inputs['Surface'])
        m.diffuse_color = hexlin(p['color'])
        m['iw_preset'] = name
        pal.append(m)
    return pal


# ----------------------------------------------------------------------------- bake shaders
def _decal_chain(b, color, decals):
    """Project decals (box projectors) onto the surface and alpha-over them on `color`."""
    geo = None
    for d in decals:
        tc = b.n('ShaderNodeTexCoord', object=d['empty'])
        sep = b.n('ShaderNodeSeparateXYZ')
        b.link(tc.outputs['Object'], sep.inputs[0])
        u = b.math('MULTIPLY_ADD', sep.outputs[0], 0.5)
        u.node.inputs[2].default_value = 0.5
        v = b.math('MULTIPLY_ADD', sep.outputs[1], 0.5)
        v.node.inputs[2].default_value = 0.5
        cxyz = b.n('ShaderNodeCombineXYZ')
        b.link(u, cxyz.inputs[0])
        b.link(v, cxyz.inputs[1])
        img = b.n('ShaderNodeTexImage', image=d['image'], extension='CLIP', interpolation='Cubic')
        b.link(cxyz.outputs[0], img.inputs['Vector'])
        inside = b.math('LESS_THAN', b.math('ABSOLUTE', sep.outputs[2]), 1.0)
        if geo is None:
            geo = b.geometry()
        facing = b.vmath('DOT_PRODUCT', geo.outputs['Normal'], tuple(d['axis']))
        facing = b.math('SUBTRACT', facing, d.get('facing', 0.35))
        facing = b.math('MULTIPLY', facing, 8.0, clamp=True)
        a = b.math('MULTIPLY', img.outputs['Alpha'], inside)
        a = b.math('MULTIPLY', a, facing)
        a = b.math('MULTIPLY', a, d.get('opacity', 1.0))
        color = b.mix(a, color, img.outputs['Color'])
    return color


def _variation(b, color, p, seed):
    var = p.get('var', 0.0)
    if var <= 0:
        return color
    geo = b.geometry()
    rnd = b.math('SUBTRACT', geo.outputs['Random Per Island'], 0.5)
    f1 = b.math('MULTIPLY_ADD', rnd, var * 1.2)
    f1.node.inputs[2].default_value = 1.0
    pos = geo.outputs['Position']
    mot = b.noise(pos, 0.9, 3.0, 0.5, w=seed * 0.37 + 1.3)
    f2 = b.math('MULTIPLY_ADD', b.math('SUBTRACT', mot, 0.5), var * 2.0)
    f2.node.inputs[2].default_value = 1.0
    f = b.math('MULTIPLY', f1, f2)
    return _scale_color(b, color, f)


def _scale_color(b, color, f):
    m = b.n('ShaderNodeVectorMath', operation='SCALE')
    b._in(m.inputs[0], color)
    b._in(m.inputs['Scale'], f)
    return m.outputs['Vector']


def albedo_shader(mat, p, image, seed, decals):
    b = NB(mat)
    base = hexlin(p['color'])
    color = base
    pat = p.get('pattern')
    geo = b.geometry()
    pos = geo.outputs['Position']
    if pat == 'hazard':
        sep = b.n('ShaderNodeSeparateXYZ')
        b.link(pos, sep.inputs[0])
        s = b.math('ADD', b.math('ADD', sep.outputs[0], sep.outputs[1]), sep.outputs[2])
        s = b.math('FRACT', b.math('DIVIDE', s, p.get('stripe', 0.11) * 2.0))
        stripe = b.math('LESS_THAN', s, 0.5)
        color = b.mix(stripe, hexlin(p.get('color2', '#1A1A1A')), base)
    elif pat == 'heat':
        # heat tint bands (straw -> brown -> blue/purple) along local height
        n = b.noise(pos, 3.0, 2.0, 0.5, w=seed + 3.0)
        ramp = b.n('ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.elements[0].position = 0.0
        cr.elements[0].color = hexlin('#2A2320')
        cr.elements[1].position = 1.0
        cr.elements[1].color = hexlin('#3B3350')
        e = cr.elements.new(0.45)
        e.color = hexlin('#5A4632')
        b.link(n, ramp.inputs[0])
        color = ramp.outputs[0]
    elif pat in ('concrete', 'rust', 'galv'):
        n1 = b.math('SUBTRACT', b.noise(pos, 2.5, 6.0, 0.6, w=seed + 7.0), 0.5)
        n2 = b.math('SUBTRACT', b.noise(pos, 0.35, 3.0, 0.5, w=seed + 11.0), 0.5)
        f = b.math('ADD', b.math('MULTIPLY', n1, 0.5), b.math('MULTIPLY', n2, 0.4))
        color = _scale_color(b, base, b.math('ADD', f, 1.0))
    color = _variation(b, color, p, seed)
    if p.get('decals') and decals:
        color = _decal_chain(b, color, decals)
    b.emit_out(color, image)


def params_shader(mat, p, image, seed, decals):
    """R=metallic G=roughness B=paint wear susceptibility."""
    b = NB(mat)
    rough = p['rough']
    geo = b.geometry()
    n = b.noise(geo.outputs['Position'], 4.0, 4.0, 0.55, w=seed + 5.0)
    r = b.math('MULTIPLY_ADD', b.math('SUBTRACT', n, 0.5), 0.12)
    r.node.inputs[2].default_value = rough
    b.emit_out(b.combine(p['metal'], r, p['wear']), image)


def params2_shader(mat, p, image, seed, decals):
    """R=grime multiplier G=rust/streak multiplier B=dust multiplier (scaled by 0.5)."""
    b = NB(mat)
    b.emit_out(b.combine(p['grime'] * 0.5, p['rust'] * 0.5, p['dust'] * 0.5), image)


def emit_shader(mat, p, image, seed, decals, max_strength=8.0):
    b = NB(mat)
    if p.get('emit'):
        c = hexlin(p['emit'])
        k = p.get('emit_strength', 1.0) / max_strength
        b.emit_out((c[0] * k, c[1] * k, c[2] * k, 1.0), image)
    else:
        b.emit_out((0.0, 0.0, 0.0, 1.0), image)


def matid_shader(mat, p, image, seed, decals, index=0):
    """R = palette index / 255 (bake with 1 sample: no anti-aliasing blends ids). The
    compositor looks every per-material constant (metal, rough, wear, grime, rust, dust,
    emission) up from this one pass instead of baking each as its own pass."""
    b = NB(mat)
    b.emit_out((index / 255.0, 0.0, 0.0, 1.0), image)


def masks_shader(mat, p, image, seed, decals, edge=0.02, cavity=0.06, thin=0.08, samples=8):
    """R = convexity: AO 'inside' at a small radius (rays cast into the solid hit the
        neighbouring face near convex edges) -> edge mask, per pixel, works on any mesh.
    G = cavity: small-radius outside AO (crevices, seams, contact lines).
    B = thinness: AO 'inside' at a larger radius; ~1 on thin parts (fins, bolt heads,
        slats) so the compositor can keep them from reading as 'all edge'."""
    b = NB(mat)
    ao_in = b.n('ShaderNodeAmbientOcclusion', inside=True, only_local=True, samples=samples, in_Distance=edge)
    ao_cav = b.n('ShaderNodeAmbientOcclusion', inside=False, only_local=False, samples=samples, in_Distance=cavity)
    ao_th = b.n('ShaderNodeAmbientOcclusion', inside=True, only_local=True, samples=samples, in_Distance=thin)
    convex = b.math('SUBTRACT', 1.0, ao_in.outputs['AO'])
    cav = b.math('SUBTRACT', 1.0, ao_cav.outputs['AO'])
    th = b.math('SUBTRACT', 1.0, ao_th.outputs['AO'])
    b.emit_out(b.combine(convex, cav, th), image)


def ao_shader(mat, p, image, seed, decals, ao_dist=0.6, samples=16):
    """R = ambient occlusion (large radius, other parts included), G/B = copies."""
    b = NB(mat)
    ao = b.n('ShaderNodeAmbientOcclusion', inside=False, only_local=False, samples=samples, in_Distance=ao_dist)
    b.emit_out(b.combine(ao.outputs['AO'], ao.outputs['AO'], ao.outputs['AO']), image)


def noise_shader(mat, p, image, seed, decals, scale=1.0):
    """R=grime fbm  G=vertical streaks  B=high-frequency chip noise (world space)."""
    b = NB(mat)
    geo = b.geometry()
    pos = geo.outputs['Position']
    s = 1.0 / max(scale, 1e-3)
    g1 = b.noise(pos, 1.3 * s, 6.0, 0.62, w=seed + 0.5)
    stretched = b.vmath('MULTIPLY', pos, (3.2 * s, 3.2 * s, 0.22 * s))
    g2 = b.noise(stretched, 1.0, 4.0, 0.6, w=seed + 2.5)
    g3 = b.noise(pos, 9.0 * s, 8.0, 0.68, w=seed + 4.5, lac=2.3)
    b.emit_out(b.combine(g1, g2, g3), image)


def wnormal_shader(mat, p, image, seed, decals):
    b = NB(mat)
    geo = b.geometry()
    v = b.vmath('MULTIPLY_ADD', geo.outputs['Normal'], (0.5, 0.5, 0.5))
    v.node.inputs[2].default_value = (0.5, 0.5, 0.5)
    b.emit_out(v, image)


def normal_shader(mat, p, image, seed, decals, radius=0.012, samples=8):
    """Principled BSDF whose normal is a Bevel node: bakes rounded micro-bevels onto
    every remaining hard edge (panel grooves, greebles) into the tangent normal map."""
    b = NB(mat)
    bev = b.n('ShaderNodeBevel', samples=samples, in_Radius=radius)
    bsdf = b.n('ShaderNodeBsdfPrincipled')
    b.link(bev.outputs['Normal'], bsdf.inputs['Normal'])
    out = b.n('ShaderNodeOutputMaterial', target='CYCLES')
    b.link(bsdf.outputs[0], out.inputs['Surface'])
    b.bake_target(image)


def wpos_shader(mat, p, image, seed, decals, lo=(-1, -1, -1), hi=(1, 1, 1)):
    """World position normalised to the asset bounds (0..1 per axis): drives macro
    gradients (ground dirt toward the bottom, sun-fade toward the top)."""
    b = NB(mat)
    geo = b.geometry()
    size = tuple(max(h - l, 1e-4) for l, h in zip(lo, hi))
    v = b.vmath('SUBTRACT', geo.outputs['Position'], tuple(lo))
    v = b.vmath('DIVIDE', v, size)
    b.emit_out(v, image)


PASS_SHADERS = {
    'matid': matid_shader,
    'wpos': wpos_shader,
    'albedo': albedo_shader,
    'params': params_shader,
    'params2': params2_shader,
    'emit': emit_shader,
    'masks': masks_shader,
    'ao': ao_shader,
    'noise': noise_shader,
    'wnormal': wnormal_shader,
    'normal': normal_shader,
}


# ----------------------------------------------------------------------------- final material
def gltf_output_group():
    """The 'glTF Material Output' node group the Blender glTF exporter reads the
    occlusion input from."""
    name = 'glTF Material Output'
    ng = bpy.data.node_groups.get(name)
    if ng is None:
        ng = bpy.data.node_groups.new(name, 'ShaderNodeTree')
        ng.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
    return ng


def atlas_material(name, base_img, orm_img, normal_img, emit_img=None, emit_strength=0.0,
                   normal_strength=1.0):
    """Final PBR material (exporter-friendly layout)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = NB(m)
    uv = b.n('ShaderNodeUVMap', uv_map='UVMap')
    bsdf = b.n('ShaderNodeBsdfPrincipled')
    tb = b.n('ShaderNodeTexImage', image=base_img)
    b.link(uv.outputs[0], tb.inputs['Vector'])
    b.link(tb.outputs['Color'], bsdf.inputs['Base Color'])
    to = b.n('ShaderNodeTexImage', image=orm_img)
    b.link(uv.outputs[0], to.inputs['Vector'])
    sep = b.n('ShaderNodeSeparateColor')
    b.link(to.outputs['Color'], sep.inputs[0])
    b.link(sep.outputs[1], bsdf.inputs['Roughness'])
    b.link(sep.outputs[2], bsdf.inputs['Metallic'])
    grp = b.n('ShaderNodeGroup')
    grp.node_tree = gltf_output_group()
    b.link(sep.outputs[0], grp.inputs['Occlusion'])
    tn = b.n('ShaderNodeTexImage', image=normal_img)
    b.link(uv.outputs[0], tn.inputs['Vector'])
    nm = b.n('ShaderNodeNormalMap', space='TANGENT', uv_map='UVMap', in_Strength=normal_strength)
    b.link(tn.outputs['Color'], nm.inputs['Color'])
    b.link(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit_img is not None and emit_strength > 0:
        te = b.n('ShaderNodeTexImage', image=emit_img)
        b.link(uv.outputs[0], te.inputs['Vector'])
        b.link(te.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    else:
        bsdf.inputs['Emission Strength'].default_value = 0.0
    out = b.n('ShaderNodeOutputMaterial')
    b.link(bsdf.outputs[0], out.inputs['Surface'])
    return m
