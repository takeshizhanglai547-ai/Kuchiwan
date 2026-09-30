"""iwkit.geo - `Geo`, a thin bmesh wrapper used by every hard-surface primitive.

A Geo is a bag of faces with *semantic material names* (face.material_index indexes
geo.mats). Primitives return Geos; you transform/merge them and finally turn a Geo
into a mesh object with `Asset.part(...)` (or `Geo.to_object`).

Coordinate conventions (Blender): +Z up, the asset's FRONT faces -Y (glTF exporter
turns that into +Z forward / +Y up for three.js). Units are metres.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import link, look_rotation, to_matrix

BMVert = bmesh.types.BMVert
BMEdge = bmesh.types.BMEdge
BMFace = bmesh.types.BMFace


class Geo:
    def __init__(self, mats=None):
        self.bm = bmesh.new()
        self.mats = list(mats) if mats else []

    # ------------------------------------------------------------------ materials
    def mi(self, name):
        """Index of semantic material `name` in this geo (added if missing)."""
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def set_mat(self, name, faces=None):
        i = self.mi(name)
        for f in (self.bm.faces if faces is None else faces):
            f.material_index = i
        return self

    def mat_of(self, f):
        return self.mats[f.material_index] if f.material_index < len(self.mats) else None

    def faces_with_mat(self, name):
        if name not in self.mats:
            return []
        i = self.mats.index(name)
        return [f for f in self.bm.faces if f.material_index == i]

    # ------------------------------------------------------------------ construction
    @classmethod
    def from_pydata(cls, verts, faces, mat='paint_primary'):
        g = cls()
        vs = [g.bm.verts.new(Vector(v)) for v in verts]
        idx = g.mi(mat)
        for f in faces:
            try:
                nf = g.bm.faces.new([vs[i] for i in f])
                nf.material_index = idx
            except ValueError:
                pass
        g.bm.normal_update()
        return g

    def copy(self):
        g = Geo(self.mats)
        g.bm.free()
        g.bm = self.bm.copy()
        return g

    def free(self):
        self.bm.free()

    @property
    def nfaces(self):
        return len(self.bm.faces)

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    # ------------------------------------------------------------------ transforms
    def transform(self, M):
        M = M if len(M) == 4 else M.to_4x4()
        bmesh.ops.transform(self.bm, matrix=M, verts=list(self.bm.verts))
        if M.to_3x3().determinant() < 0:
            bmesh.ops.reverse_faces(self.bm, faces=list(self.bm.faces))
        self.bm.normal_update()
        return self

    def place(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        """Scale, then rotate (Euler XYZ degrees), then translate."""
        return self.transform(to_matrix(loc, rot, scale))

    def move(self, *v):
        v = Vector(v[0] if len(v) == 1 else v)
        bmesh.ops.translate(self.bm, vec=v, verts=list(self.bm.verts))
        return self

    def rotate(self, rot):
        return self.transform(to_matrix((0, 0, 0), rot))

    def scale(self, s):
        return self.transform(to_matrix((0, 0, 0), (0, 0, 0), s))

    def align(self, forward, up=(0, 0, 1), loc=(0, 0, 0)):
        """Primitives are authored along +Z; rotate +Z onto `forward`, then move to loc."""
        R = look_rotation(forward, up).to_4x4()
        return self.transform(Matrix.Translation(Vector(loc)) @ R)

    def mirror(self, axis='X', about=0.0):
        s = [1, 1, 1]
        i = 'XYZ'.index(axis)
        s[i] = -1
        off = [0, 0, 0]
        off[i] = 2 * about
        return self.transform(Matrix.Translation(Vector(off)) @ Matrix.Diagonal((*s, 1)))

    def bounds(self):
        xs = [v.co for v in self.bm.verts]
        lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
        hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
        return lo, hi

    # ------------------------------------------------------------------ merge
    def merge(self, *others, M=None):
        """Append the faces of other Geos (optionally transformed by M). Returns self."""
        for other in others:
            if other is None:
                continue
            remap = [self.mi(n) for n in other.mats] or [0]
            bm = self.bm
            ob = other.bm
            ob.verts.index_update()
            nv = [None] * len(ob.verts)
            flip = M is not None and M.to_3x3().determinant() < 0
            new_faces = []
            for f in ob.faces:
                vs = []
                for v in f.verts:
                    k = v.index
                    if nv[k] is None:
                        nv[k] = bm.verts.new(M @ v.co if M is not None else v.co)
                    vs.append(nv[k])
                try:
                    nf = bm.faces.new(vs)
                except ValueError:
                    continue
                mi = f.material_index
                nf.material_index = remap[mi] if mi < len(remap) else remap[0]
                nf.smooth = f.smooth
                new_faces.append(nf)
            for e in ob.edges:
                if not e.smooth:
                    a, b = nv[e.verts[0].index], nv[e.verts[1].index]
                    if a is not None and b is not None:
                        ne = bm.edges.get((a, b))
                        if ne is not None:
                            ne.smooth = False
            if flip and new_faces:
                bmesh.ops.reverse_faces(bm, faces=new_faces)
        self.bm.normal_update()
        return self

    def __iadd__(self, other):
        return self.merge(other)

    def fix_normals(self):
        """Recalculate outward normals (closed meshes)."""
        bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        self.bm.normal_update()
        return self

    def islands(self):
        """List of face-index lists, one per connected island."""
        bm = self.bm
        bm.faces.ensure_lookup_table()
        seen = [False] * len(bm.faces)
        out = []
        for f in bm.faces:
            if seen[f.index]:
                continue
            stack = [f]
            seen[f.index] = True
            isl = []
            while stack:
                x = stack.pop()
                isl.append(x.index)
                for e in x.edges:
                    for y in e.link_faces:
                        if not seen[y.index]:
                            seen[y.index] = True
                            stack.append(y)
            out.append(isl)
        return out

    def cull_inside(self, eps=0.002, min_area=0.0):
        """Delete faces buried inside OTHER closed islands (embedded cylinder caps, bolt
        washers sitting on plates...). They can never be seen, but would waste triangles
        and atlas space. A face is removed when all its sample points, pushed `eps` along
        the face normal, are inside some other island. Inside = odd ray-crossing parity
        against that island alone (per-island BVH, so coincident faces of different
        islands cannot confuse the count) for two ray directions."""
        from mathutils.bvhtree import BVHTree
        self.canonicalize()
        bm = self.bm
        bm.faces.ensure_lookup_table()
        isl = self.islands()
        if len(isl) < 2:
            return 0
        owner = [0] * len(bm.faces)
        boxes = []
        for k, fl in enumerate(isl):
            lo = Vector((1e9, 1e9, 1e9))
            hi = Vector((-1e9, -1e9, -1e9))
            for i in fl:
                owner[i] = k
                for v in bm.faces[i].verts:
                    lo = Vector(map(min, lo, v.co))
                    hi = Vector(map(max, hi, v.co))
            boxes.append((lo, hi))
        trees = {}

        def tree(k):
            t = trees.get(k)
            if t is None:
                vmap = {}
                verts = []
                polys = []
                for i in isl[k]:
                    poly = []
                    for v in bm.faces[i].verts:
                        j = vmap.get(v.index)
                        if j is None:
                            j = vmap[v.index] = len(verts)
                            verts.append(v.co.copy())
                        poly.append(j)
                    polys.append(poly)
                t = trees[k] = BVHTree.FromPolygons(verts, polys, all_triangles=False)
            return t
        dirs = (Vector((0.5773, 0.5779, 0.5769)).normalized(), Vector((-0.4127, 0.8163, -0.4043)).normalized())

        def inside(p, k):
            t = tree(k)
            for d in dirs:
                par = 0
                q = p.copy()
                for _ in range(64):
                    hit = t.ray_cast(q, d)
                    if hit[0] is None:
                        break
                    par ^= 1
                    q = hit[0] + d * 1e-6
                if not par:
                    return False
            return True

        def inside_any(p, own):
            for k, (lo, hi) in enumerate(boxes):
                if k == own:
                    continue
                if lo.x <= p.x <= hi.x and lo.y <= p.y <= hi.y and lo.z <= p.z <= hi.z and inside(p, k):
                    return True
            return False
        kill = []
        for f in bm.faces:
            if min_area and f.calc_area() < min_area:
                continue
            c = f.calc_center_median()
            n = f.normal
            own = owner[f.index]
            pts = [c] + [v.co.lerp(c, 0.25) for v in f.verts]
            if all(inside_any(p + n * eps, own) for p in pts):
                kill.append(f)
        if kill:
            bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.normal_update()
        return len(kill)

    # ------------------------------------------------------------------ selection helpers
    def faces_facing(self, direction, max_angle=12.0, min_area=0.0, where=None, mat=None):
        """Faces whose normal is within max_angle degrees of `direction`."""
        self.bm.normal_update()
        d = Vector(direction).normalized()
        c = math.cos(math.radians(max_angle))
        mi = self.mats.index(mat) if (mat is not None and mat in self.mats) else None
        out = []
        for f in self.bm.faces:
            if f.normal.dot(d) < c:
                continue
            if mi is not None and f.material_index != mi:
                continue
            if min_area and f.calc_area() < min_area:
                continue
            if where is not None and not where(f):
                continue
            out.append(f)
        return out

    def largest_face(self, direction, max_angle=12.0, where=None):
        fs = self.faces_facing(direction, max_angle, where=where)
        return max(fs, key=lambda f: f.calc_area()) if fs else None

    def hard_edges(self, min_angle=25.0, where=None):
        a = math.radians(min_angle)
        out = []
        for e in self.bm.edges:
            if len(e.link_faces) != 2:
                continue
            if e.calc_face_angle(0.0) < a:
                continue
            if where is not None and not where(e):
                continue
            out.append(e)
        return out

    def edges_parallel(self, axis, tol_deg=10.0, min_angle=25.0):
        ax = Vector(axis).normalized()
        c = math.cos(math.radians(tol_deg))

        def ok(e):
            d = e.verts[1].co - e.verts[0].co
            return d.length > 1e-9 and abs(d.normalized().dot(ax)) >= c
        return self.hard_edges(min_angle, ok)

    def face_frame(self, face, u_axis=None):
        """(origin, u, v, n, outline2d) of a planar face: u/v span the face (u follows
        u_axis projected into the plane, else the longest edge), outline2d are the face
        corners in (u, v) coordinates, counter-clockwise seen from the front."""
        n = face.normal.copy()
        if u_axis is not None:
            u = Vector(u_axis)
        else:
            e = max(face.edges, key=lambda e: e.calc_length())
            u = e.verts[1].co - e.verts[0].co
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u).normalized()
        o = face.calc_center_median()
        pts = [((x.co - o).dot(u), (x.co - o).dot(v)) for x in face.verts]
        return o, u, v, n, pts

    # ------------------------------------------------------------------ bevel family
    def bevel(self, width, segments=3, edges=None, min_angle=25.0, profile=0.5, clamp=True):
        """Bevel hard edges (default: every edge sharper than min_angle degrees)."""
        if width <= 0:
            return self
        if edges is None:
            edges = self.hard_edges(min_angle)
        edges = [e for e in edges if e.is_valid]
        if not edges:
            return self
        bmesh.ops.bevel(self.bm, geom=edges, offset=width, offset_type='OFFSET',
                        segments=max(1, int(segments)), profile=profile, affect='EDGES',
                        clamp_overlap=clamp, loop_slide=True, miter_outer='SHARP',
                        miter_inner='SHARP', vmesh_method='ADJ')
        bmesh.ops.dissolve_degenerate(self.bm, dist=1e-6, edges=list(self.bm.edges))
        self.bm.normal_update()
        return self

    def chamfer(self, width, edges=None, min_angle=25.0):
        """Single-segment flat chamfer (the big angular cuts of industrial armour)."""
        return self.bevel(width, 1, edges, min_angle, profile=0.5)

    # ------------------------------------------------------------------ panel ops
    def _region(self, faces):
        # ordered de-duplication (sets of BMesh elements iterate in memory-address order,
        # which would make results differ from run to run)
        faces = list(dict.fromkeys(f for f in faces if f.is_valid))
        edges = list(dict.fromkeys(e for f in faces for e in f.edges))
        verts = list(dict.fromkeys(v for f in faces for v in f.verts))
        return faces, edges, verts

    def _push(self, faces, depth):
        """Extrude a face region along its (per-vertex averaged) normal by depth
        (negative = into the surface). Returns the new cap faces."""
        faces = [f for f in faces if f.is_valid]
        if not faces:
            return []
        ex = bmesh.ops.extrude_face_region(self.bm, geom=faces)
        caps = [g for g in ex['geom'] if isinstance(g, BMFace)]
        nverts = [g for g in ex['geom'] if isinstance(g, BMVert)]
        # map new verts to the old vert normals via position
        for v in nverts:
            n = Vector()
            for f in v.link_faces:
                if f in caps:
                    n += f.normal
            if n.length < 1e-9:
                continue
            v.co += n.normalized() * depth
        bmesh.ops.delete(self.bm, geom=[f for f in faces if f.is_valid], context='FACES')
        self.bm.normal_update()
        return caps

    def inset(self, faces, thickness, depth=0.0, individual=False):
        """Inset faces. Returns (inner_faces, rim_faces)."""
        faces = [f for f in faces if f.is_valid]
        if not faces:
            return [], []
        if individual:
            r = bmesh.ops.inset_individual(self.bm, faces=faces, thickness=thickness, depth=depth,
                                           use_even_offset=True)
        else:
            r = bmesh.ops.inset_region(self.bm, faces=faces, thickness=thickness, depth=depth,
                                       use_even_offset=True, use_boundary=True)
        self.bm.normal_update()
        return faces, r['faces']

    def recess(self, faces, margin, depth, floor_mat=None, wall_mat=None):
        """Inset by margin, then push the inner faces into the surface by depth.
        Returns the floor faces (e.g. to put a vent/grille in)."""
        inner, _ = self.inset(faces, margin)
        before = set(self.bm.faces)
        floor = self._push(inner, -abs(depth))
        walls = [f for f in self.bm.faces if f not in before and f not in floor]
        if floor_mat:
            self.set_mat(floor_mat, floor)
        if wall_mat:
            self.set_mat(wall_mat, walls)
        return floor

    def raise_panel(self, faces, margin, height, mat=None, bevel=0.0):
        """Inset then extrude outward -> a raised armour plate on a face."""
        inner, _ = self.inset(faces, margin)
        caps = self._push(inner, abs(height))
        if mat:
            self.set_mat(mat, caps)
        return caps

    def groove_loop(self, faces, margin, gap=0.012, depth=0.012, mat=None):
        """A closed panel-line groove running `margin` inside the outline of `faces`."""
        inner, _ = self.inset(faces, margin)
        inner, rim = self.inset(inner, gap)
        before = set(self.bm.faces)
        caps = self._push(rim, -abs(depth))
        if mat:
            new = [f for f in self.bm.faces if f not in before]
            self.set_mat(mat, new)
        return inner

    def groove_cut(self, faces, co, no, gap=0.012, depth=0.012):
        """Cut a straight panel-line groove across `faces` along the plane (co, no).
        The groove runs edge to edge across the face region (typical armour seam).
        Returns the faces of the region after the cut (useful for chaining cuts)."""
        faces, edges, verts = self._region(faces)
        if not faces:
            return []
        region_before = list(faces)
        r = bmesh.ops.bisect_plane(self.bm, geom=faces + edges + verts, dist=1e-6,
                                   plane_co=Vector(co), plane_no=Vector(no).normalized(),
                                   use_snap_center=False, clear_outer=False, clear_inner=False)
        cut = [e for e in r['geom_cut'] if isinstance(e, BMEdge) and len(e.link_faces) == 2]
        if not cut:
            return [f for f in faces if f.is_valid]
        # region = faces touching the cut + original survivors
        all_faces = dict.fromkeys(f for f in region_before if f.is_valid)
        for e in cut:
            all_faces.update(dict.fromkeys(e.link_faces))
        br = bmesh.ops.bevel(self.bm, geom=cut, offset=gap * 0.5, offset_type='OFFSET', segments=1,
                             profile=0.5, affect='EDGES', clamp_overlap=True, loop_slide=True)
        strip = br['faces']
        self.bm.normal_update()
        self._push(strip, -abs(depth))
        return [f for f in all_faces if f.is_valid]

    def hatch(self, face, center, size, gap=0.012, depth=0.012, raised=0.0, recess=0.0,
              mat=None, u_axis=None):
        """Rectangular access hatch on a planar face: 4 plane cuts isolate a rectangle,
        then a groove loop (or a raised / recessed plate) is made from it.
        center: world point on the face; size: (w, h) along the face's u/v axes."""
        if face is None or not face.is_valid:
            return None
        n = face.normal.copy()
        u = Vector(u_axis) if u_axis else (face.verts[1].co - face.verts[0].co)
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u).normalized()
        c = Vector(center)
        region = [face]
        for axis, half in ((u, size[0] * 0.5), (v, size[1] * 0.5)):
            for s in (-1, 1):
                faces, edges, verts = self._region(region)
                r = bmesh.ops.bisect_plane(self.bm, geom=faces + edges + verts, dist=1e-6,
                                           plane_co=c + axis * half * s, plane_no=axis,
                                           use_snap_center=False, clear_outer=False, clear_inner=False)
                new_region = dict.fromkeys(f for f in faces if f.is_valid)
                for g in r['geom_cut']:
                    if isinstance(g, BMEdge):
                        new_region.update(dict.fromkeys(g.link_faces))
                region = list(new_region)
        # pick the sub-face whose centre is inside the rectangle
        inside = []
        for f in region:
            if not f.is_valid:
                continue
            fc = f.calc_center_median() - c
            if abs(fc.dot(u)) < size[0] * 0.5 - 1e-4 and abs(fc.dot(v)) < size[1] * 0.5 - 1e-4 \
                    and abs(f.normal.dot(n)) > 0.99:
                inside.append(f)
        if not inside:
            return None
        if raised > 0:
            caps = self.raise_panel(inside, gap, raised, mat=mat)
            return caps
        if recess > 0:
            return self.recess(inside, gap, recess, floor_mat=mat)
        inner, rim = self.inset(inside, gap)
        self._push(rim, -abs(depth))
        if mat:
            self.set_mat(mat, inner)
        return inner

    # ------------------------------------------------------------------ booleans
    def boolean(self, cutter, op='DIFFERENCE', solver='EXACT'):
        """Boolean with another Geo (via a temporary object + modifier). Faces created
        by the cutter keep the cutter's material (e.g. dark steel inside holes)."""
        names = list(self.mats)
        for n in cutter.mats:
            if n not in names:
                names.append(n)
        mats = [bpy.data.materials.get('__bool_' + n) or bpy.data.materials.new('__bool_' + n)
                for n in names]
        objs = []
        for g in (self, cutter):
            me = bpy.data.meshes.new('__bool')
            remap = [names.index(n) for n in g.mats] or [0]
            for f in g.bm.faces:
                f.material_index = remap[f.material_index] if f.material_index < len(remap) else 0
            g.bm.to_mesh(me)
            for m in mats:
                me.materials.append(m)
            ob = bpy.data.objects.new('__bool', me)
            link(ob)
            objs.append(ob)
        tgt, cut = objs
        cut.hide_render = True
        mod = tgt.modifiers.new('bool', 'BOOLEAN')
        mod.operation = op
        mod.solver = solver
        mod.object = cut
        mod.material_mode = 'TRANSFER'
        dg = bpy.context.evaluated_depsgraph_get()
        ev = tgt.evaluated_get(dg)
        me2 = bpy.data.meshes.new_from_object(ev)
        self.bm.free()
        self.bm = bmesh.new()
        self.bm.from_mesh(me2)
        self.mats = names
        # restore cutter geo material indices (it was remapped in place)
        cutter.mats = names
        for ob in objs:
            me = ob.data
            bpy.data.objects.remove(ob)
            bpy.data.meshes.remove(me)
        bpy.data.meshes.remove(me2)
        self.canonicalize()
        return self

    def canonicalize(self):
        """Sort verts/faces by position so results are identical run to run (the EXACT
        boolean solver is multi-threaded and returns elements in varying order)."""
        bm = self.bm
        bm.normal_update()
        def rank(seq, key):
            order = sorted(seq, key=key)
            return {x: i for i, x in enumerate(order)}
        rv = rank(list(bm.verts), lambda v: (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)))
        bm.verts.sort(key=lambda v: rv[v])
        bm.verts.index_update()

        def fkey(f):
            c = f.calc_center_median()
            return (round(c.x, 5), round(c.y, 5), round(c.z, 5), len(f.verts), sorted(v.index for v in f.verts))
        rf = rank(list(bm.faces), fkey)
        bm.faces.sort(key=lambda f: rf[f])
        bm.faces.index_update()
        re_ = rank(list(bm.edges), lambda e: tuple(sorted((e.verts[0].index, e.verts[1].index))))
        bm.edges.sort(key=lambda e: re_[e])
        bm.edges.index_update()
        return self

    # ------------------------------------------------------------------ finalize
    def to_object(self, name, palette, sharp_angle=40.0, weighted=True, col=None,
                  auto_smooth=True):
        """Build a mesh object. palette: ordered list of bpy materials; semantic names
        are matched to material names (unknown -> slot 0).
        Shading: all faces smooth; edges sharper than sharp_angle are marked sharp;
        then a Weighted Normal (face area, keep sharp) pass is applied, which gives the
        classic hard-surface look: flat faces stay flat, bevels catch the light."""
        bm = self.bm
        bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=list(bm.edges))
        bm.normal_update()
        pal_names = [m.name for m in palette]
        remap = [pal_names.index(n) if n in pal_names else 0 for n in self.mats] or [0]
        a = math.radians(sharp_angle)
        for f in bm.faces:
            f.material_index = remap[f.material_index] if f.material_index < len(remap) else 0
            f.smooth = True
        if auto_smooth:
            for e in bm.edges:
                if len(e.link_faces) != 2:
                    e.smooth = False
                elif e.calc_face_angle(0.0) > a:
                    e.smooth = False
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        for m in palette:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        link(ob, col)
        if weighted:
            mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            mod.mode = 'FACE_AREA'
            mod.weight = 50
            mod.keep_sharp = True
            mod.thresh = 0.01
            with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob],
                                           selected_editable_objects=[ob]):
                bpy.ops.object.modifier_apply(modifier=mod.name)
        return ob


def merged(*geos):
    g = Geo()
    g.merge(*[x for x in geos if x is not None])
    return g
