# IRONWAKE Blender pipeline (`blender/iwkit`)

Headless Blender (python3 + `import bpy`, bpy 4.2, CPU only) toolkit for building the
game's hard-surface assets procedurally: mechs, enemies, weapons and arena kit. One
script builds the geometry, packs one UV atlas per asset, bakes and composites PBR
textures with Cycles on the CPU, and exports:

- a **GLB** for the three.js runtime: meshopt-compressed, JPEG textures, node names preserved;
- an **FBX** plus `T_*` textures for a later Unreal Engine import;
- **Cycles look-dev renders** for review.

Everything is deterministic. The same script and seed give byte-identical geometry and UVs.

> Owner: technical artist. Files: `blender/iwkit/*`, `blender/test_asset.py`,
> `blender/tools/*`, `assets/_test/*`, this document. Asset scripts for mechs, enemies and the
> arena live with their owners (`blender/mech/`, `blender/arena/`, ...) and import `iwkit`.

---

## 0. Quick start

```bash
cd ironwake
python3 blender/test_asset.py                 # full proof asset: 2048 atlas, 64 spp previews
python3 blender/test_asset.py --quick         # 1024 atlas, 24 spp previews (fast iteration)
python3 blender/test_asset.py --no-render     # bake + export only
python3 blender/test_asset.py --reuse-bakes   # re-composite from cached bakes (same geometry only)
python3 blender/test_asset.py --debug-mask masks.0,wear   # unlit views of a mask on the model

# check a GLB in the real runtime (three.js GLTFLoader + MeshoptDecoder, headless Chromium)
PATH=/opt/node22/bin:$PATH node blender/tools/glb_check.mjs assets/_test/sample.glb out.png -40 16
```

One-time setup: gltfpack, used for meshopt compression, is vendored as an npm package in
`blender/tools`. Install it with `cd blender/tools && npm install`. If it is missing, GLBs are
still written, just uncompressed (a log line tells you).

A minimal asset script:

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))  # -> blender/
import iwkit as iw
from iwkit import prims as P, decals as D

iw.reset_scene()
a = iw.Asset('crate', seed=3, scheme='player', res=1024)
g = P.box((1.2, 1.2, 1.0), bevel=0.02, chamfer=0.08, chamfer_axes='Z').move(0, 0, 0.5)
top = g.largest_face((0, 0, 1))
g.hatch(top, (0, 0, 1.0), (0.6, 0.5), recess=0.03, mat='steel_dark')
g.merge(P.bolt_row((-0.5, -0.61, 0.9), (0.5, -0.61, 0.9), 6, (0, -1, 0)))
a.part('crate_geo', g)                         # geometry authored in WORLD coordinates
a.collider('crate', size=(1.2, 1.2, 1.0), center=(0, 0, 0.5))
a.decal(D.text_decal('07'), (0, -0.605, 0.5), (0, -1, 0), size=(0.3, None))
a.unwrap()
a.bake()
a.export_glb('assets/arena/crate.glb')
a.export_fbx()                                 # -> assets/ue5/SM_crate.fbx + T_crate_*.png
iw.preview.studio(a.parts); iw.preview.camera(a.parts, azimuth=-35, elevation=15)
iw.preview.render('/tmp/claude-0/crate.png', samples=48)
```

End every script with `os._exit(0)`. In background mode bpy 4.2 sometimes segfaults while
tearing down after everything has been written, and this call skips that teardown.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Units | 1 Blender unit = 1 m. A mech is about 10 m tall. |
| Axes (Blender) | +Z up. The asset's **front faces −Y**, so a mech's **right is −X**. The glTF exporter converts this to three.js +Y up with the front at +Z. |
| Rigid parts | No skinning. Every moving part is a mesh parented under a named **Empty (pivot)**. The engine rotates the pivots. Mesh nodes have an identity local transform. |
| Joint pivots | Placed at the joint, with **identity rest rotation**. `rig.js` animates local X, Y and Z. |
| Names | Pivots use the contract names (§2). Mesh parts are `<pivot>_geo`. Never use `.` in a name: three.js strips it. |
| Materials in scripts | Use **semantic** names (`paint_primary`, `steel_dark`, `glow` ...). After baking, each asset has one atlas material `M_<asset>`, plus `M_<asset>_glow` for emissive faces. |
| Determinism | Use `asset.rng` and `rng.fork('tag')`. Never use Python `hash()` or iterate over `set()`s of BMesh elements. After booleans and before UVs, `Geo.canonicalize()` sorts the elements; `Asset.part()` calls it for you. |

---

## 2. Node-name contract (hook into `src/mech/rig.js`)

The canonical list is `REQUIRED_NODES` in `src/mech/rig.js`. It is mirrored in
`iwkit.MECH_NODES` and `iwkit.MECH_PARENT`.

```
root                               origin between the feet, feet on z=0
└ pelvis
  ├ thigh_L/R > shin_L/R > foot_L/R
  └ torso
     ├ head > eye                  meshes under `eye` glow (intensity animated)
     ├ arm_L/R > forearm_L/R > hand_L/R > weapon_L/R > muzzle_L/R
     ├ shoulder_L/R (back weapon mounts) > muzzle_LB/RB
     ├ booster_back, booster_L, booster_R
     └ nozzle_<group>_<n>          any number, anywhere
