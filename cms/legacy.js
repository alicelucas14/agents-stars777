/**
 * Old WordPress URLs that Google (and old links) still use. Rather than a 404,
 * or the homepage served under a junk URL, answer with a 301 to the page that
 * replaced them:
 *   /?p=2805, /?page_id=16        -> the post / page with that WordPress ID
 *   /?s=...                       -> the same URL without the search (no site search here)
 *   /feed/atom/, /x/feed/, /comments/feed/ -> /feed/
 *   /x/amp/, /x/embed/, /x/trackback/, /x/comment-page-2/, /x/page/1/ -> /x/
 *   /x/%E2%80%9D  (curly quote pasted into a link) -> /x/
 *   /Some-Post/                   -> /some-post/
 * Path redirects only happen when the target exists, so real 404s stay 404s.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const { postUrl } = require('./render');

/* ---------- ?p= / ?page_id= ---------- */
let staticIds = null; // WordPress ID -> path, from the body class ("page-id-16", "postid-2805") of the mirrored pages
function staticIdMap() {
  if (staticIds) return staticIds;
  staticIds = new Map();
  for (const p of seo.staticPages()) {
    const m = /<body[^>]*\bclass="[^"]*\b(?:page-id|postid)-(\d+)\b/i.exec(fs.readFileSync(p.file, 'utf8'));
    if (m && !staticIds.has(+m[1])) staticIds.set(+m[1], encodeURI(p.path));
  }
  return staticIds;
}

function urlForId(id) {
  const post = store.getPost(id) || store.getPage(id);
  if (post && post.status === 'publish') return postUrl(post);
  return staticIdMap().get(id) || null;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** Runs before the static files (the homepage would otherwise answer every /?p=…). */
const wpQuery = (notFound) => (req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
  const q = req.query;
  const id = first(q.p ?? q.page_id ?? q.attachment_id);
  if (id !== undefined) {
    const to = /^\d+$/.test(String(id)) && urlForId(+id);
    return to ? res.redirect(301, to) : notFound(req, res);
  }
  if (q.s !== undefined) {
    const u = new URL(req.originalUrl, 'http://x');
    u.searchParams.delete('s');
    return res.redirect(301, u.pathname + u.search);
  }
  next();
};

/* ---------- old path variants ---------- */
// characters pasted onto the end of links (quotes, punctuation, spaces)
const JUNK_CHAR = /^[\s"'“”‘’″,.;:)\]>]$/u;

/**
 * Strip trailing junk characters, keeping one final "/" ("/x/%E2%80%9D" -> "/x/", "/x." -> "/x").
 * Same result as repeatedly applying /[junk]+(\/?)$/ but in one linear pass – that regex took
 * quadratic time on long junk URLs, which let a single visitor stall the server.
 */
function stripJunk(x) {
  for (;;) {
    if (x === '/') return x;
    const slash = x.endsWith('/') ? 1 : 0;
    let i = x.length - slash;
    while (i > 0 && JUNK_CHAR.test(x[i - 1])) i--;
    if (i === x.length - slash) return x;
    x = x.slice(0, i) + (slash ? '/' : '');
  }
}

const FEED = /\/feed(?:\/(?:rss2?|atom|rdf))?\/?$/i;
const SUFFIX = /\/(?:amp|embed|trackback|comment-page-\d+|page\/1|attachment\/[^/]+)\/?$/i;

/** The URL a site path is served at (with the trailing slash for folders), or null. */
function resolve(p) {
  const parts = p.split('/').filter(Boolean);
  if (parts.some((s) => s === '.' || s === '..')) return null;
  const folder = encodeURI(`/${parts.map((s) => s + '/').join('')}`);
  if (seo.findRedirect(folder)) return folder;
  const dir = path.join(cfg.SITE_DIR, ...parts);
  if (fs.existsSync(path.join(dir, 'index.html'))) return folder;
  if (parts.length && fs.existsSync(dir + '.html')) return encodeURI(`/${parts.join('/')}`);
  return null;
}

/** Runs after the static files, just before the 404 page. */
function oldPaths(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let p;
  try { p = decodeURIComponent(req.path); } catch { return next(); }
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return next(); // missing asset or file, not a page

  if (p.length > 1000) return next(); // no real page has a path this long
  let x = stripJunk(p);
  let to = null;
  if (FEED.test(x) || /^\/comments\/feed\/?$/i.test(x)) {
    to = fs.existsSync(path.join(cfg.SITE_DIR, 'feed.xml')) ? '/feed/' : null;
  } else {
    while (SUFFIX.test(x)) x = x.replace(SUFFIX, '/');
    to = resolve(x) || (x !== x.toLowerCase() && resolve(x.toLowerCase()));
  }
  if (!to || to === encodeURI(p)) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(301, to + (q === -1 ? '' : req.originalUrl.slice(q)));
}

module.exports = { wpQuery, oldPaths, urlForId, stripJunk };
