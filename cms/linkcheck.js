/**
 * Broken-link checker (admin → Link checker, super admin only).
 *
 * Reads every page in sitemap.xml as visitors get it (site/<path>/index.html), collects the links (<a href>)
 * and pictures (<img src / data-src>) and checks each address once:
 *   - addresses on this site are asked of the running server itself (so redirects, old WordPress paths and the
 *     404 page behave exactly as for a visitor),
 *   - addresses on other sites are fetched with a HEAD request (GET when a site doesn't like HEAD), following up
 *     to 5 redirects; one request at a time per site with a short pause, and at most 6 sites at once – gently.
 *
 * Fetching addresses that someone typed into a post is a classic way to make a server probe its own network, so
 * outside requests are only made to PUBLIC addresses: the name is looked up first, and if any answer is a private,
 * loopback, link-local, carrier-grade-NAT or metadata address the link is reported as "points to a private address"
 * and nothing is sent. The connection then goes to the very address that was checked (no second lookup).
 *
 * Result of a run: only the problems are kept (content/linkcheck.json, not committed) plus the totals.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const cfg = require('./config');
const store = require('./store');

const RESULT_FILE = path.join(cfg.CONTENT_DIR, 'linkcheck.json');
const UA = 'BigAgentsLinkChecker/1.0';
const MAX_URLS = 6000;       // safety valve
const MAX_PAGES_PER_URL = 8; // "found on" pages kept per address

/* ---------- which addresses may be contacted ---------- */
const v4 = (ip) => ip.split('.').map(Number);
function privateV4(ip) {
  const [a, b, c] = v4(ip);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
function expandV6(ip) {
  let s = ip.split('%')[0].toLowerCase();
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const [a, b, c, d] = v4(m[1]); s = s.slice(0, -m[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map((g) => parseInt(g || '0', 16));
}
/** true when the address is a normal, publicly routable one */
function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return !privateV4(ip);
  if (!net.isIPv6(ip)) return false;
  const g = expandV6(ip);
  const embedded = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return !privateV4(embedded(g[6], g[7]));  // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return !privateV4(embedded(g[6], g[7])); // NAT64
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return false;          // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return false;  // fc00::/7, fe80::/10, ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;                                                       // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false;                                  // 100::/64
  return true;
}

/** `lookup` for http(s).request: resolve, refuse non-public answers, hand back an address that was checked. */
const guardedLookup = (allowPrivate) => (hostname, options, cb) => {
  const callback = typeof options === 'function' ? options : cb;
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!allowPrivate && addrs.some((a) => !isPublicAddress(a.address))) {
      const e = new Error('points to a private address'); e.code = 'EBLOCKED'; return callback(e);
    }
    if (opts.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
};

/* ---------- reading the pages ---------- */
const decodeEntities = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function sitemapPaths(siteDir) {
  const file = path.join(siteDir, 'sitemap.xml');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try { out.push(decodeURI(new URL(decodeEntities(m[1])).pathname)); } catch { /* skip */ }
  }
  return [...new Set(out)];
}
const pageFile = (siteDir, p) => path.join(siteDir, ...p.split('/').filter(Boolean), 'index.html');

/** Links and pictures in one page: [{ kind: 'link'|'image', raw }] */
function extract(html) {
  const text = String(html)
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const out = [];
  const grab = (tagRe, attrRe, kind) => {
    for (const t of text.matchAll(tagRe)) {
      const m = attrRe.exec(t[0]);
      if (m) out.push({ kind, raw: decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).trim() });
    }
  };
  grab(/<a\s[^>]*>/gi, /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i, 'link');
  for (const attr of ['src', 'data-src']) grab(/<img\s[^>]*>/gi, new RegExp(`\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'), 'image');
  return out;
}

/* ---------- checking one address ---------- */
const BLOCKED_CODES = new Set([401, 403, 429, 999]);
const TLS_CODES = /^(CERT_|ERR_TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH|ERR_SSL|EPROTO)/;
const friendly = (e) => {
  const c = e && e.code;
  if (c === 'EBLOCKED') return { result: 'broken', message: 'The address points to a private network – not checked.' };
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'ENODATA') return { result: 'broken', message: 'The domain does not exist (or has no address).' };
  if (c === 'ECONNREFUSED') return { result: 'broken', message: 'The server refused the connection.' };
  if (c && TLS_CODES.test(c)) return { result: 'broken', message: `Security certificate problem (${c.replace(/^ERR_TLS_|^CERT_/, '').toLowerCase().replace(/_/g, ' ')}).` };
  if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT' || (e && e.message === 'timeout')) return { result: 'unreachable', message: 'No answer in time (may be temporary).' };
  if (c === 'ECONNRESET' || c === 'EPIPE' || c === 'ECONNABORTED') return { result: 'unreachable', message: 'The connection was cut (may be temporary).' };
  return { result: 'unreachable', message: `Could not be reached (${c || (e && e.message) || 'error'}).` };
};

const active = new Set(); // requests in flight, so "Stop" can cut them off at once

/** One request. Resolves { code, location } or rejects with the network error. No body is read. */
function request(urlStr, { method, timeoutMs, allowPrivate, hostHeader }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const bare = u.hostname.replace(/^\[|\]$/g, ''); // IPv6 literals come with brackets
    // Node skips `lookup` for a raw IP address, so an address typed straight into a link (http://169.254.169.254/…) must be checked here
    if (!hostHeader && !allowPrivate && net.isIP(bare) && !isPublicAddress(bare)) {
      return reject(Object.assign(new Error('points to a private address'), { code: 'EBLOCKED' }));
    }
    const opt = {
      method, hostname: bare, port: u.port || undefined, path: u.pathname + u.search,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}), ...(hostHeader ? { Host: hostHeader } : {}) },
      timeout: timeoutMs, servername: net.isIP(u.hostname) ? undefined : u.hostname,
    };
    if (!hostHeader) opt.lookup = guardedLookup(allowPrivate);
    const req = lib.request(opt, (res) => {
      res.destroy(); // headers are enough
      resolve({ code: res.statusCode, location: res.headers.location || '' });
    });
    active.add(req); req.on('close', () => active.delete(req));
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** Follow redirects by hand (each hop is checked like the first). { code, finalUrl, hops, error } */
async function probe(urlStr, o) {
  let url = urlStr, hops = 0;
  for (;;) {
    let r;
    try { r = await request(url, { ...o, method: 'HEAD' }); } catch (e) { r = { error: e }; }
    // many sites answer HEAD with an error or nothing at all: ask again properly before judging
    if (r.error || [400, 403, 404, 405, 406, 429, 500, 501, 503, 999].includes(r.code)) {
      try { const g = await request(url, { ...o, method: 'GET' }); r = g; } catch (e) { if (r.error) r = { error: e }; }
    }
    if (r.error) return { error: r.error, finalUrl: url, hops };
    if (r.code >= 300 && r.code < 400 && r.location) {
      if (++hops > 5) return { code: r.code, finalUrl: url, hops, tooMany: true };
      try { url = new URL(r.location, url).toString(); } catch { return { code: r.code, finalUrl: url, hops, badLocation: true }; }
      if (!/^https?:/i.test(url)) return { code: r.code, finalUrl: url, hops, badLocation: true };
      continue;
    }
    return { code: r.code, finalUrl: url, hops };
  }
}

/**
 * Same as probe() for an address on THIS site: the request goes to the running server on 127.0.0.1 with the site's
 * Host header. A redirect to another site is reported, not followed (nothing leaves the machine from here).
 */
async function probeLocal(publicUrl, o) {
  const siteBare = o.siteHost.replace(/:\d+$/, '').toLowerCase();
  let pub = publicUrl, hops = 0;
  for (;;) {
    const u = new URL(pub);
    const target = `http://127.0.0.1:${o.port}${u.pathname}${u.search}`;
    const ask = (method) => request(target, { method, timeoutMs: o.timeoutMs, hostHeader: o.siteHost });
    let r;
    try { r = await ask('HEAD'); } catch (e) { r = { error: e }; }
    if (r.error || r.code === 405 || r.code === 501) { try { r = await ask('GET'); } catch (e) { r = { error: e }; } }
    if (r.error) return { error: r.error, finalUrl: pub, hops };
    if (r.code >= 300 && r.code < 400 && r.location) {
      if (++hops > 5) return { code: r.code, finalUrl: pub, hops, tooMany: true };
      let next;
      try { next = new URL(r.location, pub); } catch { return { code: r.code, finalUrl: pub, hops, badLocation: true }; }
      if (next.hostname.toLowerCase() !== siteBare) return { code: r.code, finalUrl: next.toString(), hops, leftSite: true };
      pub = next.toString();
      continue;
    }
    return { code: r.code, finalUrl: pub, hops };
  }
}

function judge(url, p) {
  if (p.error) return { ...friendly(p.error), code: 0 };
  if (p.leftSite) return { result: 'redirect', code: p.code, finalUrl: p.finalUrl, message: `Redirects to ${p.finalUrl}` };
  if (p.tooMany) return { result: 'broken', code: p.code, message: 'Too many redirects (a loop?).' };
  if (p.badLocation) return { result: 'broken', code: p.code, message: 'A redirect leads nowhere usable.' };
  const c = p.code;
  if (c >= 200 && c < 300) {
    if (p.hops > 0 && !sameLocation(url, p.finalUrl)) return { result: 'redirect', code: c, finalUrl: p.finalUrl, message: `Redirects to ${p.finalUrl}` };
    return { result: 'ok', code: c };
  }
  if (c >= 300 && c < 400) return { result: 'redirect', code: c, finalUrl: p.finalUrl, message: 'Redirect without a usable target.' };
  if (BLOCKED_CODES.has(c)) return { result: 'blocked', code: c, message: c === 429 ? 'The site is limiting requests – could not check.' : 'The site does not allow automatic checks – open it yourself to be sure.' };
  if (c === 404 || c === 410) return { result: 'broken', code: c, message: 'Page not found.' };
  if (c >= 500) return { result: 'broken', code: c, message: 'The site reports a server error.' };
  return { result: 'broken', code: c, message: `The site answered ${c}.` };
}
// http→https, adding/removing "www." or a trailing slash is a harmless move: still "ok" would hide it, so only call it
// "redirect" when the address really changes
function sameLocation(a, b) {
  const norm = (s) => { try { const x = new URL(s); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`.toLowerCase(); } catch { return s; } };
  return norm(a) === norm(b);
}

/* ---------- a run ---------- */
let state = idle();
function idle() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')); } catch { /* none yet */ }
  return { running: false, phase: 'idle', progress: { done: 0, total: 0 }, cancel: false, last: saved };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a run in the background. opts: { siteHost, siteUrl, port, siteDir, allowPrivate, timeoutMs, hostGapMs }
 * Returns false if one is already running.
 */
function start(opts = {}) {
  if (state.running) return false;
  const o = {
    siteDir: cfg.SITE_DIR, siteUrl: cfg.SITE_URL, siteHost: new URL(cfg.SITE_URL).host, port: cfg.PORT,
    allowPrivate: false, timeoutMs: 12000, hostGapMs: 400, ...opts,
  };
  state = { running: true, phase: 'reading pages', progress: { done: 0, total: 0 }, cancel: false, startedAt: new Date().toISOString(), last: state.last };
  run(o).catch((e) => { console.error('Link check failed:', e); state.running = false; state.phase = 'failed'; state.error = e.message; });
  return true;
}
const stop = () => {
  if (!state.running) return false;
  state.cancel = true;
  for (const r of active) r.destroy(Object.assign(new Error('stopped'), { code: 'ECONNABORTED' }));
  return true;
};

function status() {
  const { running, phase, progress, startedAt, error } = state;
  return { running, phase, progress, startedAt: startedAt || null, error: error || null, last: state.last };
}

async function run(o) {
  const siteHostBare = o.siteHost.replace(/:\d+$/, '').toLowerCase();
  const found = new Map(); // absolute url -> { kind, internal, pages:Set, count }
  const pages = sitemapPaths(o.siteDir);
  let pageNo = 0;
  for (const p of pages) {
    if (state.cancel) break;
    let html = '';
    try { html = fs.readFileSync(pageFile(o.siteDir, p), 'utf8'); } catch { continue; }
    for (const { kind, raw } of extract(html)) {
      if (!raw || raw.startsWith('#') || /^(mailto|tel|sms|javascript|data|whatsapp|tg|viber|skype|intent|market|blob):/i.test(raw)) continue;
      let abs;
      try { abs = new URL(raw.startsWith('//') ? `https:${raw}` : raw, o.siteUrl + p).toString(); } catch { continue; }
      if (!/^https?:/i.test(abs)) continue;
      abs = abs.split('#')[0];
      const internal = new URL(abs).hostname.toLowerCase() === siteHostBare;
      let e = found.get(abs);
      if (!e) { if (found.size >= MAX_URLS) continue; e = { kind, internal, pages: new Set(), count: 0 }; found.set(abs, e); }
      if (kind === 'link') e.kind = 'link';
      e.count++; if (e.pages.size < MAX_PAGES_PER_URL) e.pages.add(p);
    }
    if (++pageNo % 15 === 0) await sleep(0); // let the site answer visitors meanwhile
  }

  const entries = [...found.entries()].map(([url, e]) => ({ url, ...e, pages: [...e.pages] }));
  state.progress = { done: 0, total: entries.length };
  state.phase = 'checking';
  const results = [];
  const record = (e, j) => {
    state.progress.done++;
    results.push({ url: e.url, kind: e.kind, internal: e.internal, result: j.result, code: j.code || 0, message: j.message || '', finalUrl: j.finalUrl || '', pages: e.pages, count: e.count });
  };

  // 1) this site: ask the running server (fast, no outside traffic)
  const mine = entries.filter((e) => e.internal);
  let mi = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (mi < mine.length && !state.cancel) {
      const e = mine[mi++];
      const p = await probeLocal(e.url, o).catch((err) => ({ error: err }));
      record(e, judge(e.url, p)); // a redirect that ends well is still worth knowing about (an old address that is still linked)
    }
  }));

  // 2) other sites: one site at a time per worker, with a pause between requests to the same site
  const theirs = entries.filter((e) => !e.internal);
  const byHost = new Map();
  for (const e of theirs) { const h = new URL(e.url).hostname.toLowerCase(); if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(e); }
  const hostQueue = [...byHost.values()];
  let hi = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (hi < hostQueue.length && !state.cancel) {
      const list = hostQueue[hi++];
      for (const e of list) {
        if (state.cancel) break;
        let p = await probe(e.url, { timeoutMs: o.timeoutMs, allowPrivate: o.allowPrivate }).catch((err) => ({ error: err }));
        if (p.error && !state.cancel && friendly(p.error).result === 'unreachable') { await sleep(1000); p = await probe(e.url, { timeoutMs: o.timeoutMs, allowPrivate: o.allowPrivate }).catch((err) => ({ error: err })); }
        record(e, judge(e.url, p));
        await sleep(o.hostGapMs);
      }
    }
  }));

  const problems = results.filter((r) => r.result !== 'ok').sort((a, b) => order(a.result) - order(b.result) || b.count - a.count || a.url.localeCompare(b.url));
  const count = (k) => results.filter((r) => r.result === k).length;
  const last = {
    startedAt: state.startedAt, finishedAt: new Date().toISOString(), cancelled: state.cancel,
    pagesRead: pageNo, checked: results.length,
    stats: { ok: count('ok'), broken: count('broken'), redirect: count('redirect'), blocked: count('blocked'), unreachable: count('unreachable') },
    items: problems,
  };
  if (!state.cancel) try { store.writeJson(RESULT_FILE, last); } catch (e) { console.error('Could not save the link check result:', e.message); }
  state = { running: false, phase: state.cancel ? 'stopped' : 'done', progress: state.progress, cancel: false, startedAt: state.startedAt, last };
}
const order = (r) => ({ broken: 0, unreachable: 1, redirect: 2, blocked: 3 }[r] ?? 4);

module.exports = { start, stop, status, isPublicAddress, extract, sitemapPaths, probe, probeLocal, judge, guardedLookup };
