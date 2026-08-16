// Single-file bundler for ASHVEIL.
//
// The game ships as ~31 ES modules plus a vendored three.js. Anywhere that can
// only host ONE file needs all of that collapsed into a single .html.
//
// WHY THIS DOES NOT USE data: URL MODULES
// ---------------------------------------
// The obvious approach — keep every module intact and point an inline importmap
// at base64 data: URLs — is far safer to implement, because it rewrites import
// specifiers only and never touches code. It also fails on a real phone: a strict
// Content-Security-Policy that permits inline scripts still refuses `data:` as a
// script source, and Safari reports the whole thing as the singularly unhelpful
// `TypeError: Importing a module script failed.` blob: has the same exposure.
//
// The only form guaranteed to survive a CSP that allows inline script is one
// inline script and no separate script URLs whatsoever. So the modules are
// transformed into a tiny registry: each becomes a function of (exports, require),
// and `require` evaluates lazily on first use, which preserves execution order
// without needing a topological sort and tolerates import cycles the same way the
// native loader does.
//
// Transformation is confined to import/export STATEMENTS at the start of a line.
// Nothing inside expressions, strings or minified bodies is touched, and the
// build asserts afterwards that no `import`/`export` statement survived — a
// silent miss would otherwise become a runtime SyntaxError on the player's phone.
//
// usage: node tools/bundle.js [outfile]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'src/main.js';
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'ashveil.html');

const skipped = new Set();

/** Resolve an import specifier, as written inside `fromRel`, to a repo-relative path. */
function resolve(spec, fromRel) {
  let rel = null;
  if (spec === 'three') rel = 'vendor/three.module.min.js';
  else if (spec.startsWith('three/addons/')) {
    rel = path.posix.join('vendor/jsm', spec.slice('three/addons/'.length));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  }
  if (!rel) return null;
  // The scan cannot tell code from prose, and several modules carry doc headers
  // containing example import lines. Resolving against the real tree separates
  // them: a path that is not on disk was never an import.
  if (!fs.existsSync(path.join(ROOT, rel))) {
    skipped.add(`${fromRel}: ${spec}`);
    return null;
  }
  return rel;
}

const modules = new Map();

/** Split `A as B, C` on top-level commas. Import/export lists never nest. */
const parts = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** `A as B` -> {local:'A', exported:'B'} */
function alias(entry) {
  const m = entry.match(/^(\S+)\s+as\s+(\S+)$/);
  return m ? { local: m[1], exported: m[2] } : { local: entry, exported: entry };
}

/**
 * Rewrite one module's ESM syntax into registry form.
 * Every pattern is anchored to the start of a line so expression-position uses of
 * the words (`import(` for dynamic import, a property named `export`) are safe.
 */
function transform(rel, src) {
  const req = (spec) => {
    const target = resolve(spec, rel);
    return target ? `__req(${JSON.stringify(target)})` : `__missing(${JSON.stringify(spec)})`;
  };
  let out = src;

  // export ... from '<spec>'  (re-export; must run before the plain forms)
  out = out.replace(/^[ \t]*export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?/gm,
    (_w, spec) => `Object.assign(__e, ${req(spec)});`);
  out = out.replace(/^[ \t]*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gm,
    (_w, list, spec) => {
      const m = `__m${Math.abs(hash(list + spec))}`;
      const body = parts(list).map((e) => {
        const a = alias(e);
        return `__e.${a.exported}=${m}.${a.local};`;
      }).join('');
      return `const ${m}=${req(spec)};${body}`;
    });

  // import ... from '<spec>'   — clause may span lines, so [\s\S] inside the brace
  out = out.replace(/^[ \t]*import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]\s*;?/gm,
    (_w, clause, spec) => {
      const r = req(spec);
      clause = clause.trim();
      let ns = clause.match(/^\*\s+as\s+(\S+)$/);
      if (ns) return `const ${ns[1]}=${r};`;
      let named = clause.match(/^\{([\s\S]*)\}$/);
      if (named) {
        const body = parts(named[1]).map((e) => {
          const a = alias(e);            // `A as B` in an import binds B locally
          return `${a.local}:${a.exported}`;
        }).join(',');
        return `const {${body}}=${r};`;
      }
      // default, optionally with a named or namespace clause after it
      const mixed = clause.match(/^(\S+)\s*,\s*([\s\S]+)$/);
      if (mixed) {
        const rest = mixed[2].trim();
        const nsRest = rest.match(/^\*\s+as\s+(\S+)$/);
        const tmp = `__m${Math.abs(hash(clause + spec))}`;
        if (nsRest) return `const ${tmp}=${r},${mixed[1]}=${tmp}.default,${nsRest[1]}=${tmp};`;
        const inner = parts(rest.replace(/^\{|\}$/g, '')).map((e) => {
          const a = alias(e); return `${a.local}:${a.exported}`;
        }).join(',');
        return `const ${tmp}=${r},${mixed[1]}=${tmp}.default,{${inner}}=${tmp};`;
      }
      return `const ${clause}=(${r}).default;`;
    });

  // bare  import '<spec>'
  out = out.replace(/^[ \t]*import\s*['"]([^'"]+)['"]\s*;?/gm, (_w, spec) => `${req(spec)};`);

  // export default
  out = out.replace(/^[ \t]*export\s+default\s+/gm, '__e.default = ');

  // export const/let/var/function/class/async function
  out = out.replace(/^([ \t]*)export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (_w, ind, kw, name) => `${ind}${kw} ${name}`);
  out = out.replace(/^([ \t]*)export\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_w, ind, kw, name) => `${ind}${kw} ${name}`);

  // export { a, b as c }
  //
  // Anchored to a statement BOUNDARY rather than a line start. three.module.min.js
  // is a single 650KB line whose one export statement sits at the very end, so a
  // `^`-anchored pattern silently skips it and the bundle dies with
  // `Unexpected token 'export'` — which is exactly how the first attempt failed.
  out = out.replace(/(^|[;}])[ \t]*export\s*\{([^}]*)\}\s*;?/gm, (_w, pre, list) =>
    pre + parts(list).map((e) => { const a = alias(e); return `__e.${a.exported}=${a.local};`; }).join(''));

  // Re-attach the declarations whose `export` keyword was just stripped.
  const declared = [];
  for (const re of [/^[ \t]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
                    /^[ \t]*(?:async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm]) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(src))) if (/^[ \t]*export\s/.test(lineAt(src, m.index))) declared.push(m[1]);
  }
  // `export const X` matches the second scan too, so dedupe.
  const uniq = [...new Set(declared)];
  if (uniq.length) out += `\n${uniq.map((n) => `__e.${n}=${n};`).join('')}\n`;

  return out;
}