```

- `a.pivot(name, location, parent=...)` creates a joint Empty with identity rotation.
  The location is in world space.
- `a.muzzle(name, location, fire=(0,-1,0), parent=...)` makes the node fire along its glTF local +Z
  (Blender local −Y).
- `a.nozzle(name, location, exhaust=(0,1,0), parent=...)` makes glTF local −Z (Blender local +Y)
  point along the exhaust. Put the node at the nozzle **exit centre**. The node also gets the
  extra `iw_fx: 'boost'`.
- Geometry of one rigid part: `a.part('<pivot>_geo', geo, parent='<pivot>')`.
- A GLB exported with `-kn` (gltfpack) keeps every named node. gltfpack may add unnamed child
  nodes (`mesh_N`) that carry the quantised meshes. That is harmless: always address pivots
  by name.
- Enemy GLBs use their own node names (`src/enemies/models.js`), for example mt:
  `hull, turret, barrel, muzzle`. The same `pivot()` / `part()` calls apply.

## 3. Environment conventions (`src/world/arena.js`)

| Node | How with iwkit |
|---|---|
| `COL_<name>` invisible box collider | `a.collider('wall_a', size=(x,y,z), center=(...))`. This builds a mesh whose local bounding box becomes the oriented box collider. For a rotated collider, pass a rotated `geo=` (e.g. `P.collider_box(...).rotate(...)`). COL_ meshes have no material, `hide_render=True`, are never baked and are not rendered in-game. |
| Visible mesh that also collides | Set custom property `iw_collider = 1` on the part object (`ob['iw_collider'] = 1`). |
| No shadow casting | `ob['iw_noshadow'] = 1` |
| `SPAWN_player`, `SPAWN_mt_<n>`, `SPAWN_drone_<n>`, `SPAWN_boss_<n>`, `OBJ_relay_<n>` | `a.marker('SPAWN_player', (x,y,z), yaw_deg)`. Yaw 0 faces Blender −Y, which is glTF +Z. |

Custom properties on objects are exported as glTF `extras` (`export_extras=True`). They show up
in three.js as `object.userData`.

---

## 4. API reference

### 4.1 `iwkit.core`
| Function | Purpose |
|---|---|
| `reset_scene()` | Factory-empty scene, metric, Cycles CPU. |
| `empty(name, location, rotation, parent, col, props)` | Named pivot Empty. Rotation is Euler degrees, a Quaternion or a Matrix. |
| `set_parent(child, parent)` | Parent with an identity parent-inverse, keeping the world transform. |
| `set_props(ob, **kv)` | Custom properties, exported as glTF extras. |
| `RNG(seed)`, `rng.fork(tag)` | Deterministic independent random streams. |
| `timed(label)`, `TIMINGS`, `log()` | Timing and logging. `quiet()` silences Blender's C-level output. |
| `tri_count(objs)`, `world_bbox(objs)`, `look_rotation(fwd, up)` | Helpers. |

### 4.2 `iwkit.geo.Geo` (bmesh wrapper; every primitive returns one)
Faces carry **semantic material names** (`geo.mats`).

| Method | Purpose |
|---|---|
| `place(loc, rot, scale)`, `move()`, `rotate()`, `scale()`, `align(forward, up, loc)`, `mirror(axis)`, `transform(M)` | Transforms. Round primitives are authored along +Z; use `align` to aim them. |
| `merge(*geos, M=None)`, `copy()`, `merged(...)` | Combine geometry, remapping material names. |
| `faces_facing(dir, max_angle, min_area, where, mat)`, `largest_face(dir)`, `hard_edges(min_angle)`, `edges_parallel(axis)` | Selection. |
| `face_frame(face, u_axis)` | `(origin, u, v, n, outline2d)` of a planar face. Use it to lay details onto a surface. |
| `bevel(width, segments=3, edges=None, min_angle=25)`, `chamfer(width)` | Geometric bevels. Only edges sharper than `min_angle` are bevelled. |
| `inset(faces, t)`, `recess(faces, margin, depth, floor_mat, wall_mat)`, `raise_panel(faces, margin, h)` | Panel operations. |
| `groove_cut(faces, co, no, gap, depth)` | A straight panel-line groove across a face region (plane cut, then bevel, then push in). |
| `groove_loop(faces, margin, gap, depth)` | A closed seam loop inside a face. |
| `hatch(face, center, (w,h), gap, depth / recess / raised, mat, u_axis)` | Rectangular access hatch or recess anywhere on a planar face. |
| `boolean(cutter, op='DIFFERENCE')` | EXACT boolean. Cut faces take the cutter's material. |
| `cull_inside()` | Delete faces buried inside other closed islands of the same Geo. This typically removes 30-40% of the faces of a kit-bashed part, and saves atlas space. |
| `canonicalize()` | Deterministic element order. |
| `to_object(name, palette)` | Build the mesh: all faces smooth, edges above 40° sharp, then a **Weighted Normal** pass (face area, keep sharp). Flat faces stay flat and bevels catch the light. |

### 4.3 `iwkit.prims` (hard-surface primitives, all return `Geo`)
Sizes are full extents in metres. `mat=` takes a semantic material name.
**Visible round parts use 32-64 segments. Small bolts use 6-12.**

| Primitive | Notes |
|---|---|
| `box(size, bevel, segs, chamfer, chamfer_axes)` | Bevelled box. `chamfer` gives the big flat industrial cuts (`chamfer_axes='Z'` chamfers only the vertical edges). |
| `frustum(bottom, top, h, shift)` | Tapered box. |
| `prism(outline2d, depth, axis='Y'/'X'/'Z', taper)` | Extruded profile (side silhouettes of receivers, yokes, lugs). Use `fillet()` for rounded or chamfered corners. |
| `loft([(outline, t), ...], axis, corner, corner_segs)` | Tapered armour shells and limb housings from cross-sections. |
| `plate(outline, thickness, inset, ridge, ridge_axis)` | Armour plate with crisp inset edge facets and an optional ridge crease. |
| `armor_on_face(geo, face, margin, thickness, gap, ridge, chamfer, bolts, outline)` | **Layered armour.** A separate plate that follows a face of another Geo, floating `gap` above it, with optional bolts along its long edges. This is the main tool for the "plates over a frame" look. |
| `lathe(profile_rz, segs)`, `cylinder`, `ring`, `cone`, `dome`, `torus` | Round parts. The lathe profile is counter-clockwise in (r, z). |
| `banded_cylinder([(len, r, mat?), ...])` | Stepped or grooved drums: actuator hubs, power cells, sleeves. |
| `sweep(points, r, rib_amp, rib_freq)`, `cable(p0, p1, sag)`, `hose(points)` | Tubes along splines, parallel-transport frames. Hoses are corrugated with crimped fittings. |
| `piston(p0, p1, r_sleeve, r_rod, up)` | Hydraulic ram: barrel, gland, chrome rod, boot, port and clevis eyes with pins. The pins lie along `up × axis`. |
| `nozzle(r_throat, r_exit, length, ribs, gimbal, bolts)` | Thruster bell (exhaust −Z): real wall thickness, rolled lip, burnt inner surface, emissive throat disc (`glow`), injector cone, bolted collar, cooling ribs and gimbal ring. |
| `vent`, `grille`, `louvres` | Slatted vent in a recessed frame, barred intake, heat-shield louvre stack. |
| `bolt(kind='hex' / 'dome' / 'socket' / 'flat')`, `bolt_row`, `bolt_circle`, `rivet_grid` | Fasteners. Identical ones are UV-stacked automatically (§5). |
| `sensor_cluster(w, h, depth, lenses, slit, hood)` | Camera or sensor housing facing −Y, with emissive `lens` glass and bezels. |
| `antenna`, `shackle` | Whip antenna; lifting eye or tow shackle (construction-machinery greeble). |
| `pipe_run(points, r, bend, flanges)`, `girder_i`, `truss`, `handrail`, `ladder` | Environment kit: pipes with elbows and bolted flanges, I-beams, box trusses, rails with toe boards, caged ladders. |
| `greeble_panel(w, h, seed, density)` | Seeded non-overlapping scatter of boxes, cylinders, vents, bolts and pipes. |
| `collider_box(size, center)` | Plain box for `COL_` proxies. |
| 2D helpers: `fillet(pts, r, segs)`, `offset_poly(pts, d)`, `simplify(pts)`, `rect(w, h)` | Profile building. |

### 4.4 `iwkit.Asset` (the pipeline)
| Method | Purpose |
|---|---|
| `Asset(name, seed, scheme='player' / 'grauwerk', colors={...}, res=2048, kind)` | Creates the `root` Empty, the semantic palette and a work directory (`$IWKIT_WORK`, default `/tmp/claude-0/iwkit_work/<name>`). |
| `pivot`, `muzzle`, `nozzle`, `marker` | Nodes (§2, §3). |
| `part(name, geo, parent)` | Mesh part. Geometry is in world coordinates. |
| `collider(name, size, center, geo)` | `COL_` proxy. |
| `decal(image, location, normal, up, size, depth, opacity)` | Box-projected decal (PIL image or PNG path), baked into the albedo of materials with `decals=True` (the paints). |
| `unwrap(angle=62, small=0.07, stack=True)` | Triangulates (custom normals kept), then builds one shared UV atlas (§5). |
| `bake(weathering, edge, cavity, ao_dist, bevel_radius, reuse)` | Runs every Cycles pass, composites, and assigns the atlas material. |
| `export_glb(path, image_format='JPEG', quality=90, compress=True)` | GLB, plus gltfpack meshopt compression. |
| `export_fbx(path=None)` | UE5 FBX (default `assets/ue5/SM_<name>.fbx`) plus `T_<name>_{BC,ORM,N,E}.png`. The normal map is flipped to DirectX (green down) for Unreal. |
| `show_mask(name)` | Debug material showing a mask or map on the model. |
| `stats()`, `report()`, `geometry_hash()` | Diagnostics. |

### 4.5 Materials (`iwkit.materials.PRESETS`)
Semantic presets are PBR constants plus weathering behaviour. `wear`: the paint chips to bare
metal. `grime`, `rust`, `dust` are multipliers. `emit` gives an emissive colour and strength.
`pattern` is `hazard`, `heat`, `concrete`, `rust` or `galv`.

`paint_primary`, `paint_secondary`, `paint_accent`, `paint_dark`, `hazard` (yellow/black
diagonal stripes in world space), `steel`, `steel_dark`, `chrome`, `rubber`, `nozzle_inner`
(heat-tinted), `glow` (thruster throat, strength 8), `lens` (sensor glass, strength 5),
`concrete`, `rust`, `galvanized`.

`scheme='player'` uses slate `#3E4449`, bone `#C9C2B4`, orange `#E8641E` and eye `#8FF0FF`.
`scheme='grauwerk'` uses oxide `#5C2E24`, cream `#BDB39A`, yellow `#D8A31A` and eye `#FF2A2A`.
Both follow the palette in AC6_BENCHMARK §5. Override per asset with
`colors={'paint_primary': '#555A5E'}` or `colors={'hazard': {'stripe': 0.2}}`.

