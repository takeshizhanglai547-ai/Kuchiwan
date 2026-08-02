// ============================================================
//  Crop + magnify a screenshot so a small region can actually be
//  judged, and print the region's luminance statistics.
//
//    node tools/crop.mjs shots/integration/gameplay.png \
//         --rect=500,320,140,150 --scale=4 --out=shots/_crop/mech.png
//
//  --rect=x,y,w,h    source rectangle in image pixels
//  --scale=N         nearest-neighbour magnification (default 3)
//  --stats           also print min/mean/max luminance of the region
// ============================================================
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--'));
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return [m[1], m[2] ?? true];
}));

if (!src) { console.error('usage: node tools/crop.mjs <png> --rect=x,y,w,h [--scale=3] [--out=path]'); process.exit(2); }

const file = path.resolve(ROOT, src);
const [rx, ry, rw, rh] = String(args.rect || '0,0,0,0').split(',').map(Number);
const scale = Number(args.scale || 3);
const out = path.resolve(ROOT, args.out || file.replace(/\.png$/, `.crop.png`));

const b64 = fs.readFileSync(file).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.setContent('<body style="margin:0;background:#000"><canvas id="c"></canvas></body>');

const res = await page.evaluate(async ([data, x, y, w, h, s]) => {
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/png;base64,' + data; });
  const sw = w > 0 ? w : img.width;
  const sh = h > 0 ? h : img.height;
  const c = document.getElementById('c');
  c.width = sw * s; c.height = sh * s;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, sw, sh, 0, 0, sw * s, sh * s);

  // luminance stats on the SOURCE pixels
  const t = document.createElement('canvas');
  t.width = sw; t.height = sh;
  const tg = t.getContext('2d');
  tg.drawImage(img, x, y, sw, sh, 0, 0, sw, sh);
  const px = tg.getImageData(0, 0, sw, sh).data;
  let mn = 999, mx = -1, sum = 0, n = 0;
  const hist = new Array(8).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    if (l < mn) mn = l; if (l > mx) mx = l;
    sum += l; n++;
    hist[Math.min(7, (l / 32) | 0)]++;
  }
  return {
    src: { w: img.width, h: img.height },
    region: { x, y, w: sw, h: sh },
    lum: { min: +mn.toFixed(1), mean: +(sum / n).toFixed(1), max: +mx.toFixed(1) },
    histogram: hist.map((v) => +(v / n * 100).toFixed(1)),
    png: c.toDataURL('image/png'),
  };
}, [b64, rx | 0, ry | 0, rw | 0, rh | 0, scale]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
await browser.close();

delete res.png;
console.log(JSON.stringify({ ...res, out: path.relative(ROOT, out) }, null, 2));
