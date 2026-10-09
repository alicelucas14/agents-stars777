#!/usr/bin/env node
/**
 * Local preview server for the static mirror.
 * Any asset that is missing locally (e.g. Elementor lazy-loaded JS chunks that the
 * crawler can't discover statically) is fetched from the live site, saved into the
 * mirror, and served — so browsing the preview "heals" the mirror.
 *
 * Usage: node tools/serve.js [port] [siteDir]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://agents.stars777.org';
const PORT = +(process.argv[2] || 8777);
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'site'));
const FILL = !process.env.NO_FILL;

const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', txt: 'text/plain', xml: 'application/xml',
};
const filled = [];

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file) && FILL && /\.[a-z0-9]+$/i.test(p) && !p.endsWith('.html')) {
    try {
      const r = await fetch(ORIGIN + p);
      if (r.ok) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        filled.push(p);
        console.log(`filled ${p}`);
      }
    } catch {}
  }
  if (!fs.existsSync(file)) {
    console.log(`404    ${p}`);
    return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}  (auto-fill ${FILL ? 'on' : 'off'})`));
