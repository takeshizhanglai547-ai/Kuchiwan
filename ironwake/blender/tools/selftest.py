"""iwkit self-test (about 30 s): primitives are closed and outward-facing, geometry and UVs
are deterministic, and a tiny asset bakes and exports a GLB that keeps its node names.

    python3 blender/tools/selftest.py        -> prints PASS/FAIL lines, exit code 0/1
"""
import hashlib
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import numpy as np  # noqa: E402

import iwkit as iw  # noqa: E402
from iwkit import prims as P  # noqa: E402

FAIL = []


def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({info})' if info else ''))
    if not ok:
        FAIL.append(name)


def islands_ok(g):
    bad = 0
    for isl in g.islands():
        g.bm.faces.ensure_lookup_table()
        fs = [g.bm.faces[i] for i in isl]
        c = sum((f.calc_center_median() for f in fs), iw.core.Vector()) / len(fs)
        v = sum((f.calc_center_median() - c).dot(f.normal) * f.calc_area() for f in fs)
        if v < 0:
            bad += 1
    open_edges = sum(1 for e in g.bm.edges if len(e.link_faces) != 2)
    return bad, open_edges


def build_small():
    iw.reset_scene()
    a = iw.Asset('selftest', seed=5, res=256)
    pv = a.pivot('forearm_R', (0, 0, 0))
    g = P.box((0.6, 1.0, 0.5), bevel=0.02, chamfer=0.05, chamfer_axes='Y').move(0, -0.5, 0)
    top = g.largest_face((0, 0, 1))
    g.hatch(top, (0, -0.5, 0.25), (0.3, 0.3), recess=0.02, mat='steel_dark')
    g.groove_cut(g.faces_facing((1, 0, 0), 10), (0, -0.3, 0), (0, 1, 0))
    g.merge(P.bolt_row((-0.2, -1.0, 0.1), (0.2, -1.0, 0.1), 4, (0, -1, 0)))
    g.merge(P.nozzle(0.06, 0.1, 0.18, segs=32).rotate((90, 0, 0)).move(0, 0.1, 0))
    g.cull_inside()
    a.part('forearm_R_geo', g, parent=pv)
    a.nozzle('nozzle_R_0', (0, 0.28, 0), exhaust=(0, 1, 0), parent=pv)
    a.collider('box', size=(0.6, 1.0, 0.5), center=(0, -0.5, 0))
    a.decal(iw.decals.text_decal('07'), (0.3, -0.6, 0.0), (1, 0, 0), size=(0.2, None))
    a.unwrap()
    return a


def main():
    # 1. primitives
    prims = {
        'box': P.box((1, 1, 1), chamfer=0.1), 'loft': P.loft([(P.rect(1, 0.6), 0), (P.rect(0.8, 0.5), -1)], corner=0.1),
        'plate': P.plate(P.rect(1, 0.6), 0.04, ridge=0.02), 'cylinder': P.cylinder(0.2, 0.5), 'ring': P.ring(0.3, 0.2, 0.1),
        'banded': P.banded_cylinder([(0.1, 0.2), (0.05, 0.18), (0.1, 0.2)]), 'torus': P.torus(0.3, 0.04),
        'hose': P.hose([(0, 0, 0), (1, 0, 0.2), (2, 0.5, 0)]), 'piston': P.piston((0, 0, 0), (1, 0, 0.2)),
        'nozzle': P.nozzle(ribs=2, gimbal=True), 'vent': P.vent(0.3, 0.2), 'louvres': P.louvres(0.4, 0.3),
        'sensor': P.sensor_cluster(), 'shackle': P.shackle(), 'pipe': P.pipe_run([(0, 0, 0), (1, 0, 0), (1, 1, 0.5)]),
        'truss': P.truss(3), 'ladder': P.ladder(4), 'handrail': P.handrail([(0, 0, 0), (2, 0, 0)]),
        'greeble': P.greeble_panel(0.6, 0.4, seed=2),
    }
    for k, g in prims.items():
        bad, open_edges = islands_ok(g)
        check(f'prim {k} closed+outward', bad == 0 and open_edges == 0, f'{g.tris()} tris, inverted={bad}, open={open_edges}')
    # 2. determinism
    hashes = []
    for _ in range(2):
        a = build_small()
        h = a.geometry_hash()
        hashes.append(h)
    check('deterministic geometry + UVs', hashes[0] == hashes[1], hashes[0])
    # 3. bake + export
    a.bake()
    b = a.maps['basecolor']
    check('bake produced maps', b.shape == (256, 256, 3) and b.mean() > 5, f'mean {b.mean():.1f}')
    out = os.path.join(tempfile.mkdtemp(prefix='iwkit_'), 'selftest.glb')
    a.export_glb(out, compress=iw.export.gltfpack_available())
    rep = iw.export.glb_report(out)
    for n in ('root', 'forearm_R', 'forearm_R_geo', 'nozzle_R_0', 'COL_box'):
        check(f'glb node {n}', n in rep['nodes'])
    check('glb materials', 'M_selftest' in rep['materials'], str(rep['materials']))
    print('RESULT', 'FAIL' if FAIL else 'PASS', FAIL)


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    os._exit(1 if FAIL else 0)
