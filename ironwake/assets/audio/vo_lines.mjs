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
// plain text for the TTS: the HUD lane's line-break helpers (jpWrap: zero-width spaces / word
// joiners) are display-only, so they evaluate to identity here and any stray marks are stripped
const plain = (s) => String(s || '').replace(/[\u200B\u2060\u00AD]/g, '');
for (const [key, l] of Object.entries(RADIO)) lines[key] = { en: plain(l.en), hold: l.hold };
if (m) lines.brief = { en: plain(Function('jpWrap', `return (${m[1]});`)((s) => s)), hold: 0 };
process.stdout.write(JSON.stringify(lines, null, 1));
