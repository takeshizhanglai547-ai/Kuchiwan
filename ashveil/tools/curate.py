#!/usr/bin/env python3
"""
Build the delivered screenshot set from a round's raw PNG captures.

The delivered set is JPEG, not PNG: the raw captures are ~400 KB each and there
are sixty-odd of them, which is a 25 MB repository cost for images whose whole
job is to be looked at once. Quality 88 is visually indistinguishable here (the
palette is dark and low-frequency) at about a tenth the size.

Nothing is filtered on the way through. If a frame in the source round shows a
defect, it appears in the delivered set showing that defect; curating the set to
look better than the build would make the screenshots a nicer advertisement and
a worse report.

Usage:  python3 tools/curate.py captures/r5 captures/final
"""
import sys
import pathlib
from PIL import Image

SUBSETS = ['world', 'boss', 'combat', 'swing']


def convert(src: pathlib.Path, dst: pathlib.Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im.convert('RGB').save(dst, 'JPEG', quality=88, optimize=True)
    return dst.stat().st_size


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    root = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    if not root.is_dir():
        print(f'no such capture round: {root}')
        return 1

    total = count = 0
    for sub in SUBSETS:
        d = root / sub
        if not d.is_dir():
            print(f'  (skipped {sub}: not captured this round)')
            continue
        for png in sorted(d.glob('*.png')):
            if png.name == '00_title.png' and sub != 'world':
                continue
            total += convert(png, out / sub / (png.stem + '.jpg'))
            count += 1
        print(f'  {sub}: {len(list(d.glob("*.png")))} frames')

    title = root / 'world' / '00_title.png'
    if title.exists():
        total += convert(title, out / '00_title.jpg')
        count += 1

    print(f'{count} images, {total / 1e6:.1f} MB -> {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