function lineAt(s, i) {
  const start = s.lastIndexOf('\n', i) + 1;
  const end = s.indexOf('\n', i);
  return s.slice(start, end === -1 ? undefined : end);
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function collect(rel) {
  if (modules.has(rel)) return;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  modules.set(rel, src);
  const re = /(?:\bfrom\s*|\bimport\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const t = resolve(m[2], rel);
    if (t) collect(t);
  }
}

const RUNTIME = `
const __defs = Object.create(null);
const __cache = Object.create(null);
function __def(id, fn) { __defs[id] = fn; }
function __missing(spec) { throw new Error('unbundled import: ' + spec); }
function __req(id) {
  if (id in __cache) return __cache[id];
  const fn = __defs[id];
  if (!fn) throw new Error('module not in bundle: ' + id);
  // Registered before evaluation so an import cycle sees the partial namespace
  // rather than recursing forever — the same shape the native loader gives.
  const e = __cache[id] = {};
  fn(e, __req);
  return e;
}
`;

function main() {
  collect(ENTRY);

  const chunks = [RUNTIME];
  for (const [rel, src] of modules) {
    const body = transform(rel, src);
    // `export{` has no whitespace after the keyword, so a `\s`-based guard misses
    // precisely the minified case that breaks the build. Match on the statement
    // boundary and on what legally follows the keyword instead.
    const leftover = body.match(
      /(?:^|[;}])[ \t]*(?:export\s*[{*]|export\s+(?:default|const|let|var|function|class|async)\b|import\s*[{'"*]|import\s+[A-Za-z_$])/gm);
    if (leftover) {
      throw new Error(`untransformed statement in ${rel}:\n  ${leftover.slice(0, 3).join('\n  ')}`);
    }
    chunks.push(`__def(${JSON.stringify(rel)}, function (__e, __req) {\n${body}\n});`);
  }
  chunks.push(`__req(${JSON.stringify(ENTRY)});`);
  const script = chunks.join('\n');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/ui/hud.css'), 'utf8');

  const out = html
    .replace(/<link[^>]*hud\.css[^>]*>/i, `<style>\n${css}\n</style>`)
    // The importmap existed only to resolve bare specifiers; nothing imports by
    // URL any more.
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
    // The boot script keeps its error handlers and gains the whole game inline.
    .replace(/import\((['"])\.\/src\/main\.js\1\)\.catch\(show\);/,
             `try {\n${script}\n} catch (e) { show(e && e.stack || e); }`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);

  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`${modules.size} modules bundled`);
  if (skipped.size) {
    console.log(`  ${skipped.size} non-module specifier(s) left alone (doc-comment examples):`);
    for (const k of skipped) console.log(`    ${k}`);
  }
  console.log(`  out       ${OUT}  (${kb(Buffer.byteLength(out))})`);

  if (!out.includes('__req("src/main.js")')) throw new Error('entry point was not injected');
  // Strip script and style BODIES but keep their opening tags, so a real
  // `<script src=...>` is still caught while prose inside them is not. Several
  // modules quote markup in their doc headers — including hud.css's header, which
  // cites the <link> tag it used to be loaded by — and those now live inside the
  // inlined script rather than outside it.
  const structural = out
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>')
    .replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/gi, '$1</style>')
    .replace(/<!--[\s\S]*?-->/g, '');
  const ext = structural.match(/<(?:link|script|img)[^>]*(?:src|href)=["'][^"']*["'][^>]*>/gi);
  if (ext) throw new Error('bundle still references external files:\n  ' + ext.join('\n  '));
  if (/type="importmap"/.test(out)) throw new Error('importmap survived');
}

main();
