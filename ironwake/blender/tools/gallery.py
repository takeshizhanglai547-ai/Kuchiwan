"""Reference sheet of every iwkit primitive, rendered with the plain semantic palette
materials (no bake) so artists can see what each call produces.

    python3 blender/tools/gallery.py [out.png]      (default assets/_test/prims_gallery.png)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import iwkit as iw  # noqa: E402
from iwkit import prims as P  # noqa: E402


def items():
    yield 'box+chamfer', P.box((0.8, 0.8, 0.6), bevel=0.02, chamfer=0.1, chamfer_axes='Z').move(0, 0, 0.3)
    yield 'wedge', P.wedge(0.8, 0.9, 0.2, 0.6, chamfer=0.04)
    yield 'loft', P.loft([(P.rect(0.8, 0.6, 0, 0.3), -0.45), (P.rect(0.6, 0.45, 0, 0.26), 0.45)], corner=0.12)
    g = P.box((0.9, 0.9, 0.3), bevel=0.015).move(0, 0, 0.15)
    top = g.largest_face((0, 0, 1))
    g.merge(P.armor_on_face(g, top, margin=0.06, thickness=0.05, ridge=0.03, chamfer=0.06, mat='paint_secondary',
                            bolts=1))
    yield 'armor_on_face', g
    g = P.box((0.9, 0.9, 0.3), bevel=0.015).move(0, 0, 0.15)
    top = g.largest_face((0, 0, 1))
    g.groove_cut([top], (0.12, 0, 0), (1, 0, 0))
    top = g.largest_face((0, 0, 1))
    g.hatch(top, (-0.15, 0, 0.3), (0.35, 0.5), recess=0.03, mat='steel_dark')
    yield 'groove+hatch', g
    yield 'banded_cylinder', P.banded_cylinder([(0.05, 0.3), (0.03, 0.27, 'steel_dark'), (0.2, 0.31),
                                                (0.04, 0.33, 'paint_accent'), (0.2, 0.31), (0.05, 0.3)])
    yield 'piston', P.piston((-0.45, 0, 0.12), (0.45, 0, 0.2), r_sleeve=0.07)
    yield 'nozzle', P.nozzle(0.12, 0.22, 0.35, ribs=2, gimbal=True).rotate((180, 0, 0)).move(0, 0, 0.0)
    yield 'vent', P.vent(0.6, 0.5, slats=7).move(0, 0, 0.1)
    yield 'grille', P.grille(0.6, 0.5, bars=9).move(0, 0, 0.1)
    yield 'louvres', P.louvres(0.6, 0.5, 5).move(0, 0, 0.02)
    yield 'sensor_cluster', P.sensor_cluster().rotate((0, 0, 0)).move(0, 0, 0.12)
    yield 'hose+cable', P.hose([(-0.4, 0, 0.05), (-0.1, 0.2, 0.4), (0.2, -0.2, 0.3), (0.4, 0, 0.05)]).merge(
        P.cable((-0.4, 0.3, 0.3), (0.4, 0.3, 0.3), sag=0.2, radius=0.02))
    yield 'bolts', P.bolt_row((-0.35, -0.2, 0), (0.35, -0.2, 0), 6, r=0.03).merge(
        P.bolt_circle((0, 0.15, 0), (0, 0, 1), 0.2, 8, r=0.025, kind='socket')).merge(
        P.rivet_grid((-0.35, 0.4, 0), (0.7, 0, 0), (0, 0.001, 0), 8, 1, (0, 0, 1), r=0.02))
    yield 'shackle+antenna', P.shackle(0.1).merge(P.antenna(0.6).move(0.3, 0, 0))
    yield 'greeble_panel', P.greeble_panel(0.8, 0.8, seed=4, density=0.9, height=0.08)
    yield 'pipe_run', P.pipe_run([(-0.4, 0, 0.1), (0.1, 0, 0.1), (0.1, 0.3, 0.5), (0.4, 0.3, 0.5)], 0.06, bend=0.12)
    yield 'girder+truss', P.girder_i(0.9, 0.3, 0.2).move(0, -0.25, 0.15).merge(
        P.truss(0.9, 0.3, 0.3, bays=3, chord=0.04, member=0.025).move(-0.45, 0.2, 0.15))
    yield 'handrail', P.handrail([(-0.4, -0.3, 0), (0.4, -0.3, 0), (0.4, 0.3, 0)], height=0.6, post_every=0.4, r=0.015)
    yield 'ladder', P.ladder(1.0, 0.4, cage=False).rotate((0, 0, 0))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else os.path.join(
        iw.core.ASSETS_DIR, '_test', 'prims_gallery.png')
    iw.reset_scene()
    a = iw.Asset('gallery', seed=1)
    cols = 5
    for i, (name, g) in enumerate(items()):
        x = (i % cols) * 1.4
        y = (i // cols) * 1.4
        g.move(x, y, 0)
        a.part(name.replace('+', '_'), g)
    iw.preview.studio(a.parts, key=0.8)
    iw.preview.camera(a.parts, azimuth=-20, elevation=38, lens=45, fill=0.95)
    iw.preview.render(out, res=(1600, 1000), samples=40)
    print('gallery ->', out)


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    os._exit(0)
