// src/ui/fonts.js — vendored UI fonts (owner: mission/HUD designer).
//
// Files: assets/fonts/*.woff2 (OFL; built by assets/fonts/build_fonts.py from @fontsource/*).
// They are loaded through the asset manifest (ids font_*) as raw bytes and registered with
// the FontFace API, so the single-file build (every manifest file embedded as a data: URI)
// works from file:// with no CSS url() fetches. CSS families (css/ui.css):
//   "IW Label"  Barlow Condensed 400/500/600/700 — labels, headings
//   "IW Mono"   Share Tech Mono 400               — every number (tabular, never jitters)
//   "IW JP"     Noto Sans JP 400/700 (subset)     — Japanese sub-labels
export const FONT_FACES = [
  { id: 'font_label_400', family: 'IW Label', weight: '400' },
  { id: 'font_label_500', family: 'IW Label', weight: '500' },
  { id: 'font_label_600', family: 'IW Label', weight: '600' },
  { id: 'font_label_700', family: 'IW Label', weight: '700' },
  { id: 'font_mono_400', family: 'IW Mono', weight: '400' },
  { id: 'font_jp_400', family: 'IW JP', weight: '400' },
  { id: 'font_jp_700', family: 'IW JP', weight: '700' },
];

let loading = null;

/** Register every UI font once (idempotent). Resolves when all faces are usable. */
export function loadFonts(game) {
  if (loading) return loading;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve(0);
  loading = Promise.all(FONT_FACES.map(async (f) => {
    const buf = await game.assets.arrayBuffer(f.id);
    if (!buf) return 0;
    try {
      const face = new FontFace(f.family, buf, { weight: f.weight, style: 'normal', display: 'block' });
      await face.load();
      document.fonts.add(face);
      return 1;
    } catch (e) {
      console.warn(`[fonts] ${f.id} could not be decoded; using the fallback font.`, e && e.message);
      return 0;
    }
  })).then((r) => r.reduce((a, b) => a + b, 0));
  return loading;
}
