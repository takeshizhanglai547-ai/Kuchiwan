// Single-file bundler for ASHVEIL.
//
// The game ships as ~25 ES modules plus a vendored three.js. Anywhere that can
// only host ONE file (an artifact page, an email attachment, a USB stick) needs
// all of that collapsed into a single .html.
//
// The approach deliberately does NOT transform module syntax. Rewriting ESM into
// a CommonJS-style runtime means regex-editing minified third-party code, which
// is how bundlers produce silent breakage. Instead every module keeps its exact
// source and only its import SPECIFIERS are rewritten, from relative paths to
// bare ids, with an inline importmap pointing each bare id at a base64 data: URL.
//
// That leaves the browser's own module loader doing the graph resolution, so
// circular imports, live bindings and execution order all behave exactly as they
// do when the files are served individually.
//
// usage: node tools/bundle.js [outfile]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'src/main.js';
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'ashveil.html');

/** Resolve an import specifier, as written inside `fromRel`, to a repo-relative path. */
const skipped = new Set();

function resolve(spec, fromRel) {
  let rel = null;
  if (spec === 'three') rel = 'vendor/three.module.min.js';
  else if (spec.startsWith('three/addons/')) {
    rel = path.posix.join('vendor/jsm', spec.slice('three/addons/'.length));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  }
  if (!rel) return null;                       // bare specifier we do not vendor
  // The specifier regex cannot tell code from prose, and several modules carry
  // doc headers containing example import lines. Resolving against the real tree
  // is what separates them: a path that does not exist on disk was never an
  // import. Reported rather than silently dropped, so a genuine broken import
  // does not hide among them.
  if (!fs.existsSync(path.join(ROOT, rel))) {
    skipped.add(`${fromRel}: ${spec}`);
    return null;
  }
  return rel;
}

// Matches the specifier in `import ... from '<spec>'`, `export ... from '<spec>'`
// and bare `import '<spec>'`. Deliberately narrow: it only ever touches the
// quoted string that follows from/import, never the surrounding code.
const SPEC_RE = /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g;

const modules = new Map();   // relPath -> source

function collect(rel) {
  if (modules.has(rel)) return;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  modules.set(rel, src);

  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(src))) {
    const target = resolve(m[3], rel);
    if (target) collect(target);
  }
}

const id = (rel) => 'av:' + rel;

function rewrite(rel, src) {
  SPEC_RE.lastIndex = 0;
  return src.replace(SPEC_RE, (whole, kw, q, spec) => {
    const target = resolve(spec, rel);
    return target ? `${kw}${q}${id(target)}${q}` : whole;
  });
}

function dataUrl(src) {
  return 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
}

function main() {
  collect(ENTRY);

  const imports = {};
  for (const [rel, src] of modules) imports[id(rel)] = dataUrl(rewrite(rel, src));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/ui/hud.css'), 'utf8');

  let out = html
    // inline the stylesheet
    .replace(/<link[^>]*hud\.css[^>]*>/i, `<style>\n${css}\n</style>`)
    // replace the file-served importmap with the data: one
    .replace(/<script type="importmap">[\s\S]*?<\/script>/,
             `<script type="importmap">\n${JSON.stringify({ imports }, null, 0)}\n</script>`)
    // and the entry point, which is a dynamic import inside the inline boot
    // script rather than a <script src> — the boot overlay needs the rejection
    // handler wrapped around it so a failure shows on screen instead of leaving
    // a black canvas.
    .replace(/import\((['"])\.\/src\/main\.js\1\)/,
             `import(${JSON.stringify(id(ENTRY))})`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);

  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`${modules.size} modules bundled`);
  if (skipped.size) {
    console.log(`  ${skipped.size} non-module specifier(s) left alone (doc-comment examples):`);
    for (const k of skipped) console.log(`    ${k}`);
  }
  console.log(`  entry     ${ENTRY}`);
  console.log(`  out       ${OUT}  (${kb(Buffer.byteLength(out))})`);
  if (!/av:src\/main\.js/.test(out)) throw new Error('entry point was not injected');
  // Guard against a real leftover reference, without tripping over prose: the
  // inlined stylesheet's own header comment quotes the <link> tag it used to be
  // loaded by. Strip style and comment content before checking for actual tags.
  const structural = out
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const leftover = structural.match(/<(?:link|script|img)[^>]*(?:src|href)=["'](?!data:|av:)[^"']*["'][^>]*>/gi);
  if (leftover) {
    throw new Error('bundle still references external files:\n  ' + leftover.join('\n  '));
  }
}

main();
