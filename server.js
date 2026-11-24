#!/usr/bin/env node
/**
 * Site + admin server.
 *   /            the static site (site/)
 *   /admin       blog admin panel (login required)
 *   /api/*       JSON API used by the admin panel
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const cfg = require('./cms/config');
const store = require('./cms/store');
const render = require('./cms/render');
const auth = require('./cms/auth');
const seo = require('./cms/seo');
const menu = require('./cms/menu');
const social = require('./cms/social');
const cleanhash = require('./cms/cleanhash');
const webpswap = require('./cms/webpswap');
const cfpurge = require('./cms/cfpurge');
const legacy = require('./cms/legacy');
const signups = require('./cms/signups');
const turnstile = require('./cms/turnstile');
const images = require('./cms/images');
const hosts = require('./cms/hosts');

auth.load(); // creates the first admin account if none exists

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ---------- HTTP -> HTTPS ----------
 * Only when a proxy (Cloudflare / Nginx) tells us the visitor used plain HTTP,
 * so local development on http://localhost is never redirected.
 * Set FORCE_HTTPS=0 to turn it off. */
app.use((req, res, next) => {
  if (process.env.FORCE_HTTPS === '0' || req.secure || !req.headers['x-forwarded-proto']) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).json({ error: 'HTTPS required' });
  // the admin address stays on itself; everything else goes to the public address
  const host = hosts.adminHost && hosts.hostOf(req) === hosts.adminHost ? hosts.adminHost : new URL(cfg.SITE_URL).host;
  res.redirect(301, `https://${host}${req.originalUrl}`);
});

app.use(compression({ threshold: 1024 }));

/* ---------- caching defaults ----------
 * Anything that does not set its own rule is "check with the server before reusing it", and
 * the admin API (sign-ups, posts) is never stored anywhere. Static files below override this
 * (30-day assets, revalidated pages). The server's nginx used to add `Cache-Control: no-cache`
 * to everything; saying it here keeps the site behaving the same without that line, and lets
 * Cloudflare keep images/CSS/JS in its cache instead of re-checking the server every time. */
app.use((req, res, next) => {
  res.setHeader('Cache-Control', req.path === '/api' || req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
});

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* ---------- /admin and /api exist in lower case only ----------
 * Express matches paths without regard to case, so "/ADMIN/" or "/Api/…" would reach them while
 * slipping past anything written for the exact path (the no-store rule above, Cloudflare and nginx
 * rules for /admin and /api). */
app.use((req, res, next) => {
  if (/^\/(?:admin|api)(?:\/|$)/i.test(req.path) && !/^\/(?:admin|api)(?:\/|$)/.test(req.path)) return notFound(req, res);
  next();
});

/* ---------- separate admin address (cms/hosts.js; only when an admin host is set) ---------- */
const ASSET_EXT = /\.(?:css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot)$/i;
if (hosts.adminHost) {
  app.use((req, res, next) => {
    const host = hosts.hostOf(req);
    const adminPath = /^\/(?:admin|api)(?:\/|$)/.test(req.path);
    if (host === hosts.adminHost) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (req.path === '/robots.txt') return res.type('text').send('User-agent: *\nDisallow: /\n');
      if (req.path === '/') return res.redirect(302, '/admin/');
      if (adminPath) return req.path === '/api/signup' ? notFound(req, res) : next(); // the registration form belongs to the public site
      if ((req.method === 'GET' || req.method === 'HEAD') && ASSET_EXT.test(req.path)) return next(); // what the editor and preview load
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(302, cfg.SITE_URL + req.originalUrl); // pages live on the public site
      return notFound(req, res);
    }
    if (host === hosts.siteHost && adminPath && req.path !== '/api/signup') return notFound(req, res);
    next();
  });
}

// JSON bodies: the public login + sign-up forms get a small limit; the 10 MB limit (long posts)
// only applies on the admin API, after the login check – so anonymous visitors can't send
// huge bodies for the server to parse.
const publicJson = express.json({ limit: '16kb' });
const adminJson = express.json({ limit: '10mb' });

/* ---------- build queue (serialises rebuilds) ---------- */
let building = Promise.resolve();
// a failed build must not block the ones queued after it
// after a good build, clear Cloudflare's copy of the pages (no-op unless Cloudflare is configured)
const rebuild = () => (building = building.catch(() => {}).then(() => render.buildAll()).then((r) => { cfpurge.schedule('rebuild'); return r; }).catch((e) => { console.error('Build failed:', e); throw e; }));

