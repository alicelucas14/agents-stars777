/**
 * Serve the small WebP copy of big images.
 *
 * Two tools write WebP copies next to the originals in wp-content/uploads:
 *   tools/gif-to-webp.js      x.gif -> x.webp       (animated)
 *   tools/png-jpg-to-webp.js  x.png -> x.png.webp,  x.jpg -> x.jpg.webp
 * This module rewrites the image addresses in <img> / <source> tags (src, data-src, srcset,
 * data-srcset) to the copy – but only when that copy really exists, so nothing breaks if a
 * conversion is missing. Posts and pages keep their original links in the saved content,
 * so editing in the admin is unchanged.
 *
 * og:image / twitter:image / schema images and links to the full image (<a href>) keep
 * pointing at the original, because social networks are the one place WebP previews are
 * not reliable. WebP (also animated) shows in every current browser.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const social = require('./social');

const UPLOADS = path.join(cfg.SITE_DIR, 'wp-content', 'uploads');
const TAG = /<(?:img|source)\b[^>]*>/gi;
const ATTR = /(\s(?:src|data-src|srcset|data-srcset)\s*=\s*)(["'])([^"']*)\2/gi;
const HAS_IMG = /\.(?:gif|png|jpe?g)\b/i;
const SITE_HOST = (() => { try { return new URL(cfg.SITE_URL).host.toLowerCase(); } catch { return ''; } })();

/** The page URL's own host (or no host at all) – never rewrite links to other websites. */
function isOwn(url) {
  const m = /^(?:https?:)?\/\/([^/?#]+)/i.exec(url);
  if (!m) return !/^[a-z][a-z0-9+.-]*:/i.test(url); // relative / root-relative, but not data: etc.
  const host = m[1].toLowerCase();
  return host === SITE_HOST || host === 'www.' + SITE_HOST || host === 'agents.stars777.org';
}

/** Address of the WebP copy for an image address (without ?query), or null for other files. */
function twinOf(url) {
  if (/\.gif$/i.test(url)) return url.replace(/\.gif$/i, '.webp');
  if (/\.(?:png|jpe?g)$/i.test(url)) return url + '.webp';
  return null;
}

/** Does the WebP copy of this uploads URL exist? `has` caches file checks for one run. */
function exists(twin, has) {
  if (!isOwn(twin)) return false;
  const m = /wp-content\/uploads\/([^?#]+)$/i.exec(twin);
  if (!m) return false;
  let rel;
  try { rel = decodeURIComponent(m[1]); } catch { return false; }
  if (rel.split(/[\\/]/).includes('..')) return false;
  const file = path.join(UPLOADS, rel);
  if (!file.startsWith(UPLOADS + path.sep)) return false;
  let v = has.get(file);
  if (v === undefined) { v = fs.existsSync(file); has.set(file, v); }
  return v;
}

/** One image address -> its WebP copy when there is one, else unchanged. Keeps ?query / #hash. */
function swapUrl(raw, has) {
  const i = raw.search(/[?#]/);
  const url = i === -1 ? raw : raw.slice(0, i);
  const rest = i === -1 ? '' : raw.slice(i);
  const twin = twinOf(url);
  return twin && exists(twin, has) ? twin + rest : raw;
}

/** Return the HTML with image sources swapped for their WebP copies. */
function swap(html) {
  const has = new Map();
  return String(html).replace(TAG, (tag) => {
    if (!HAS_IMG.test(tag)) return tag;
    return tag.replace(ATTR, (all, pre, q, val) => {
      if (!HAS_IMG.test(val)) return all;
      const out = /srcset\s*=\s*$/i.test(pre)
        // "a.png 300w, b.png 1024w": the address is the first word of each comma-separated entry
        ? val.replace(/(^|,)(\s*)([^\s,]+)/g, (m, sep, ws, u) => sep + ws + swapUrl(u, has))
        : val.replace(/^(\s*)(\S+)(\s*)$/, (m, a, u, b) => a + swapUrl(u, has) + b);
      return pre + q + out + q;
    });
  });
}

/** Apply to every HTML page of the site. Returns number of files changed. */
function applyAll() {
  let changed = 0;
  for (const f of social.htmlFiles()) {
    const html = fs.readFileSync(f, 'utf8');
    if (!HAS_IMG.test(html)) continue;
    const out = swap(html);
    if (out !== html) { fs.writeFileSync(f, out); changed++; }
  }
  return changed;
}

module.exports = { swap, applyAll };
