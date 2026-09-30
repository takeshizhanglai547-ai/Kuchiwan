"""iwkit.decals - PIL-drawn decal images (RGBA) for projection into the atlas.

Stencil numbers, hazard stripes, warning labels (EN + JP), load ratings, arrows,
serial plates and the ORIGINAL IRONWAKE emblem. All deterministic (seeded).

Fonts: vendored OFL fonts in iwkit/fonts (Big Shoulders Bold = condensed industrial,
JetBrains Mono Bold = serials). Japanese falls back to system IPA Gothic / WenQuanYi.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_DIR = os.path.join(os.path.dirname(__file__), 'fonts')
_FONT_CANDIDATES = {
    'stencil': [os.path.join(FONT_DIR, 'BigShoulders-Bold.ttf'),
                '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
                '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
    'mono': [os.path.join(FONT_DIR, 'JetBrainsMono-Bold.ttf'),
             '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'],
    'jp': ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
           '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
           '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
           '/usr/share/fonts/opentype/unifont/unifont_jp.otf'],
}

# sRGB 0-255 decal colours (IRONWAKE palette)
BONE = (214, 207, 192)
BLACK = (22, 22, 22)
ORANGE = (232, 100, 30)
YELLOW = (216, 163, 26)
RED = (190, 38, 30)
WHITE = (228, 228, 222)


def font(kind='stencil', size=64):
    for p in _FONT_CANDIDATES.get(kind, []) + _FONT_CANDIDATES['stencil']:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _stencil_cut(mask, fnt, text, origin, draw_bridges=True):
    """Carve stencil bridges into letters that have closed counters."""
    if not draw_bridges:
        return mask
    d = ImageDraw.Draw(mask)
    x = origin[0]
    for ch in text:
        bbox = fnt.getbbox(ch)
        w = fnt.getlength(ch)
        if ch.upper() in 'OQ0':
            gx = x + (bbox[0] + bbox[2]) / 2
            gw = max(2, (bbox[2] - bbox[0]) * 0.09)
            d.rectangle([gx - gw / 2, origin[1] + bbox[1] - 2, gx + gw / 2, origin[1] + bbox[3] + 2], fill=0)
        x += w
    return mask


def weather(img, amount=0.35, seed=1, scratches=12):
    """Erode alpha with blotchy noise + a few scratches (sprayed & worn paint)."""
    rng = np.random.default_rng(seed)
    w, h = img.size
    small = rng.random((max(2, h // 12), max(2, w // 12))).astype(np.float32)
    n = np.array(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    fine = rng.random((h, w)).astype(np.float32)
    keep = (n * 0.85 + fine * 0.15) > amount * 0.9
    a = np.array(img.getchannel('A'), np.float32)
    a *= np.where(keep, 1.0, 0.25 + 0.5 * fine)
    im = Image.fromarray(a.astype(np.uint8))
    d = ImageDraw.Draw(im)
    r = random.Random(seed)
    for _ in range(scratches):
        x0, y0 = r.uniform(0, w), r.uniform(0, h)
        ang = r.uniform(-0.5, 0.5) + (0 if r.random() < 0.5 else math.pi / 2)
        L = r.uniform(0.05, 0.3) * max(w, h)
        d.line([x0, y0, x0 + math.cos(ang) * L, y0 + math.sin(ang) * L], fill=0, width=max(1, int(min(w, h) * 0.006)))
    out = img.copy()
    out.putalpha(im)
    return out


def _spray(img, blur=0.7):
    a = img.getchannel('A').filter(ImageFilter.GaussianBlur(blur))
    out = img.copy()
    out.putalpha(a)
    return out


def text_decal(lines, kind='stencil', px=96, color=BONE, stencil=True, align='center', pad=0.18,
               spacing=0.12, worn=0.3, seed=1, bg=None, border=0):
    """Multi-line text decal. lines: str or list[str]. Returns RGBA image sized to fit."""
    if isinstance(lines, str):
        lines = [lines]

    def is_jp(t):
        return any(ord(ch) > 0x2E80 for ch in t)
    fonts = [font('jp', int(px * 0.8)) if is_jp(t) else font(kind, px) for t in lines]
    widths = [f.getlength(t) for f, t in zip(fonts, lines)]
    heights = [sum(f.getmetrics()) for f in fonts]
    W = int(max(widths) + px * pad * 2)
    H = int(sum(heights) + px * spacing * (len(lines) - 1) + px * pad * 2)
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    y = px * pad
    for t, tw, f, lh in zip(lines, widths, fonts, heights):
        x = (W - tw) / 2 if align == 'center' else px * pad
        d.text((x, y), t, font=f, fill=255)
        if stencil and kind == 'stencil' and not is_jp(t):
            _stencil_cut(mask, f, t, (x, y))
        y += lh + px * spacing
    img = Image.new('RGBA', (W, H), (*color, 0))
    if bg is not None:
        base = Image.new('RGBA', (W, H), (*bg, 255))
        if border:
            ImageDraw.Draw(base).rectangle([border / 2, border / 2, W - border / 2, H - border / 2],
                                           outline=(*color, 255), width=border)
        fill = Image.new('RGBA', (W, H), (*color, 255))
        base.paste(fill, (0, 0), mask)
        img = base
    else:
        img.putalpha(mask)
    img = _spray(img)
    return weather(img, worn, seed) if worn > 0 else img


def hazard_decal(w=512, h=128, stripe=None, colors=(YELLOW, BLACK), angle=45, worn=0.3, seed=2, border=True):
    """Diagonal hazard chevron band."""
    stripe = stripe or h * 0.5
    img = Image.new('RGBA', (w, h), (*colors[1], 255))
    d = ImageDraw.Draw(img)
    k = math.tan(math.radians(angle))
    x = -h * k - stripe * 2
    while x < w + stripe * 2:
        d.polygon([(x, h), (x + stripe, h), (x + stripe + h * k, 0), (x + h * k, 0)], fill=(*colors[0], 255))
        x += stripe * 2
    if border:
        bw = max(2, h // 16)
        d.rectangle([0, 0, w - 1, bw], fill=(*colors[1], 255))
        d.rectangle([0, h - 1 - bw, w - 1, h - 1], fill=(*colors[1], 255))
    return weather(img, worn, seed, scratches=6) if worn > 0 else img


def warning_label(title='CAUTION', jp='注意', body=('HIGH PRESSURE', '高圧注意'), w=640, colors=(YELLOW, BLACK),
                  worn=0.25, seed=3):
    """Industrial warning plate: black border, triangle glyph, EN title, JP sub label, body."""
    fg, bgc = colors[1], colors[0]
    h = int(w * 0.42)
    img = Image.new('RGBA', (w, h), (*bgc, 255))
    d = ImageDraw.Draw(img)
    bw = max(4, w // 48)
    d.rectangle([bw // 2, bw // 2, w - bw // 2 - 1, h - bw // 2 - 1], outline=(*fg, 255), width=bw)
    # header bar
    hb = int(h * 0.42)
    d.rectangle([0, 0, w, hb], fill=(*fg, 255))
    # triangle
    ts = hb * 0.72
    cx, cy = bw * 2 + ts * 0.6, hb * 0.5
    tri = [(cx, cy - ts * 0.5), (cx + ts * 0.58, cy + ts * 0.42), (cx - ts * 0.58, cy + ts * 0.42)]
    d.polygon(tri, fill=(*bgc, 255))
    d.rectangle([cx - ts * 0.05, cy - ts * 0.2, cx + ts * 0.05, cy + ts * 0.15], fill=(*fg, 255))
    d.rectangle([cx - ts * 0.05, cy + ts * 0.22, cx + ts * 0.05, cy + ts * 0.32], fill=(*fg, 255))
    f1 = font('stencil', int(hb * 0.78))
    tx = cx + ts * 0.8
    d.text((tx, hb * 0.08), title, font=f1, fill=(*bgc, 255))
    fj = font('jp', int(hb * 0.5))
    tw = f1.getlength(title)
    d.text((tx + tw + hb * 0.25, hb * 0.26), jp, font=fj, fill=(*bgc, 255))
    fb = font('stencil', int((h - hb) * 0.36))
    fbj = font('jp', int((h - hb) * 0.26))
    d.text((bw * 3, hb + (h - hb) * 0.1), body[0], font=fb, fill=(*fg, 255))
    if len(body) > 1:
        d.text((bw * 3, hb + (h - hb) * 0.55), body[1], font=fbj, fill=(*fg, 255))
    return weather(img, worn, seed, scratches=8) if worn > 0 else img


def arrow_decal(w=256, h=128, color=BONE, text=None, worn=0.3, seed=4):
    img = Image.new('RGBA', (w, h), (*color, 0))
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    sh = h * 0.34
    d.rectangle([w * 0.05, h / 2 - sh / 2, w * 0.62, h / 2 + sh / 2], fill=255)
    d.polygon([(w * 0.6, h * 0.08), (w * 0.95, h / 2), (w * 0.6, h * 0.92)], fill=255)
    if text:
        f = font('stencil', int(sh * 0.9))
        d.text((w * 0.08, h / 2 - sh * 0.55), text, font=f, fill=0)
    img.putalpha(m)
    img = _spray(img)
    return weather(img, worn, seed) if worn > 0 else img


def serial_plate(lines=('RIG-07  IW-FA/R', 'LOT 0417-C  MAX 40t'), w=512, worn=0.2, seed=5):
    """Stamped metal data plate (light plate, dark mono text, corner rivets)."""
    h = int(w * 0.36)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, w - 3, h - 3], radius=h * 0.08, fill=(170, 168, 160, 255), outline=(60, 60, 58, 255),
                        width=3)
    f = font('mono', int(h * 0.2))
    y = h * 0.18
    for t in lines:
        d.text((w * 0.1, y), t, font=f, fill=(35, 35, 35, 255))
        y += h * 0.32
    for (x, yy) in ((0.045, 0.14), (0.955, 0.14), (0.045, 0.86), (0.955, 0.86)):
        r = h * 0.045
        d.ellipse([w * x - r, h * yy - r, w * x + r, h * yy + r], fill=(95, 95, 92, 255))
    return weather(img, worn, seed, scratches=5) if worn > 0 else img


def emblem(px=512, colors=(BONE, ORANGE, BLACK), worn=0.25, seed=6):
    """ORIGINAL IRONWAKE unit emblem: notched industrial shield, a smothered sun
    sinking behind three wake bars, a crane-hook tick and 'IW' mark. Transparent bg."""
    S = px
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    # notched shield outline
    k = S * 0.08
    shield = [(S * 0.12 + k, S * 0.08), (S * 0.88 - k, S * 0.08), (S * 0.88, S * 0.08 + k), (S * 0.88, S * 0.62),
              (c, S * 0.94), (S * 0.12, S * 0.62), (S * 0.12, S * 0.08 + k)]
    d.polygon(shield, fill=(*colors[0], 255))
    inner = [((x - c) * 0.86 + c, (y - S * 0.5) * 0.86 + S * 0.5) for x, y in shield]
    d.polygon(inner, fill=(*colors[2], 255))
    # smothered sun (clipped to inner shield)
    sun = Image.new('L', (S, S), 0)
    ds = ImageDraw.Draw(sun)
    r = S * 0.2
    ds.ellipse([c - r, S * 0.3 - r * 0.2, c + r, S * 0.3 + r * 1.8], fill=255)
    clip = Image.new('L', (S, S), 0)
    ImageDraw.Draw(clip).polygon(inner, fill=255)
    sun = ImageChops.multiply(sun, clip)
    # wake bars cut through the lower half of the sun
    bars = Image.new('L', (S, S), 0)
    db = ImageDraw.Draw(bars)
    for i, (y0, sk) in enumerate(((0.47, 0.0), (0.56, 0.05), (0.65, 0.1))):
        yy = S * y0
        hh = S * 0.045
        db.polygon([(S * (0.14 + sk), yy), (S * (0.86 - sk), yy - hh * 0.6), (S * (0.86 - sk), yy + hh * 0.4),
                    (S * (0.14 + sk), yy + hh)], fill=255)
    sun_final = ImageChops.subtract(sun, bars)
    col = Image.new('RGBA', (S, S), (*colors[1], 255))
    img.paste(col, (0, 0), sun_final)
    bone = Image.new('RGBA', (S, S), (*colors[0], 255))
    img.paste(bone, (0, 0), ImageChops.multiply(bars, clip))
    # crane hook tick at top
    hk = S * 0.05
    d.rectangle([c - hk * 0.35, S * 0.1, c + hk * 0.35, S * 0.2], fill=(*colors[0], 255))
    d.arc([c - hk * 1.2, S * 0.16, c + hk * 0.8, S * 0.28], 0, 200, fill=(*colors[0], 255), width=int(hk * 0.5))
    # IW mark
    f = font('stencil', int(S * 0.13))
    t = 'IW'
    tw = f.getlength(t)
    d.text((c - tw / 2, S * 0.71), t, font=f, fill=(*colors[0], 255))
    img = _spray(img, 0.6)
    return weather(img, worn, seed, scratches=10) if worn > 0 else img


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path
