#!/usr/bin/env node
/**
 * Rewrite mirrored relative links that point at ".../index.html" into clean
 * root-relative URLs, e.g. on /foo/bar/:
 *   href="../../index.html"            -> href="/"
 *   href="../site-map/index.html"      -> href="/foo/site-map/"   (resolved properly)
 *   href="index.html#About"            -> href="/foo/bar/#About"
 * Absolute (http:, //), root-relative (/), mailto:, tel: and #-only links are untouched.
 *
 * Usage: node tools/clean-links.js        (prints how many files/links changed)
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');
const social = require('../cms/social');

const BASE = 'http://x';
const RE = /(<a\b[^>]*?\bhref=)(["'])([^"']*?index\.html?(?:[?#][^"']*)?)\2/gi;

function pageUrl(file) {
  const rel = path.relative(cfg.SITE_DIR, file).split(path.sep).join('/');
  return '/' + rel; // e.g. /foo/bar/index.html
}

function clean(href, from) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href; // absolute, root-relative, scheme, fragment
  let u;
  try { u = new URL(href, BASE + from); } catch { return href; }
  if (u.origin !== BASE) return href;
  const p = u.pathname.replace(/(^|\/)index\.html?$/i, '$1') || '/';
  return p + u.search + u.hash;
}

let files = 0, links = 0;
for (const f of social.htmlFiles()) {
  const html = fs.readFileSync(f, 'utf8');
  const from = pageUrl(f);
  const out = html.replace(RE, (m, pre, q, href) => {
    const c = clean(href, from);
    if (c === href) return m;
    links++;
    return `${pre}${q}${c}${q}`;
  });
  if (out !== html) { fs.writeFileSync(f, out); files++; }
}
console.log(`Rewrote ${links} links in ${files} files.`);