// the visitor's address: behind Cloudflare, req.ip is the Cloudflare edge shared by many visitors
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.ip || '');

/* ---------- auth ---------- */
// password checks run off the main thread; a cap on simultaneous checks keeps a flood of
// login attempts from tying up the threads the site also uses to read files
let loginsInFlight = 0;
const MAX_LOGINS_IN_FLIGHT = 2;
app.post('/api/login', publicJson, async (req, res, next) => {
  const ip = clientIp(req);
  if (auth.rateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (loginsInFlight >= MAX_LOGINS_IN_FLIGHT) return res.status(429).json({ error: 'Too many login attempts right now. Try again in a moment.' });
  const b = req.body || {};
  // text only: a number or object here used to pass the password check and then crash the server
  const username = typeof b.username === 'string' ? b.username : '';
  const password = typeof b.password === 'string' ? b.password : '';
  loginsInFlight++;
  let ok;
  try { ok = await auth.verifyAsync(username, password); }
  catch (e) { return next(e); }
  finally { loginsInFlight--; }
  if (!ok) {
    auth.recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  // remember the time of this login, and whether the password meets the current rules (see auth.recordLogin);
  // a problem writing that down must not stop someone from logging in
  try { auth.recordLogin(username, password); } catch (e) { console.error('Could not record the login:', e.message); }
  auth.issue(res, username, req.secure);
  res.json({ user: username });
});
app.post('/api/logout', (req, res) => { auth.clear(res, req); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const user = auth.userFrom(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user, isSuper: auth.isSuper(user), mustChangePassword: auth.mustChange(user), minPassword: auth.MIN_PASSWORD, siteUrl: cfg.SITE_URL, siteName: cfg.SITE_NAME });
});

/* ---------- agent sign-ups (public registration form on / and /register/) ---------- */
// Sign-ups must come from our own pages. Browsers always tell which site a form was sent from
// (Origin), so another website can't make its visitors' browsers sign up here. A script that
// sends no Origin at all still has to pass the bot check (cms/turnstile.js).
const SITE_HOST = new URL(cfg.SITE_URL).host;
function fromOurSite(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { const host = new URL(origin).host; return host === SITE_HOST || host === req.headers.host; } catch { return false; } // also "null"
}
app.post('/api/signup', publicJson, async (req, res, next) => {
  if (!fromOurSite(req)) return res.status(403).json({ error: 'Please use the registration form on our website.' });
  const b = req.body || {};
  let r;
  try { r = await signups.add(b.fields, { page: b.page, ip: clientIp(req), token: b.token }); } catch (e) { return next(e); }
  if (r.error) return res.status(r.limited ? 429 : r.failed ? 403 : 400).json({ error: r.error });
  res.json({ ok: true, message: signups.THANKS });
});

const api = express.Router();
// Changes made through the admin API have to come from the admin screens themselves: a browser always says which
// site a request was sent from (Origin), so another page – even a public page of this site – can't make it for them.
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let ok = false;
    try { const h = hosts.bareHost(new URL(origin).hostname); ok = h === hosts.hostOf(req) || h === (hosts.adminHost || hosts.siteHost); } catch {}
    if (!ok) return res.status(403).json({ error: 'This request did not come from the admin panel.' });
  }
  next();
});
api.use(auth.requireAuth);
api.use(auth.requirePasswordOk); // a password that fails today's rules must be replaced before anything else
api.use(adminJson);

/* ---------- posts ---------- */
const summary = (p) => ({
  id: p.id, title: p.title, slug: p.slug, status: p.status, date: p.date, modified: p.modified,
  author: p.author, categories: p.categories, tags: p.tags, url: render.postUrl(p),
  focusKeyword: p.focusKeyword || '', seoScore: p.seoScore ?? null, noindex: !!(p.robots && p.robots.noindex),
});

api.get('/posts', (req, res) => {
  res.json(store.allPosts().sort((a, b) => new Date(b.date) - new Date(a.date)).map(summary));
});

api.get('/posts/:id', (req, res) => {
  const p = store.getPost(req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: 'Post not found' });
});

