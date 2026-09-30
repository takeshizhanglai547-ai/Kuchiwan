"""Bake-time benchmark at full-mech scale.

    python3 blender/tools/bench_bake.py [--copies 3] [--res 2048]

Builds `copies` spatially separated instances of the proof sample (forearm + hand + rifle +
thruster pack, ~56k tris each) as ONE asset, so the triangle count and surface area are about
those of a complete rig. It then runs unwrap + every bake pass + composite + GLB export (no
previews) and prints the timings as JSON. Nothing is written into the repo; the GLB goes to
the work dir.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import iwkit as iw  # noqa: E402
import test_asset as T  # noqa: E402
from iwkit import prims as P  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--copies', type=int, default=3)
    ap.add_argument('--res', type=int, default=2048)
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    P.SEG_SCALE = 0.75
    t0 = time.time()
    iw.reset_scene()
    a = iw.Asset('bench', seed=11, scheme='player', res=args.res)
    rng = a.rng.fork('g')
    for k in range(args.copies):
        pv = a.pivot(f'part_{k}', (k * 2.0, 0, 0))
        g = T.build_forearm(rng)
        g.merge(T.build_hand(), T.build_rifle(rng), T.build_booster())
        g.cull_inside()
        g.move(k * 2.0, 0, 0)
        a.part(f'part_{k}_geo', g, parent=pv)
    st = a.stats()
    a.unwrap()
    a.bake()
    size = a.export_glb(os.path.join(a.work, 'bench.glb'))
    rep = a.report({'glb_bytes': size, 'total_s': round(time.time() - t0, 1), 'copies': args.copies})
    print('BENCH', json.dumps(rep))


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    os._exit(0)