Final glTF mapping (checked in three.js by `glb_check.mjs`):

| glTF | Source |
|---|---|
| `baseColorTexture` | Composite, sRGB. |
| `metallicRoughnessTexture` and `occlusionTexture` | One ORM image: R = AO, G = roughness, B = metallic. |
| `normalTexture` | Tangent space, OpenGL (+Y). Tangents are exported, same MikkTSpace basis as the bake. |
| `emissiveTexture` | Only on `M_<asset>_glow`, with `KHR_materials_emissive_strength` (= the highest preset strength, 8 by default). |

### 4.6 Decals (`iwkit.decals`, PIL; all ORIGINAL IRONWAKE designs)
| Function | Output |
|---|---|
| `text_decal(lines, kind='stencil' / 'mono', color, stencil, worn)` | Stencil text. Japanese lines switch to the JP font automatically. |
| `hazard_decal(w, h)` | Hazard band. |
| `warning_label(title, jp, body)` | Warning plate, e.g. `CAUTION 注意` / `HOT 高温注意`. |
| `arrow_decal(text)` | Arrow with a label. |
| `serial_plate(lines)` | Stamped data plate. |
| `emblem()` | IRONWAKE unit badge: notched shield, smothered sun, wake bars, crane-hook tick, "IW". |
| `weather(img, amount)` | Blotchy erosion and scratches. |