function applyInput(post, body, user, kind = 'post') {
  const manifest = store.readJson(cfg.MANIFEST_FILE, { posts: [] });
  const s = (v) => (v === undefined || v === null ? '' : String(v));
  post.title = s(body.title).trim() || 'Untitled';
  post.content = s(body.content);
  post.excerpt = s(body.excerpt).trim();
  post.seoTitle = s(body.seoTitle).trim();
  post.metaDescription = s(body.metaDescription).trim();
  post.featuredImage = s(body.featuredImage).trim();
  // SEO
  post.focusKeyword = s(body.focusKeyword).trim();
  post.canonical = s(body.canonical).trim();
  const r = body.robots || {};
  post.robots = { noindex: !!r.noindex, nofollow: !!r.nofollow, noarchive: !!r.noarchive, noimageindex: !!r.noimageindex, nosnippet: !!r.nosnippet };
  const schemas = kind === 'page' ? render.PAGE_SCHEMAS : ['BlogPosting', 'Article', 'NewsArticle', 'none'];
  post.schemaType = schemas.includes(body.schemaType) ? body.schemaType : '';
  for (const k of ['ogTitle', 'ogDescription', 'ogImage', 'twitterTitle', 'twitterDescription', 'twitterImage']) post[k] = s(body[k]).trim();
  post.twitterCard = body.twitterCard === 'summary' ? 'summary' : 'summary_large_image';
  post.seoScore = Number.isFinite(+body.seoScore) && body.seoScore !== null && body.seoScore !== '' ? Math.max(0, Math.min(100, Math.round(+body.seoScore))) : null;
  post.status = body.status === 'publish' ? 'publish' : 'draft';
  if (body.date && !isNaN(new Date(body.date))) post.date = new Date(body.date).toISOString();
  if (kind === 'page') {
    post.showTitle = body.showTitle !== false;
  } else {
    post.author = body.author ? store.ensureTerm('authors', body.author) : post.author || user;
    post.categories = (Array.isArray(body.categories) ? body.categories : []).map((c) => store.ensureTerm('categories', c));
    if (!post.categories.length) post.categories = [store.ensureTerm('categories', 'Blog')];
    post.tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => s(t).trim()).filter(Boolean).map((t) => store.ensureTerm('tags', t)))];
  }

  const wanted = store.slugify(s(body.slug).trim() || post.title);
  const keepOld = post.slug && s(body.slug).trim() === post.slug; // unchanged legacy slug (may contain unicode)
  post.slug = keepOld ? post.slug : store.uniqueSlug(wanted, post.id, manifest);
  post.modified = new Date().toISOString();
  return post;
}

api.post('/posts', async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const post = applyInput({ id: store.nextId(), date: now, extraCss: [] }, req.body, req.user);
    store.savePost(post);
    if (post.status === 'publish') seo.removeRedirect(`/${post.slug}/`);
    const build = post.status === 'publish' ? await rebuild() : null;
    res.json({ post, build });
  } catch (e) { next(e); }
});

