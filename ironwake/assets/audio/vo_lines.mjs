// assets/audio/vo_lines.mjs — prints the handler LEDGER's lines as JSON for build_vo.py
// (owner: audio designer). Source of truth stays in the HUD lane: src/ui/radio.js (RADIO) and
// the briefing intel string INTEL_EN in src/ui/menus.js (read as text, not imported: menus.js
// pulls in the DOM).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { RADIO } = await import(path.join(ROOT, 'src/ui/radio.js'));
const menus = fs.readFileSync(path.join(ROOT, 'src/ui/menus.js'), 'utf8');
const m = menus.match(/const INTEL_EN\s*=\s*([\s\S]*?);\s*\n/);
const lines = {};
for (const [key, l] of Object.entries(RADIO)) lines[key] = { en: l.en, hold: l.hold };
if (m) lines.brief = { en: Function(`return (${m[1]});`)(), hold: 0 };
process.stdout.write(JSON.stringify(lines, null, 1));
