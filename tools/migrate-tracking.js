#!/usr/bin/env node
/**
 * Move Google Analytics (gtag.js) tags that were hard-coded into the exported
 * WordPress HTML into Admin → SEO → Webmaster Tools → Custom <head> code, so
 * they are visible and editable in the admin panel.
 *
 *  - finds every GA4 / UA measurement ID used in the theme templates + site HTML
 *  - backs up every file it changes to content/backup-tracking-<timestamp>/
 *  - removes the hard-coded tags (never touches the admin-managed block)
 *  - saves one clean snippet into the Custom <head> code setting
 *  - re-injects it everywhere and rebuilds
 *
 * Safe to run more than once. Usage: node tools/migrate-tracking.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');
const seo = require('../cms/seo');
const render = require('../cms/render');

const DRY = process.argv.includes('--dry');
const GLOBAL_RE = /<!--cms:global-->[\s\S]*?<!--\/cms:global-->/g;
const LOADER_RE = /[ \t]*<script\b[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)["'][^>]*>\s*<\/script>[ \t]*\r?\n?/gi;
const INLINE_RE = /[ \t]*<script\b[^>]*>(?:(?!<\/script>)[\s\S]){0,800}?function gtag\(\)\{dataLayer\.push\(arguments\);\}(?:(?!<\/script>)[\s\S]){0,800}?<\/script>[ \t]*\r?\n?/gi;

/** Remove hard-coded gtag blocks outside the admin-managed <!--cms:global--> block. */
function strip(html, ids) {
  const keep = [];
  const masked = html.replace(GLOBAL_RE, (m) => { keep.push(m); return `\u0000G${keep.length - 1}\u0000`; });
  let n = 0;
  let out = masked
    .replace(LOADER_RE, (m, id) => { ids.add(id); n++; return ''; })
    .replace(INLINE_RE, (m) => {
      // only remove pure GA config blocks (dataLayer + gtag(...) calls), nothing else
      const body = m.replace(/<\/?script[^>]*>/gi, '');
      const rest = body.replace(/window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];?|function gtag\(\)\{dataLayer\.push\(arguments\);\}|gtag\((?:[^()]|\([^()]*\))*\);?|\s+/g, '');
      if (rest) return m;
      for (const [, id] of body.matchAll(/gtag\(\s*['"]config['"]\s*,\s*['"]([A-Z0-9-]+)['"]/g)) ids.add(id);
      n++;
      return '';
    });
  out = out.replace(/[ \t]*<!-- Google tag \(gtag\.js\) -->[ \t]*\r?\n?/g, () => { n++; return ''; });
  out = out.replace(/\u0000G(\d+)\u0000/g, (_, i) => keep[+i]);
  return { out, n };
}

function htmlFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(wp-content|wp-includes)$/.test(e.name)) htmlFiles(f, acc); }
    else if (e.name.endsWith('.html')) acc.push(f);
  }
  return acc;
}

const files = [...htmlFiles(cfg.TEMPLATE_DIR), ...htmlFiles(cfg.SITE_DIR)];
const ids = new Set();
const changed = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  if (!/googletagmanager\.com\/gtag|function gtag\(\)/.test(html)) continue;
  const { out, n } = strip(html, ids);
  if (n && out !== html) changed.push({ f, out, html });
}

const s = seo.get();
const existing = s.headCode || '';
const already = [...ids].filter((id) => existing.includes(id));
const toAdd = [...ids].filter((id) => !existing.includes(id));
console.log(`Measurement IDs found: ${[...ids].join(', ') || 'none'}`);
console.log(`Files with hard-coded tags: ${changed.length}`);
if (already.length) console.log(`Already in Custom <head> code: ${already.join(', ')}`);

if (DRY) { console.log('(dry run – nothing written)'); process.exit(0); }
if (!changed.length && !toAdd.length) { console.log('Nothing to do.'); process.exit(0); }

// 1. back up originals
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(cfg.CONTENT_DIR, `backup-tracking-${stamp}`);
for (const { f, html } of changed) {
  const rel = path.relative(cfg.ROOT, f);
  const dest = path.join(backup, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
}
// 2. save the snippet into the admin setting (before touching pages, so tracking is never lost)
if (toAdd.length) {
  const snippet = [
    '<!-- Google Analytics (GA4) -->',
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${toAdd[0]}"></script>`,
    '<script>',
    '  window.dataLayer = window.dataLayer || [];',
    '  function gtag(){dataLayer.push(arguments);}',
    "  gtag('js', new Date());",
    ...toAdd.map((id) => `  gtag('config', '${id}');`),
    '</script>',
  ].join('\n');
  s.headCode = existing.trim() ? `${snippet}\n\n${existing.trim()}` : snippet;
  seo.save(s);
}
// 3. strip hard-coded copies
for (const { f, out } of changed) fs.writeFileSync(f, out);
// 4. re-inject + rebuild
render.reloadTemplates();
const statics = seo.applyGlobalToStatic();
const build = render.buildAll();
console.log(`Backup: ${path.relative(cfg.ROOT, backup)}`);
console.log(`Saved to Admin → SEO → Webmaster Tools → Custom <head> code. Static pages updated: ${statics}. Rebuilt ${build.posts} posts.`);