Fonts: Big Shoulders Bold and JetBrains Mono Bold (OFL) are vendored in `iwkit/fonts`. The
Japanese font is the system IPA Gothic, falling back to WenQuanYi.

---

## 5. UV atlas

`Asset.unwrap()` builds one 0..1 atlas per asset:

1. Triangulate. This keeps the bake tangents, the exporter's tangents and three.js on identical triangles.
2. Smart UV Project (60°), then *average island scale*: uniform texel density across all parts.
3. **Small pieces** (connected parts under 7 cm: bolts, rivets, nubs) get one planar island each,
   at 0.5× density, framed by their own shape. **Identical pieces are stacked** on the same UVs.
   Only one representative is packed; the others copy its transform. For the sample, 487 small
   pieces pack into 95 stacks, which gives about 20% more texel density everywhere else.
   Blender's `merge_overlap` packing hangs on this, so it is done manually.
4. Pack islands (AABB, axis-aligned rotation). The margin is `res/256` px and matches the bake margin.

`iw.uv.coverage(objs)` reports atlas fill and cross-part overlap.
`iw.uv.texel_density(objs, res)` reports px/m.

## 6. Baking and compositing

Passes are Cycles CPU `EMIT` bakes of pass-specific shaders, plus one `NORMAL` bake. Every mesh
of the asset is baked into one float image per pass.

