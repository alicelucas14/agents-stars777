#!/usr/bin/env node
/**
 * Static mirror of a WordPress site.
 *
 *  - Seeds from the homepage + Rank Math / WP sitemaps
 *  - Crawls every same-host page (no query strings)
 *  - Downloads CSS / JS / images / fonts / media (incl. url() refs inside CSS)
 *  - Rewrites same-host absolute URLs (plain and JSON-escaped) to relative paths
 *    so the result works from any static host or straight from disk.
 *
 * Usage: node tools/mirror.js [outDir]
 */
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://agents.stars777.org';
const HOST = new URL(ORIGIN).host;
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));
const CONCURRENCY = 6;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const ASSET_EXT = new Set([
  'css', 'js', 'mjs', 'map', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'webm', 'mp3', 'ogg', 'wav', 'pdf', 'json', 'txt', 'zip',
]);
const SKIP_PATH = [
  /^\/wp-json/, /^\/wp-admin/, /^\/wp-login\.php/, /^\/xmlrpc\.php/, /\/feed\/?$/, /\/embed\/?$/,
  /^\/wp-cron\.php/, /\/trackback\/?$/, /\.php$/,
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_RE = escRe(HOST);

const pages = new Map(); // url -> state
const assets = new Map();
const failures = [];

/* ---------- URL helpers ---------- */

function classify(u) {
  // returns { kind: 'page'|'asset'|null, url, local, hash }
  let url;
  try { url = new URL(u, ORIGIN); } catch { return { kind: null }; }
  if (url.host !== HOST) return { kind: null };
  const hash = url.hash;
  url.hash = '';
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { p = url.pathname; }
  if (SKIP_PATH.some((r) => r.test(p))) return { kind: null };
  if (/^\/wp-(content|includes)\/.*\/$/.test(p) || p === '/wp-content/') {
    // base folder used by JS (e.g. Elementor "assets" / upload URLs) – keep as a folder
    return { kind: 'dir', url: url.href, local: p.replace(/^\//, ''), hash };
  }
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (ext && ASSET_EXT.has(ext.toLowerCase())) {
    url.search = ''; // drop ?ver= cache busters
    return { kind: 'asset', url: url.href, local: p.replace(/^\//, ''), hash };
  }
  if (url.search) return { kind: null }; // ?s=, ?p= etc. – leave absolute
  if (ext && !/^html?$/i.test(ext)) return { kind: null };
  let local = p.replace(/^\//, '');
  if (!ext) local = (local && !local.endsWith('/') ? local + '/' : local) + 'index.html';
  url.pathname = url.pathname.replace(/\/?$/, ext ? '' : '/');
  return { kind: 'page', url: url.href, local, hash };
}

function rel(fromLocal, toLocal) {
  const isDir = toLocal.endsWith('/');
  let r = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
  if (isDir) return (r || '.') + '/';
  return r || path.posix.basename(toLocal);
}

function enqueue(info) {
  if (info.kind === 'dir') return;
  const map = info.kind === 'page' ? pages : assets;
  if (!map.has(info.url)) map.set(info.url, { local: info.local, done: false });
}

/* ---------- fetching ---------- */

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '', finalUrl: res.url };
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

function save(local, data) {
  const file = path.join(OUT, ...local.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/* ---------- rewriting ---------- */

function cleanMatch(m) {
  // cut at HTML-entity quotes / trailing punctuation picked up by the greedy regex
  const cut = m.search(/&quot;|&#0?39;|&#x27;|&#34;/);
  if (cut !== -1) m = m.slice(0, cut);
  const trail = m.match(/[,.;:!]+$/);
  return { url: trail ? m.slice(0, -trail[0].length) : m, rest: (trail ? trail[0] : '') };
}

function rewriteText(text, fromLocal, { discoverPages }) {
  // Plain absolute / protocol-relative URLs
  const plain = new RegExp(`(?:https?:)?//${HOST_RE}(?:/[^"'\\s()<>\`\\\\]*)?`, 'g');
  text = text.replace(plain, (m0) => {
    const { url, rest } = cleanMatch(m0);
    const tail = m0.slice(url.length + rest.length);
    const info = classify(url.startsWith('//') ? 'https:' + url : url);
    if (!info.kind) return m0;
    if (info.kind === 'page' && !discoverPages) return m0;
    enqueue(info);
    return rel(fromLocal, info.local) + info.hash + rest + tail;
  });
  // JSON-escaped URLs:  https:\/\/host\/path
  const escaped = new RegExp(`(?:https?:)?\\\\/\\\\/${HOST_RE}((?:\\\\/|\\\\u[0-9a-fA-F]{4}|[^"'\\s()<>\\\\])*)`, 'g');
  text = text.replace(escaped, (m0, p) => {
    const unesc = 'https://' + HOST + p.replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const { url, rest } = cleanMatch(unesc);
    const info = classify(url);
    if (!info.kind) return m0;
    if (info.kind === 'page' && !discoverPages) return m0;
    enqueue(info);
    const out = rel(fromLocal, info.local) + info.hash + rest;
    // directory-style base URLs (e.g. elementor "assets/" base) must keep their trailing slash
    const needsSlash = p.endsWith('\\/') && !out.endsWith('/') && info.kind === 'asset';
    return (out + (needsSlash ? '/' : '')).replace(/\//g, '\\/');
  });
  return text;
}

function rewriteHtml(html, fromLocal) {
  // Protect SEO metadata so canonical / OG / schema keep pointing at the live domain
  const vault = [];
  const protect = (re) => {
    html = html.replace(re, (m) => `\u0000P${vault.push(m) - 1}\u0000`);
  };
  protect(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi);
  protect(/<meta\b[^>]*>/gi);
  protect(/<link\b[^>]*rel=["'](?:canonical|shortlink|alternate|EditURI|https:\/\/api\.w\.org\/)["'][^>]*>/gi);

  // Discover links from protected parts too (e.g. og:image) without rewriting them
  for (const m of vault.join('\n').matchAll(new RegExp(`https?://${HOST_RE}/[^"'\\s<>]*`, 'g'))) {
    const info = classify(m[0]);
    if (info.kind === 'asset') enqueue(info);
  }

  html = rewriteText(html, fromLocal, { discoverPages: true });

  // Root-relative refs (rare in WP, but handle src="/wp-content/...")
  html = html.replace(/(\s(?:src|href|data-src|poster)=["'])(\/[^/"'][^"']*)/gi, (m, a, p) => {
    const info = classify(ORIGIN + p);
    if (!info.kind) return m;
    enqueue(info);
    return a + rel(fromLocal, info.local) + info.hash;
  });

  return html.replace(/\u0000P(\d+)\u0000/g, (_, i) => vault[+i]);
}

function rewriteCss(css, cssUrl, fromLocal) {
  const fix = (raw) => {
    const ref = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!ref || /^(data:|#|about:)/i.test(ref)) return null;
    let abs;
    try { abs = new URL(ref, cssUrl).href; } catch { return null; }
    const info = classify(abs);
    if (info.kind !== 'asset') return null;
    enqueue(info);
    return rel(fromLocal, info.local) + (new URL(abs).hash || '');
  };
  css = css.replace(/url\(\s*([^)]+?)\s*\)/gi, (m, r) => {
    const out = fix(r);
    return out ? `url("${out}")` : m;
  });
  css = css.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, r) => {
    const out = fix(r);
    return out ? `@import "${out}"` : m;
  });
  return css;
}

/* ---------- sitemap seeding ---------- */

async function seedSitemaps() {
  const seen = new Set();
  const queue = [`${ORIGIN}/sitemap_index.xml`, `${ORIGIN}/wp-sitemap.xml`, `${ORIGIN}/sitemap.xml`];
  while (queue.length) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml;
    try { xml = (await get(sm, 1)).buf.toString('utf8'); } catch { continue; }
    if (!/<(urlset|sitemapindex)/i.test(xml)) continue;
    for (const [, loc] of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/gi)) {
      const u = loc.trim();
      if (/\.xml(\?|$)/i.test(u)) queue.push(u);
      else {
        const info = classify(u);
        if (info.kind) enqueue(info);
      }
    }
    console.log(`  sitemap ${sm}`);
  }
}

/* ---------- worker loop ---------- */

async function processPage(url, st) {
  const { buf, type, finalUrl } = await get(url);
  if (!/html/i.test(type)) { save(st.local, buf); return; }
  if (new URL(finalUrl).host !== HOST) return; // redirected off-site
  save(st.local, rewriteHtml(buf.toString('utf8'), st.local));
  console.log(`page  ${st.local}`);
}

async function processAsset(url, st) {
  const isCss = /\.css$/i.test(st.local);
  if (!isCss && fs.existsSync(path.join(OUT, ...st.local.split('/')))) return; // already have it
  const { buf } = await get(url);
  if (isCss) save(st.local, rewriteCss(buf.toString('utf8'), url, st.local));
  else save(st.local, buf);
}

function hasPending() {
  for (const st of pages.values()) if (!st.done) return true;
  for (const st of assets.values()) if (!st.done) return true;
  return false;
}

function nextJob() {
  const wrap = (fn, url, st) => () =>
    fn(url, st).catch((e) => { throw new Error(`${e.message}  ${url}`); });
  for (const [url, st] of pages) if (!st.done) { st.done = true; return wrap(processPage, url, st); }
  for (const [url, st] of assets) if (!st.done) { st.done = true; return wrap(processAsset, url, st); }
  return null;
}

async function run() {
  console.log(`Mirroring ${ORIGIN} -> ${OUT}`);
  fs.mkdirSync(OUT, { recursive: true });
  enqueue(classify(ORIGIN + '/'));
  await seedSitemaps();

  let active = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (active < CONCURRENCY) {
        const job = nextJob();
        if (!job) break;
        active++;
        job()
          .catch((e) => failures.push(e.message))
          .finally(() => { active--; pump(); });
      }
      if (active === 0 && !hasPending()) resolve();
    };
    pump();
  });

  const report = {
    origin: ORIGIN,
    finishedAt: new Date().toISOString(),
    pages: [...pages.values()].map((p) => p.local).sort(),
    assetCount: assets.size,
    failures,
  };
  fs.writeFileSync(path.join(OUT, '_mirror-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nDone: ${pages.size} pages, ${assets.size} assets, ${failures.length} failures`);
  if (failures.length) console.log(failures.slice(0, 30).join('\n'));
}

run().catch((e) => { console.error(e); process.exit(1); });
