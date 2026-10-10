#!/usr/bin/env node
/**
 * Site + admin server.
 *   /            the static site (site/)
 *   /admin       blog admin panel (login required)
 *   /api/*       JSON API used by the admin panel
 */
const fs = require('fs');
const path = require('path');
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

auth.load(); // creates the first admin account if none exists
try { if (!fs.existsSync(path.join(cfg.SITE_DIR, '404.html'))) render.write404(); } catch (e) { console.warn('404 page not generated:', e.message); }
try { seo.applyGlobalToStatic(); } catch (e) { console.warn('SEO head injection skipped:', e.message); }
try { social.applyAll(); } catch (e) { console.warn('Social bar injection skipped:', e.message); }
try { cleanhash.applyAll(); } catch (e) { console.warn('Clean-hash injection skipped:', e.message); }

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
  res.redirect(301, `https://${new URL(cfg.SITE_URL).host}${req.originalUrl}`);
});

app.use(compression({ threshold: 1024 }));

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '10mb' }));

/* ---------- build queue (serialises rebuilds) ---------- */
let building = Promise.resolve();
const rebuild = () => (building = building.then(() => render.buildAll()).catch((e) => { console.error('Build failed:', e); throw e; }));

/* ---------- auth ---------- */
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (auth.rateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username, password } = req.body || {};
  if (!auth.verify(String(username || ''), String(password || ''))) {
    auth.recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  auth.issue(res, username, req.secure);
  res.json({ user: username });
});
app.post('/api/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const user = auth.userFrom(req);
  return user ? res.json({ user, siteUrl: cfg.SITE_URL, siteName: cfg.SITE_NAME }) : res.status(401).json({ error: 'Not logged in' });
});

const api = express.Router();
api.use(auth.requireAuth);

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
api.put('/terms/:type/:slug', async (req, res, next) => {
  try {
    const { type, slug } = req.params;
    const terms = store.getTerms();
    if (!terms[type] || !(slug in terms[type])) return res.status(404).json({ error: 'Term not found' });
    const b = req.body || {};
    if (String(b.name || '').trim()) { terms[type][slug] = String(b.name).trim(); store.saveTerms(terms); }
    const s = seo.get();
    s.terms[`${type}:${slug}`] = { title: String(b.title || '').trim(), description: String(b.description || '').trim(), noindex: !!b.noindex };
    seo.save(s);
    res.json({ ok: true, build: await rebuild() });
  } catch (e) { next(e); }
});

/* ---------- SEO settings ---------- */
api.get('/seo', (req, res) => res.json({ settings: seo.get(), defaultRobotsTxt: render.defaultRobotsTxt(), siteUrl: cfg.SITE_URL }));

api.put('/seo', async (req, res, next) => {
  try {
    const b = req.body || {};
    const cur = seo.get();
    const str = (v, max = 2000) => String(v ?? '').slice(0, max);
    const bool = (o, keys) => Object.fromEntries(keys.map((k) => [k, !!(o || {})[k]]));
    const redirects = (Array.isArray(b.redirects) ? b.redirects : [])
      .map((r) => ({ from: seo.normPath(r.from), to: /^https?:\/\//i.test(String(r.to || '').trim()) ? String(r.to).trim() : seo.normPath(r.to), type: +r.type === 302 ? 302 : 301, created: r.created || new Date().toISOString() }))
      .filter((r) => r.from && r.to && r.from !== '/' && r.from !== r.to);
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
    res.json({ settings: s, updated, build: seoChanged ? await rebuild() : null });
  } catch (e) { next(e); }
});

api.get('/seo/pages', (req, res) => res.json(seo.listPages()));
api.put('/seo/pages', async (req, res, next) => {
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

api.post('/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Only image files are allowed (jpg, png, gif, webp, avif, svg).' });
  const rel = path.relative(cfg.SITE_DIR, req.file.path).split(path.sep).join('/');
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
      out.push({ url: '/' + path.relative(cfg.SITE_DIR, f).split(path.sep).join('/'), mtime: fs.statSync(f).mtimeMs });
    }
  };
  if (fs.existsSync(root)) walk(root);
  out.sort((a, b) => b.mtime - a.mtime);
  res.json(out.slice(0, +req.query.limit || 300));
});

/* ---------- account ---------- */
api.post('/password', (req, res) => {
  const { current, next: pw } = req.body || {};
  if (!auth.verify(req.user, String(current || ''))) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!pw || String(pw).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  auth.setPassword(req.user, String(pw));
  res.json({ ok: true });
});

/* ---------- users ---------- */
api.get('/users', (req, res) => res.json({ users: auth.listUsers(), me: req.user }));

api.post('/users', (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const pw = String((req.body || {}).password || '');
  if (!auth.validUsername(username)) return res.status(400).json({ error: 'Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.' });
  if (auth.userExists(username)) return res.status(409).json({ error: `User "${username}" already exists.` });
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  auth.addUser(username, pw);
  res.json({ users: auth.listUsers() });
});

api.put('/users/:username/password', (req, res) => {
  const { username } = req.params;
  const pw = String((req.body || {}).password || '');
  if (!auth.userExists(username)) return res.status(404).json({ error: 'User not found.' });
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  auth.setPassword(username, pw);
  res.json({ ok: true });
});

api.delete('/users/:username', (req, res) => {
  const { username } = req.params;
  if (!auth.userExists(username)) return res.status(404).json({ error: 'User not found.' });
  if (username === req.user) return res.status(400).json({ error: "You can't delete the account you're logged in with." });
  if (auth.listUsers().length <= 1) return res.status(400).json({ error: "You can't delete the last user." });
  auth.deleteUser(username);
  res.json({ users: auth.listUsers() });
});

app.use('/api', api);
app.use('/api', (err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || 'Server error' }); });

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
    if (/\.(html|xml|txt)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    else if (/[\\/]wp-(content|includes)[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
app.use((req, res) => {
  const nf = path.join(cfg.SITE_DIR, '404.html');
  res.status(404);
  return fs.existsSync(nf) ? res.sendFile(nf) : res.type('text').send('Page not found');
});

app.listen(cfg.PORT, () => {
  console.log(`Site:  http://localhost:${cfg.PORT}/`);
  console.log(`Admin: http://localhost:${cfg.PORT}/admin/`);
});