| Pass | spp | Content |
|---|---|---|
| `albedo` | 4 | Paint colour, per-island ±6% tone variation, mottling, hazard / heat / concrete patterns, projected decals. |
| `matid` | 1 | Palette index. Metal, roughness, wear, grime, rust, dust and emission are looked up in numpy. |
| `noise` | 1 | 3D (seamless) grime fbm, vertical streak noise, chip noise, all seeded. |
| `wnormal`, `wpos` | 1 | World normal and bounds-normalised world position (dust on up-faces, dirt toward the ground, sun fade). |
| `masks` | 6 | R = **convexity** from AO "inside" at `edge` radius (a per-pixel edge mask that works on any mesh). G = cavity (small-radius AO). B = thinness (keeps fins and bolts from reading as all-edge). |
| `ao` | 4 | Ambient occlusion, `ao_dist` radius, other parts included. |
| `normal` | 6 | Tangent normal with a **Bevel node** (`bevel_radius`, default 12 mm). It rounds every remaining hard edge (groove lips, greebles), so micro highlights come for free. |

`texcomp.composite()` (numpy; knobs in `iw.Weathering`):

- paint and decals;
- macro mottling, sun fade and ground dirt;
- **edge wear**: edge mask × grunge, thresholded, so the chips break up along edges and bare steel shows through, with a darker primer rim;
- sparse flat chips;
- cavity and AO **grime / soot**;
- vertical **streaks**;
- **rust** in painted cavities;
- **ash dust** on up-facing surfaces;
- AO, partly multiplied into the albedo and fully in ORM.R;
- roughness breakup.

