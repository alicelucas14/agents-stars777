/**
 * Serve the small WebP copy of animated GIFs.
 *
 * tools/gif-to-webp.js writes x.webp next to every big x.gif in wp-content/uploads. This
 * module rewrites <img src="...x.gif"> to x.webp in the page HTML – but only when that
 * .webp really exists, so nothing breaks if a conversion is missing. Posts and pages keep
 * their original .gif links in the saved content, so editing in the admin is unchanged.
 *
 * Only <img> tags are touched. og:image / twitter:image / schema images keep pointing at
 * the GIF, because social networks are the one place WebP previews are not reliable.
 * Animated WebP plays in every current browser.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const social = require('./social');

const UPLOADS = path.join(cfg.SITE_DIR, 'wp-content', 'uploads');
const IMG_TAG = /<img\b[^>]*>/gi;
const GIF_ATTR = /(\s(?:src|data-src)\s*=\s*)(["'])([^"']*?\.gif)((?:\?[^"']*)?)\2/gi;
const SITE_HOST = (() => { try { return new URL(cfg.SITE_URL).host.toLowerCase(); } catch { return ''; } })();

/** The page URL's own host (or no host at all) – never rewrite links to other websites. */
function isOwn(url) {
  const m = /^(?:https?:)?\/\/([^/?#]+)/i.exec(url);
  if (!m) return !/^[a-z][a-z0-9+.-]*:/i.test(url); // relative / root-relative, but not data: etc.
  const host = m[1].toLowerCase();
  return host === SITE_HOST || host === 'www.' + SITE_HOST || host === 'agents.stars777.org';
}

/** Does the .webp twin of this uploads URL exist? `has` caches file checks for one run. */
function twinExists(url, has) {
  if (!isOwn(url)) return false;
  const m = /wp-content\/uploads\/([^?#]+)$/i.exec(url);
  if (!m) return false;
  let rel;
  try { rel = decodeURIComponent(m[1]); } catch { return false; }
  if (rel.split(/[\\/]/).includes('..')) return false;
  const file = path.join(UPLOADS, rel.replace(/\.gif$/i, '.webp'));
  if (!file.startsWith(UPLOADS + path.sep)) return false;
  let v = has.get(file);
  if (v === undefined) { v = fs.existsSync(file); has.set(file, v); }
  return v;
}

/** Return the HTML with <img> GIF sources swapped for their WebP twins. */
function swap(html) {
  const has = new Map();
  return String(html).replace(IMG_TAG, (tag) => {
    if (!/\.gif/i.test(tag)) return tag;
    return tag.replace(GIF_ATTR, (all, pre, q, url, query) =>
      twinExists(url, has) ? `${pre}${q}${url.replace(/\.gif$/i, '.webp')}${query}${q}` : all);
  });
}

/** Apply to every HTML page of the site. Returns number of files changed. */
function applyAll() {
  let changed = 0;
  for (const f of social.htmlFiles()) {
    const html = fs.readFileSync(f, 'utf8');
    if (!/\.gif/i.test(html)) continue;
    const out = swap(html);
    if (out !== html) { fs.writeFileSync(f, out); changed++; }
  }
  return changed;
}

module.exports = { swap, applyAll };