api.put('/posts/:id', async (req, res, next) => {
  try {
    const existing = store.getPost(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    const wasPublished = existing.status === 'publish';
    const oldSlug = existing.slug;
    const post = applyInput(existing, req.body, req.user);
    store.savePost(post);
    // keep old links working: 301 from the previous URL
    if (wasPublished && oldSlug && oldSlug !== post.slug) seo.addRedirect(`/${oldSlug}/`, `/${post.slug}/`, 301);
    if (post.status === 'publish') seo.removeRedirect(`/${post.slug}/`);
    const build = wasPublished || post.status === 'publish' ? await rebuild() : null;
    res.json({ post, build });
  } catch (e) { next(e); }
});

api.delete('/posts/:id', async (req, res, next) => {
  try {
    const p = store.getPost(req.params.id);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    store.deletePost(p.id);
    const build = p.status === 'publish' ? await rebuild() : null;
    res.json({ ok: true, build });
  } catch (e) { next(e); }
});

api.post('/preview', (req, res) => {
  if (req.body.kind === 'page') {
    const base = (req.body.id && store.getPage(req.body.id)) || { id: 0, date: new Date().toISOString() };
    const page = { ...base, ...req.body, id: base.id, slug: base.slug || 'preview', modified: new Date().toISOString() };
    return res.type('html').send(render.previewPage(page));
  }
  const base = (req.body.id && store.getPost(req.body.id)) || { id: 0, date: new Date().toISOString(), extraCss: [] };
  const post = { ...base, ...req.body, id: base.id, extraCss: base.extraCss || [] };
  post.slug = base.slug || 'preview';
  post.modified = new Date().toISOString();
  post.categories = (post.categories || []).map(store.slugify);
  post.tags = (post.tags || []).map(store.slugify);
  res.type('html').send(render.previewPost(post));
});

/* ---------- pages ---------- */
const pageSummary = (p) => ({
  id: p.id, title: p.title, slug: p.slug, status: p.status, date: p.date, modified: p.modified, url: render.postUrl(p),
  focusKeyword: p.focusKeyword || '', seoScore: p.seoScore ?? null, noindex: !!(p.robots && p.robots.noindex),
});
api.get('/pages', (req, res) => res.json(store.allPages().sort((a, b) => a.title.localeCompare(b.title)).map(pageSummary)));
api.get('/pages/:id', (req, res) => {
  const p = store.getPage(req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: 'Page not found' });
});
api.post('/pages', async (req, res, next) => {
  try {
    const page = applyInput({ id: store.nextId(), date: new Date().toISOString() }, req.body, req.user, 'page');
    store.savePage(page);
    if (page.status === 'publish') seo.removeRedirect(`/${page.slug}/`);
    res.json({ post: page, build: page.status === 'publish' ? await rebuild() : null });
  } catch (e) { next(e); }
});
api.put('/pages/:id', async (req, res, next) => {
  try {
    const existing = store.getPage(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Page not found' });
    const wasPublished = existing.status === 'publish';
    const oldSlug = existing.slug;
    const page = applyInput(existing, req.body, req.user, 'page');
    store.savePage(page);
    if (wasPublished && oldSlug && oldSlug !== page.slug) seo.addRedirect(`/${oldSlug}/`, `/${page.slug}/`, 301);
    if (page.status === 'publish') seo.removeRedirect(`/${page.slug}/`);
    res.json({ post: page, build: wasPublished || page.status === 'publish' ? await rebuild() : null });
  } catch (e) { next(e); }
});
api.delete('/pages/:id', async (req, res, next) => {
  try {
    const p = store.getPage(req.params.id);
    if (!p) return res.status(404).json({ error: 'Page not found' });
    store.deletePage(p.id);
    res.json({ ok: true, build: p.status === 'publish' ? await rebuild() : null });
  } catch (e) { next(e); }
});

/* ---------- navigation menu ---------- */
api.get('/menu', (req, res) => res.json({ items: menu.get() }));
api.put('/menu', async (req, res, next) => {
  try {
    const r = menu.save(req.body.items);
    render.reloadTemplates();
    res.json({ items: r.items, files: r.files, build: await rebuild() });
  } catch (e) { next(e); }
});

api.post('/rebuild', async (req, res, next) => { try { res.json(await rebuild()); } catch (e) { next(e); } });

/* ---------- terms ---------- */
api.get('/terms', (req, res) => res.json(store.getTerms()));
api.post('/terms/:type', (req, res) => {
  const type = req.params.type;
  if (!['categories', 'tags', 'authors'].includes(type) || !req.body.name) return res.status(400).json({ error: 'Bad request' });
  const slug = store.ensureTerm(type, req.body.name);
  res.json({ slug, terms: store.getTerms() });
});

// rename + SEO for a category / tag / author archive
api.put('/terms/:type/:slug', auth.requireSuper, async (req, res, next) => { // archive titles / noindex = SEO screen
  try {
    const { type, slug } = req.params;
    const terms = store.getTerms();
    if (!['categories', 'tags', 'authors'].includes(type) || !terms[type] || !Object.hasOwn(terms[type], slug)) return res.status(404).json({ error: 'Term not found' });
    const b = req.body || {};
    if (String(b.name || '').trim()) { terms[type][slug] = String(b.name).trim(); store.saveTerms(terms); }
    const s = seo.get();
    s.terms[`${type}:${slug}`] = { title: String(b.title || '').trim(), description: String(b.description || '').trim(), noindex: !!b.noindex };
    seo.save(s);
    res.json({ ok: true, build: await rebuild() });
  } catch (e) { next(e); }
});

/* ---------- SEO settings ---------- */
// The SEO settings screen holds the site-wide custom <head> code (it runs on every public page), robots.txt,
// redirects and the Search Console / Analytics codes: super admin only. The post and page editors only need the
// few values below to preview titles, so every user gets just those.
api.get('/seo/editor', (req, res) => {
  const s = seo.get();
  res.json({
    settings: { separator: s.separator, postTitle: s.postTitle, pageTitle: s.pageTitle, articleSchema: s.articleSchema, schemaType: s.schemaType, defaultOgImage: s.defaultOgImage },
    siteUrl: cfg.SITE_URL,
  });
});

api.get('/seo', auth.requireSuper, (req, res) => res.json({ settings: seo.get(), defaultRobotsTxt: render.defaultRobotsTxt(), siteUrl: cfg.SITE_URL }));

api.put('/seo', auth.requireSuper, async (req, res, next) => {
  try {
    const b = req.body || {};
    const cur = seo.get();
    const str = (v, max = 2000) => String(v ?? '').slice(0, max);
    const bool = (o, keys) => Object.fromEntries(keys.map((k) => [k, !!(o || {})[k]]));
    const redirects = (Array.isArray(b.redirects) ? b.redirects : [])
      .map((r) => ({ from: seo.normPath(r.from), to: /^https?:\/\//i.test(String(r.to || '').trim()) ? String(r.to).trim() : seo.normPath(r.to), type: +r.type === 302 ? 302 : 301, created: r.created || new Date().toISOString() }))
      .filter((r) => r.from && r.to && r.from !== '/' && r.from !== r.to);
    // The screen sends the list it was showing plus which sources it knew about (redirectsKnown).
    // Redirects it never saw – e.g. made by renaming a post while the SEO screen was open – are kept,
    // not wiped; only the ones it knew about and no longer lists are removed.
    if (Array.isArray(b.redirectsKnown)) {
      const known = new Set(b.redirectsKnown.map((f) => seo.normPath(f)));
      const listed = new Set(redirects.map((r) => r.from));
      redirects.unshift(...cur.redirects.filter((r) => !known.has(seo.normPath(r.from)) && !listed.has(seo.normPath(r.from))));
    }
    const updated = {
      ...cur,
      separator: str(b.separator, 5) || '-',
      postTitle: str(b.postTitle, 200) || seo.DEFAULTS.postTitle,
      pageTitle: str(b.pageTitle, 200) || seo.DEFAULTS.pageTitle,
      archiveTitle: str(b.archiveTitle, 200) || seo.DEFAULTS.archiveTitle,
      pagedTitle: str(b.pagedTitle, 200) || seo.DEFAULTS.pagedTitle,
      defaultOgImage: str(b.defaultOgImage, 500),
      twitterSite: str(b.twitterSite, 60).trim(),
      facebookUrl: str(b.facebookUrl, 300).trim(),
      schemaType: b.schemaType === 'Person' ? 'Person' : 'Organization',
      orgName: str(b.orgName, 200).trim(),
      orgLogo: str(b.orgLogo, 500).trim(),
      sameAs: (Array.isArray(b.sameAs) ? b.sameAs : String(b.sameAs || '').split(/\n/)).map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u)),
      articleSchema: ['BlogPosting', 'Article', 'NewsArticle', 'none'].includes(b.articleSchema) ? b.articleSchema : 'BlogPosting',
      verification: Object.fromEntries(['google', 'bing', 'yandex', 'pinterest', 'baidu'].map((k) => [k, str((b.verification || {})[k], 200).trim()])),
      headCode: str(b.headCode, 20000),
      index: bool(b.index, ['categories', 'tags', 'authors', 'paginated']),
      sitemap: bool(b.sitemap, ['posts', 'pages', 'categories', 'tags', 'authors']),
      rss: !!b.rss,
      robotsTxt: str(b.robotsTxt, 10000),
      redirects,
    };
    seo.save(updated);
    const staticUpdated = seo.applyGlobalToStatic();
    res.json({ settings: seo.get(), staticUpdated, build: await rebuild() });
  } catch (e) { next(e); }
});

/* ---------- social bar ---------- */
api.get('/social', (req, res) => res.json({ settings: social.get(), networks: social.catalogue(), max: social.MAX_ITEMS, styles: social.STYLES }));

api.post('/social/preview', (req, res) => res.json({ html: social.block(social.clean(req.body || {}), { force: true }) }));

const twitterHandle = (url) => { const m = /(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(url || ''); return m ? '@' + m[1] : ''; };

api.put('/social', async (req, res, next) => {
  try {
    const bad = social.invalid(req.body || {});
    if (bad.length) return res.status(400).json({ error: `Please check the link for: ${bad.join(', ')}` });
    const prev = social.get();
    const s = social.save(req.body || {});
    // Keep the Organization schema (sameAs) in sync with the bar – helps Google & AI engines connect the brand.
    // Links that were removed from the bar are removed from sameAs too; URLs added by hand on the SEO screen stay.
    const cur = seo.get();
    const oldUrls = new Set(social.profileUrls(prev));
    const sameAs = [...new Set([...(cur.sameAs || []).filter((u) => !oldUrls.has(u)), ...social.profileUrls(s)])];
    const patch = { sameAs };
    const oldFb = social.firstUrl(prev, 'facebook'), newFb = social.firstUrl(s, 'facebook');
    if (!cur.facebookUrl || cur.facebookUrl === oldFb) patch.facebookUrl = newFb;
    const oldTw = twitterHandle(social.firstUrl(prev, 'x')), newTw = twitterHandle(social.firstUrl(s, 'x'));
    if (!cur.twitterSite || cur.twitterSite === oldTw) patch.twitterSite = newTw;
    const seoChanged = JSON.stringify(sameAs) !== JSON.stringify(cur.sameAs || [])
      || patch.facebookUrl !== (cur.facebookUrl || '') || patch.twitterSite !== (cur.twitterSite || '');
    if (seoChanged) { seo.save({ ...cur, ...patch }); seo.applyGlobalToStatic(); }
    const updated = social.applyAll();
    cfpurge.schedule('social bar');
    res.json({ settings: s, updated, build: seoChanged ? await rebuild() : null });
  } catch (e) { next(e); }
});

api.get('/seo/pages', (req, res) => res.json(seo.listPages()));
api.put('/seo/pages', auth.requireSuper, async (req, res, next) => { // (reading the list stays open: the menu editor picks pages from it)
  try {
    const o = seo.savePage(String(req.body.path || ''), req.body);
    res.json({ override: o, build: await rebuild() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- media ---------- */
const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;
const upload = multer({
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, IMG_EXT.test(file.originalname)),
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const d = new Date();
      const dir = path.join(cfg.SITE_DIR, 'wp-content', 'uploads', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = store.slugify(path.basename(file.originalname, ext)).slice(0, 60);
      cb(null, `${base}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    },
  }),
});

api.post('/media', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Only image files are allowed (jpg, png, gif, webp, avif, svg).' });
  const file = await images.optimize(req.file.path); // large photos -> resized WebP (never fails)
  const rel = path.relative(cfg.SITE_DIR, file).split(path.sep).join('/');
  res.json({ location: `/${rel}`, url: `/${rel}` });
});

api.get('/media', (req, res) => {
  const root = path.join(cfg.SITE_DIR, 'wp-content', 'uploads');
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['elementor', 'cache'].includes(e.name)) walk(f); continue; }
      if (!IMG_EXT.test(e.name)) continue;
      if (/-\d+x\d+\.[a-z]+$/i.test(e.name)) continue; // skip WP auto-generated sizes
      if (/\.(?:png|jpe?g)\.webp$/i.test(e.name)) continue; // WebP copies from tools/png-jpg-to-webp.js
      out.push({ url: '/' + path.relative(cfg.SITE_DIR, f).split(path.sep).join('/'), mtime: fs.statSync(f).mtimeMs });
    }
  };
  if (fs.existsSync(root)) walk(root);
  out.sort((a, b) => b.mtime - a.mtime);
  res.json(out.slice(0, +req.query.limit || 300));
});

/* ---------- sign-ups ---------- */
// Sign-ups are people's names, emails and phone numbers: super admin only (the whole /signups tree).
api.use('/signups', auth.requireSuper);
api.get('/signups', (req, res) => res.json({ items: signups.list(), unverified: signups.listUnverified(), botCheck: !!turnstile.settings() }));
// "Unverified" = sent without passing the bot check (see cms/signups.js); these routes come before /signups/:id
api.delete('/signups/unverified', (req, res) => res.json({ unverified: signups.clearUnverified((req.body || {}).ids) }));
api.delete('/signups/unverified/:id', (req, res) => res.json({ unverified: signups.removeUnverified(req.params.id) }));
api.post('/signups/unverified/:id/approve', (req, res) => {
  const r = signups.approve(req.params.id);
  return r ? res.json(r) : res.status(404).json({ error: 'That sign-up is no longer in the Unverified list.' });
});
api.delete('/signups/:id', (req, res) => res.json({ items: signups.remove(req.params.id) }));

/* ---------- account ---------- */
api.post('/password', (req, res) => {
  const { current, next: pw } = req.body || {};
  if (!auth.verify(req.user, String(current || ''))) return res.status(400).json({ error: 'Current password is incorrect' });
  const problem = auth.passwordProblem(typeof pw === 'string' ? pw : '', req.user);
  if (problem) return res.status(400).json({ error: problem });
  if (String(pw) === String(current)) return res.status(400).json({ error: 'Please choose a password different from the current one.' });
  auth.setPassword(req.user, String(pw)); // logs out this user's other sessions
  auth.issue(res, req.user, req.secure);  // …but keeps this browser logged in
  res.json({ ok: true });
});

/* ---------- users ---------- */
// Seeing the accounts, their last login, and adding / removing / changing them is for the super admin only.
// (Every user can still change their own password above.)
api.get('/users', auth.requireSuper, (req, res) => res.json({ users: auth.listUsers(), me: req.user }));

api.post('/users', auth.requireSuper, (req, res) => {
  const b = req.body || {};
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
  const pw = typeof b.password === 'string' ? b.password : '';
  const role = b.role === 'super' ? 'super' : 'staff';
  if (!auth.validUsername(username)) return res.status(400).json({ error: 'Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.' });
  if (auth.userExists(username)) return res.status(409).json({ error: `User "${username}" already exists.` });
  const problem = auth.passwordProblem(pw, username);
  if (problem) return res.status(400).json({ error: problem });
  auth.addUser(username, pw, role);
  res.json({ users: auth.listUsers() });
});

api.put('/users/:username/password', auth.requireSuper, (req, res) => {
  const { username } = req.params;
  const b = req.body || {};
  const pw = typeof b.password === 'string' ? b.password : '';
  if (!auth.userExists(username)) return res.status(404).json({ error: 'User not found.' });
  const problem = auth.passwordProblem(pw, username);
  if (problem) return res.status(400).json({ error: problem });
  auth.setPassword(username, pw); // logs that user out everywhere
  if (username === req.user) auth.issue(res, req.user, req.secure); // except the admin doing it
  res.json({ ok: true });
});

api.put('/users/:username/role', auth.requireSuper, (req, res) => {
  const { username } = req.params;
  const role = (req.body || {}).role;
  if (!auth.ROLES.includes(role)) return res.status(400).json({ error: 'Role must be super or staff.' });
  if (!auth.userExists(username)) return res.status(404).json({ error: 'User not found.' });
  if (username === req.user) return res.status(400).json({ error: "You can't change your own role – ask another super admin." });
  if (role === 'staff' && auth.isSuper(username) && auth.superCount() <= 1) return res.status(400).json({ error: 'There must always be at least one super admin.' });
  auth.setRole(username, role);
  res.json({ users: auth.listUsers() });
});

api.delete('/users/:username', auth.requireSuper, (req, res) => {
  const { username } = req.params;
  if (!auth.userExists(username)) return res.status(404).json({ error: 'User not found.' });
  if (username === req.user) return res.status(400).json({ error: "You can't delete the account you're logged in with." });
  if (auth.listUsers().length <= 1) return res.status(400).json({ error: "You can't delete the last user." });
  if (auth.isSuper(username) && auth.superCount() <= 1) return res.status(400).json({ error: "You can't delete the only super admin." });
  auth.deleteUser(username);
  res.json({ users: auth.listUsers() });
});

app.use('/api', api);
// a bad request (too big, broken JSON) keeps its own 4xx status; for real failures only a logged-in
// admin sees the reason – the public login and sign-up forms just get "Server error"
app.use('/api', (err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  if (res.headersSent) return next(err);
  const reason = status === 500 ? (req.user && err.message) || 'Server error' : (err.expose && err.message) || http.STATUS_CODES[status];
  res.status(status).json({ error: reason });
});

/* ---------- admin UI ---------- */
app.use('/admin/tinymce', express.static(path.join(__dirname, 'node_modules', 'tinymce'), { maxAge: '7d' }));
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

/* ---------- public site ---------- */
// clean URLs: /index.html -> /, /foo/index.html -> /foo/ (avoids duplicate URLs in Google too)
app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !/(^|\/)index\.html?$/i.test(req.path)) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(301, req.path.replace(/index\.html?$/i, '').replace(/^\/+/, '/') + (q === -1 ? '' : req.originalUrl.slice(q)));
});
// redirects managed in SEO settings (and auto-created on slug changes)
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const r = seo.findRedirect(req.path);
  if (r) return res.redirect(r.type || 301, /^https?:/i.test(r.to) ? r.to : encodeURI(r.to));
  next();
});
function notFound(req, res) {
  const nf = path.join(cfg.SITE_DIR, '404.html');
  res.status(404);
  return fs.existsSync(nf) ? res.sendFile(nf) : res.type('text').send('Page not found');
}
// old WordPress links: /?p=123, /?page_id=16, /?s=…
app.use(legacy.wpQuery(notFound));
// the registration form posted without JavaScript arrives at the page URL itself
// (no JavaScript means no bot check either, so with Turnstile on these land in Unverified)
app.post('*', express.urlencoded({ extended: true, limit: '20kb' }), async (req, res, next) => {
  const fields = req.body && req.body.form_fields;
  if (!fields || typeof fields !== 'object') return next();
  if (!fromOurSite(req)) return res.status(403).type('text').send('Please use the registration form on our website.');
  let r;
  try { r = await signups.add(fields, { page: req.path, ip: clientIp(req), token: req.body['cf-turnstile-response'] }); } catch (e) { return next(e); }
  res.redirect(303, `/${req.path.replace(/^\/+/, '')}?registered=${r.error ? 0 : 1}`);
});
app.get(['/feed', '/feed/'], (req, res, next) => {
  const f = path.join(cfg.SITE_DIR, 'feed.xml');
  if (!fs.existsSync(f)) return next();
  res.type('application/rss+xml; charset=utf-8').sendFile(f);
});
// old Rank Math / Yoast sitemap URLs (may still be submitted in Search Console)
app.get(/^\/(sitemap_index|post-sitemap\d*|page-sitemap\d*|category-sitemap|post_tag-sitemap|author-sitemap|wp-sitemap)\.xml$/, (req, res) => res.redirect(301, '/sitemap.xml'));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/wp-content/uploads/2024/07/Stars777-Logo-100x100.webp'));

// versioned theme/plugin assets + uploads: cache 30 days; HTML: always revalidate (ETag) so edits show immediately
app.use(express.static(cfg.SITE_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    // an SVG opened directly could run script on our domain – render it as a plain image only
    if (/\.svg$/i.test(filePath)) res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; sandbox");
    // pages: browsers re-check every time (max-age=0); Cloudflare may keep a page for a day and is
    // told to drop it right after every publish, settings save and server start (cms/cfpurge.js) – so
    // the day only matters for pages nobody changed, and quiet pages stay fast for the next visitor.
    // The day is in a header only Cloudflare reads: an s-maxage in Cache-Control would also make the
    // server's own nginx cache keep pages, and nothing clears that cache. Only pages carry it, so
    // nothing else (API, admin, redirects, errors, sitemap, robots) can ever be cached by Cloudflare's rule.
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('Cloudflare-CDN-Cache-Control', 'max-age=86400');
    }
    else if (/\.(xml|txt)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    // Elementor's generated CSS/JS keeps the same file name when its content changes: 1 day, not 30
    else if (/[\\/]wp-content[\\/]uploads[\\/]elementor[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    else if (/[\\/]wp-(content|includes)[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
// old WordPress URL variants (feeds, /amp/, pasted quotes, capitals) -> 301 to the live page
app.use(legacy.oldPaths);
app.use(notFound);

// Everything else that fails (a malformed address, an oversized form post): a short plain answer.
// Express's own error page would show the stack trace – file paths and code – to anyone.
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  if (res.headersSent) return next(err);
  res.status(status).type('text').send(http.STATUS_CODES[status] || 'Error');
});

app.listen(cfg.PORT, () => {
  console.log(`Site:  http://localhost:${cfg.PORT}/`);
  console.log(`Admin: http://localhost:${cfg.PORT}/admin/`);
});

// Page injections take a few seconds. They run after the port is open, so during a restart
// requests wait for them instead of failing (the proxy answers 502 while nothing listens).
try { if (!fs.existsSync(path.join(cfg.SITE_DIR, '404.html'))) render.write404(); } catch (e) { console.warn('404 page not generated:', e.message); }
try { seo.applyGlobalToStatic(); } catch (e) { console.warn('SEO head injection skipped:', e.message); }
try { social.applyAll(); } catch (e) { console.warn('Social bar injection skipped:', e.message); }
try { cleanhash.applyAll(); } catch (e) { console.warn('Clean-hash injection skipped:', e.message); }
try { signups.applyAll(); } catch (e) { console.warn('Sign-up form script skipped:', e.message); }
console.log(turnstile.describe());
console.log(hosts.describe());
try { webpswap.applyAll(); } catch (e) { console.warn('Image -> WebP swap skipped:', e.message); }
cfpurge.schedule('server start'); // a deploy restarts the server, so this clears Cloudflare's old copies
