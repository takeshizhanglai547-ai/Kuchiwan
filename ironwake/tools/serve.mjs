#!/usr/bin/env node
// tools/serve.mjs — tiny static file server for the dev build (index.html + importmap).
//
//   node tools/serve.mjs [--port 0] [--root <dir>]   -> prints the URL (port 0 = random free)
//   import { start } from './serve.mjs'; const s = await start(); s.url; await s.stop();
//
// Binds 127.0.0.1 on a RANDOM free port by default (listen(0)) so parallel harness runs
// never collide. No caching headers (always fresh). Paths are confined to the root.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.hdr': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

export function start({ port = 0, root = ROOT_DEFAULT, host = '127.0.0.1', quiet = true } = {}) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(path.resolve(root))) { res.writeHead(403); res.end('forbidden'); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          if (!quiet) console.log('404', p);
          res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
      });
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const url = `http://${host}:${addr.port}/`;
      resolve({
        url, port: addr.port, server,
        stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const port = Number(get('--port', process.env.PORT || 0));
  const root = path.resolve(get('--root', ROOT_DEFAULT));
  start({ port, root, quiet: false }).then((s) => {
    console.log(`IRONWAKE dev server: ${s.url}  (root ${root})`);
    console.log(`  play:  ${s.url}index.html`);
    console.log(`  test:  ${s.url}index.html?test=1&shot=gameplay_chase`);
    console.log('Ctrl+C to stop.');
  });
}
