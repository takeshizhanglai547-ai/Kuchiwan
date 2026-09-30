#!/usr/bin/env python3
"""assets/fonts/build_fonts.py - vendor + subset the HUD/menu fonts (owner: mission/HUD designer).

    python3 assets/fonts/build_fonts.py <path-to>/node_modules/@fontsource

Inputs are the OFL fonts from npm (@fontsource/barlow-condensed, @fontsource/share-tech-mono,
@fontsource/noto-sans-jp). Outputs (woff2, next to this script):
    barlow-condensed-{400,500,600,700}.woff2   labels / headings (latin only)
    share-tech-mono-400.woff2                  tabular numbers
    noto-sans-jp-{400,700}-subset.woff2        ONLY the Japanese glyphs the game uses

The Japanese subset scans every .js/.css file under src/ and css/ for kana, kanji and
full-width punctuation (plus the whole kana block, so new katakana strings keep working),
pulls those glyphs out of fontsource's ~120 unicode-range slices and merges them into one
file per weight. Re-run it after adding Japanese text. Budget: all fonts <= 600 KB.
Requires: pip install fonttools brotli
"""
import glob
import io
import os
import re
import shutil
import sys

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'node_modules', '@fontsource')

LATIN = [
    ('barlow-condensed/files/barlow-condensed-latin-{w}-normal.woff2', 'barlow-condensed-{w}.woff2', (400, 500, 600, 700)),
    ('share-tech-mono/files/share-tech-mono-latin-{w}-normal.woff2', 'share-tech-mono-{w}.woff2', (400,)),
]
JP_WEIGHTS = (400, 700)
CJK = re.compile(r'[　-〿぀-ヿㇰ-ㇿ一-鿿＀-￯‐-‧←-⇿■-◿]')


def used_chars():
    chars = set()
    for pat in ('src/**/*.js', 'css/*.css', 'index.html'):
        for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
            with open(f, encoding='utf-8') as fh:
                chars.update(CJK.findall(fh.read()))
    chars.update(chr(c) for c in range(0x3041, 0x3097))   # hiragana
    chars.update(chr(c) for c in range(0x30a1, 0x30fb))   # katakana
    chars.update('ー・、。「」『』（）！？：～／＋－〜…　')
    return chars


def subset_font(path, text, keep_palt=True):
    font = TTFont(path)
    cmap = font.getBestCmap()
    present = [c for c in text if ord(c) in cmap]
    if not present:
        return None
    opts = subset.Options()
    opts.layout_features = ['kern', 'palt', 'liga', 'ccmp', 'locl'] if keep_palt else ['kern']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.flavor = None
    s = subset.Subsetter(opts)
    s.populate(text=''.join(present))
    s.subset(font)
    return font, present


def main():
    os.makedirs(HERE, exist_ok=True)
    for src, dst, weights in LATIN:
        for w in weights:
            shutil.copyfile(os.path.join(SRC, src.format(w=w)), os.path.join(HERE, dst.format(w=w)))
    text = ''.join(sorted(used_chars()))
    slices = sorted(glob.glob(os.path.join(SRC, 'noto-sans-jp/files/noto-sans-jp-[0-9]*-400-normal.woff2')))
    print(f'[fonts] {len(text)} Japanese chars, {len(slices)} fontsource slices')
    for w in JP_WEIGHTS:
        parts, covered = [], set()
        for f in sorted(glob.glob(os.path.join(SRC, f'noto-sans-jp/files/noto-sans-jp-[0-9]*-{w}-normal.woff2'))):
            r = subset_font(f, [c for c in text if c not in covered])
            if not r:
                continue
            font, present = r
            covered.update(present)
            tmp = io.BytesIO()
            font.flavor = None
            font.save(tmp)
            tmp.seek(0)
            parts.append(tmp)
        missing = [c for c in text if c not in covered]
        if missing:
            print(f'[fonts] WARNING weight {w}: no glyph for {"".join(missing)!r}')
        tmpfiles = []
        for i, p in enumerate(parts):
            fn = os.path.join(HERE, f'.part{w}_{i}.ttf')
            with open(fn, 'wb') as fh:
                fh.write(p.getvalue())
            tmpfiles.append(fn)
        merged = Merger().merge(tmpfiles) if len(tmpfiles) > 1 else TTFont(tmpfiles[0])
        for fn in tmpfiles:
            os.remove(fn)
        merged.flavor = 'woff2'
        out = os.path.join(HERE, f'noto-sans-jp-{w}-subset.woff2')
        merged.save(out)
        print(f'[fonts] {os.path.basename(out)}: {len(covered)} glyphs from {len(parts)} slices, {os.path.getsize(out) // 1024} KB')
    total = sum(os.path.getsize(f) for f in glob.glob(os.path.join(HERE, '*.woff2')))
    print(f'[fonts] total {total / 1024:.0f} KB (budget 600 KB)')


if __name__ == '__main__':
    main()