Raw passes are cached as `.npy` under `bake_<geometry-hash>/`. `bake(reuse=True)` re-composites
only when the geometry, UVs, decals and presets are unchanged.

Typical knobs:
```python
a.bake(weathering=iw.Weathering(edge_wear=1.4, grime=1.5, dust=0.2), edge=0.025)
```

## 7. Export details

- **GLB**: `export_yup`, `export_apply`, `export_extras`, `export_tangents`, JPEG images, no
  animations or skins. Then `gltfpack -cc -ce ext -kn -km -ke -vn 10 -vt 14`. This applies
  `EXT_meshopt_compression`, `KHR_mesh_quantization` and `KHR_texture_transform`. All of them
  are supported by the game's loader (`src/core/assets.js`). **No Draco, no KTX2.**
- **FBX (UE5)**: `apply_scale_options='FBX_SCALE_UNITS'`, so metres import as centimetres at
  the right size. The axes are −Z forward / Y up; UE's importer converts them. Other settings:
  face smoothing groups plus custom normals, tangent space, custom properties, embedded
  textures, empties as null nodes. Files are named `SM_<asset>.fbx` and
  `T_<asset>_{BC,ORM,N,E}.png`. `T_*_N` is DirectX (green flipped). In UE, import the rigid
  parts as separate static meshes ("Combine Meshes" off), or as a skeletal mesh built from the
  pivot hierarchy.

## 8. Budgets

| Item | Budget |
|---|---|
| Mech (player or boss) | 60-120k tris, one 2048 atlas. GLB at most 3 MB. |
| Enemy | 15-40k tris, 1024-2048. At most 1.5 MB. |
| Weapon GLB (optional separate) | At most 25k tris, 1024. |
| Arena kit piece | Per-asset 1024 atlas. Instance the pieces in the arena. |
| Single-file build | Everything in `src/manifest.js` together is at most 14 MB (ARCHITECTURE.md). |
| Texel density | At least 100 px/m on a full mech at 2048. Check with the `uv:` log line. |

The GLB texture cost is the four JPEGs at `quality=88-90`. A 2048 atlas costs about 2-2.4 MB
(basecolor + normal about 0.8-1.0 MB each, ORM about 0.4 MB, emissive a few KB). To go
smaller, save ORM at half resolution with `texcomp.save_maps(..., sizes={'orm': 1024})`, or
lower `quality`.

## 9. Timings (4-CPU container, no GPU)

(Filled from `assets/_test/sample_report.json`; see §10.)

## 10. Proof asset: `blender/test_asset.py`

The right forearm of the player rig RIG-07 "IRONWAKE" (the part the engine calls
`forearm_R`), with the IW-R7 rifle held in its hand and a forearm thruster pack. The node
hierarchy follows the contract:
`root > forearm_R > {hand_R > weapon_R > muzzle_R, booster_R > nozzle_R_0/1}`.
Outputs are in `assets/_test/`:

- `sample.glb`
- `SM_sample.fbx` and `T_sample_*.png`
- `sample_preview_{hero,front,rear,close,hand}.png`
- `sample_maps.png`
- `sample_threejs.png`
- `sample_report.json`
