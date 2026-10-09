/**
 * Site-wide SEO settings, redirects, static-page SEO overrides and
 * term (category / tag / author) SEO – stored in content/seo.json.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const cfg = require('./config');
const store = require('./store');

const SEO_FILE = path.join(cfg.CONTENT_DIR, 'seo.json');

const DEFAULTS = {
  separator: '-',
  postTitle: '%title% %sep% %sitename%',
  pageTitle: '%title% %sep% %sitename%',
  archiveTitle: '%term% %sep% %sitename%',
  pagedTitle: '%term% %sep% Page %page% of %pages% %sep% %sitename%',
  defaultOgImage: '/wp-content/uploads/2024/07/Stars777-Logo.webp',
  twitterSite: '',
  facebookUrl: '',
  schemaType: 'Organization', // Organization | Person
  orgName: 'Stars777',
  orgLogo: '/wp-content/uploads/2024/07/Stars777-Logo.webp',
  sameAs: [],
  articleSchema: 'BlogPosting', // default for new posts
  verification: { google: '', bing: '', yandex: '', pinterest: '', baidu: '' },
  headCode: '',
  index: { categories: true, tags: true, authors: true, paginated: true },
  sitemap: { posts: true, pages: true, categories: true, tags: true, authors: false },
  rss: true,
  robotsTxt: '',
  redirects: [], // { from, to, type }
  terms: {},     // "categories:blog" -> { title, description, noindex }
  pages: {},     // "/path/" -> { title, description, canonical, noindex, nofollow, ogTitle, ogDescription, ogImage, orig:{...} }
};

function get() {
  const s = store.readJson(SEO_FILE, {});
  return {
    ...DEFAULTS, ...s,
    verification: { ...DEFAULTS.verification, ...(s.verification || {}) },
    index: { ...DEFAULTS.index, ...(s.index || {}) },
    sitemap: { ...DEFAULTS.sitemap, ...(s.sitemap || {}) },
    redirects: s.redirects || [], terms: s.terms || {}, pages: s.pages || {}, sameAs: s.sameAs || [],
  };
}
function save(s) { store.writeJson(SEO_FILE, s); rebuildRedirectMap(); return s; }

/* ---------- titles ---------- */
function titleFrom(tpl, vars) {
  const s = get();
  return String(tpl || '')
    .replace(/%sep%/g, s.separator)
    .replace(/%sitename%/g, cfg.SITE_NAME)
    .replace(/%title%/g, vars.title || '')
    .replace(/%term%/g, vars.term || '')
    .replace(/%page%/g, vars.page || '')
    .replace(/%pages%/g, vars.pages || '')
    .replace(/\s+/g, ' ').trim();
}

/* ---------- redirects ---------- */
const normPath = (p) => {
  let x = String(p || '').trim();
  try { x = new URL(x, 'http://x').pathname; } catch {}
  try { x = decodeURI(x); } catch {}
  if (!/\.[a-z0-9]+$/i.test(x) && !x.endsWith('/')) x += '/';
  return x.startsWith('/') ? x : '/' + x;
};

let redirectMap = new Map();
function rebuildRedirectMap() {
  redirectMap = new Map(get().redirects.map((r) => [normPath(r.from), r]));
}
function findRedirect(reqPath) { return redirectMap.get(normPath(reqPath)); }

function addRedirect(from, to, type = 301) {
  const s = get();
  const f = normPath(from), t = /^https?:/i.test(to) ? to : normPath(to);
  if (f === t) return;
  s.redirects = s.redirects
    .filter((r) => normPath(r.from) !== f && normPath(r.from) !== t)      // replace + avoid loops
    .map((r) => (normPath(r.to) === f ? { ...r, to: t } : r));             // collapse chains
  s.redirects.unshift({ from: f, to: t, type, created: new Date().toISOString() });
  save(s);
}

/** Remove any redirect whose source is `from` (e.g. a live post now uses that URL). */
function removeRedirect(from) {
  const s = get();
  const f = normPath(from);
  const before = s.redirects.length;
  s.redirects = s.redirects.filter((r) => normPath(r.from) !== f);
  if (s.redirects.length !== before) save(s);
}

/* ---------- global <head> block (verification, RSS, custom code) ---------- */
function globalHead() {
  const s = get();
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const v = s.verification;
  return [
    v.google && `<meta name="google-site-verification" content="${esc(v.google)}" />`,
    v.bing && `<meta name="msvalidate.01" content="${esc(v.bing)}" />`,
    v.yandex && `<meta name="yandex-verification" content="${esc(v.yandex)}" />`,
    v.pinterest && `<meta name="p:domain_verify" content="${esc(v.pinterest)}" />`,
    v.baidu && `<meta name="baidu-site-verification" content="${esc(v.baidu)}" />`,
    s.twitterSite && `<meta name="twitter:site" content="${esc(s.twitterSite.startsWith('@') ? s.twitterSite : '@' + s.twitterSite)}" />`,
    s.facebookUrl && `<meta property="article:publisher" content="${esc(s.facebookUrl)}" />`,
    s.rss && `<link rel="alternate" type="application/rss+xml" title="${esc(cfg.SITE_NAME)} &raquo; Feed" href="/feed/" />`,
    s.headCode,
  ].filter(Boolean).join('\n');
}
const wrapGlobal = () => `<!--cms:global-->\n${globalHead()}\n<!--/cms:global-->`;

/* ---------- static (non-blog) pages ---------- */
function staticPages() {
  const manifest = store.readJson(cfg.MANIFEST_FILE, { posts: [], archives: [] });
  const skip = new Set([...(manifest.posts || []), ...(manifest.pages || [])]);
  const skipArch = (manifest.archives || []);
  const out = [];
  const walk = (dir, rel) => {
    const file = path.join(dir, 'index.html');
    if (fs.existsSync(file)) out.push({ path: '/' + rel, file });
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = `${rel}${e.name}/`;
      if (!rel && (/^(wp-content|wp-includes|admin|api|category|tag|author|feed)$/.test(e.name) || skip.has(e.name))) continue;
      if (e.name === 'page' || skipArch.some((a) => r.startsWith(a + '/'))) continue;
      walk(path.join(dir, e.name), r);
    }
  };
  walk(cfg.SITE_DIR, '');
  return out;
}

function readHeadInfo(file) {
  const html = fs.readFileSync(file, 'utf8');
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || 60000);
  const pick = (re) => { const m = re.exec(head); return m ? cheerio.load(`<i>${m[1]}</i>`)('i').text() : ''; };
  return {
    title: pick(/<title>([\s\S]*?)<\/title>/i),
    description: pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i),
    robots: pick(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i),
    canonical: pick(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
    ogTitle: pick(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i),
    ogDescription: pick(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i),
    ogImage: pick(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i),
  };
}

function listPages() {
  const s = get();
  return staticPages().map((p) => {
    const info = readHeadInfo(p.file);
    const o = s.pages[p.path] || {};
    return { path: p.path, ...info, override: o };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function setMeta($, attr, key, value) {
  let el = $(`head meta[${attr}="${key}"]`);
  if (!value) { el.remove(); return; }
  if (!el.length) { $('head > title').after(`\n<meta ${attr}="${key}" content="">`); el = $(`head meta[${attr}="${key}"]`); }
  el.first().attr('content', value); el.slice(1).remove();
}

function savePage(pagePath, data) {
  const page = staticPages().find((p) => p.path === pagePath);
  if (!page) throw new Error('Page not found');
  const s = get();
  const prev = s.pages[pagePath] || {};
  const orig = prev.orig || readHeadInfo(page.file); // remember original values once
  const fields = ['title', 'description', 'canonical', 'ogTitle', 'ogDescription', 'ogImage'];
  const o = { orig };
  for (const f of fields) o[f] = String(data[f] || '').trim();
  o.noindex = !!data.noindex;
  o.nofollow = !!data.nofollow;
  s.pages[pagePath] = o;
  save(s);
  applyPage(page.file, pagePath, o);
  return o;
}

function applyPage(file, pagePath, o) {
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
  const val = (f) => o[f] || (o.orig && o.orig[f]) || '';
  const absu = (u) => (u && u.startsWith('/') ? cfg.SITE_URL + u : u);
  const title = val('title');
  if (title) $('head > title').first().text(title);
  setMeta($, 'name', 'description', val('description'));
  const robots = [o.noindex ? 'noindex' : 'index', o.nofollow ? 'nofollow' : 'follow'];
  if (!o.noindex) robots.push('max-snippet:-1', 'max-video-preview:-1', 'max-image-preview:large');
  setMeta($, 'name', 'robots', robots.join(', '));
  const canon = o.canonical ? absu(o.canonical) : (o.orig && o.orig.canonical) || cfg.SITE_URL + pagePath;
  let link = $('head link[rel="canonical"]');
  if (!link.length) { $('head > title').after('\n<link rel="canonical" href="">'); link = $('head link[rel="canonical"]'); }
  link.attr('href', canon);
  const ogT = o.ogTitle || title, ogD = o.ogDescription || val('description');
  setMeta($, 'property', 'og:title', ogT);
  setMeta($, 'property', 'og:description', ogD);
  setMeta($, 'name', 'twitter:title', ogT);
  setMeta($, 'name', 'twitter:description', ogD);
  if (o.ogImage) {
    ['og:image:width', 'og:image:height', 'og:image:type', 'og:image:alt'].forEach((k) => $(`head meta[property="${k}"]`).remove());
    setMeta($, 'property', 'og:image', absu(o.ogImage));
    setMeta($, 'property', 'og:image:secure_url', absu(o.ogImage));
    setMeta($, 'name', 'twitter:image', absu(o.ogImage));
  }
  fs.writeFileSync(file, $.html());
}

/** Inject the global head block into every static page (and fix the domain if SITE_URL changed). */
function applyGlobalToStatic() {
  const block = wrapGlobal();
  let changed = 0;
  const files = staticPages().map((p) => p.file);
  const nf = path.join(cfg.SITE_DIR, '404.html');
  if (fs.existsSync(nf)) files.push(nf); // not a sitemap page, but still needs tracking / custom head code
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    let out = html.replace(/\n?<!--cms:global-->[\s\S]*?<!--\/cms:global-->/, '');
    const i = out.search(/<\/head>/i);
    if (i === -1) continue;
    let head = out.slice(0, i), rest = out.slice(i);
    if (cfg.SITE_URL !== cfg.ORIGIN) head = head.split(cfg.ORIGIN).join(cfg.SITE_URL);
    out = `${head}${block}\n${rest}`;
    if (out !== html) { fs.writeFileSync(file, out); changed++; }
  }
  return changed;
}

rebuildRedirectMap();

module.exports = {
  DEFAULTS, get, save, titleFrom, normPath, findRedirect, addRedirect, removeRedirect, rebuildRedirectMap,
  globalHead, wrapGlobal, staticPages, listPages, savePage, applyGlobalToStatic, readHeadInfo,
};
