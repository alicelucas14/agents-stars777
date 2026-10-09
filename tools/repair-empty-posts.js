#!/usr/bin/env node
/**
 * Repair posts whose body was not captured by the original import.
 *
 * Older posts on the WordPress site use a full-width Elementor layout, so their
 * body lives in [data-elementor-type="wp-post"] instead of
 * .entry-content.single-content – the importer found nothing and saved "".
 *
 * This tool ONLY touches posts whose content is empty. It fetches the live page,
 * extracts the Elementor post body, downloads any missing images, and saves the
 * content. Titles, SEO fields, tags, edits etc. are left untouched.
 *
 * Usage: node tools/repair-empty-posts.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const cfg = require('../cms/config');
const store = require('../cms/store');

const DRY = process.argv.includes('--dry');
const ORIGIN = cfg.ORIGIN;
const HOST_RE = ORIGIN.replace(/^https?:\/\//, '').replace(/\./g, '\\.');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(url, as = 'text', tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return as === 'buf' ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 600 * i));
    }
  }
}

const localize = (s) => s
  .replace(new RegExp(`(?:https?:)?//${HOST_RE}(?=["'\\s<)])`, 'g'), '/')
  .replace(new RegExp(`(?:https?:)?//${HOST_RE}(?=/)`, 'g'), '');

async function ensureImages(html) {
  const refs = new Set();
  for (const [, u] of html.matchAll(/(?:src|data-src)=["'](\/wp-content\/uploads\/[^"']+)["']/gi)) refs.add(u);
  for (const [, set] of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    set.split(',').forEach((s) => { const u = s.trim().split(/\s+/)[0]; if (u.startsWith('/wp-content/uploads/')) refs.add(u); });
  }
  let added = 0;
  for (let u of refs) {
    u = u.split(/[?#]/)[0];
    try { u = decodeURI(u); } catch {}
    const file = path.join(cfg.SITE_DIR, ...u.split('/').filter(Boolean));
    if (fs.existsSync(file)) continue;
    try {
      const buf = await get(ORIGIN + encodeURI(u), 'buf', 2);
      if (!DRY) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
      added++;
    } catch { /* missing on origin too – skip */ }
  }
  return added;
}

(async () => {
  const empty = store.allPosts().filter((p) => !p.content || p.content.trim().length < 50);
  console.log(`${empty.length} posts with empty content${DRY ? ' (dry run)' : ''}`);
  let fixed = 0, failed = [];
  for (const p of empty) {
    try {
      const html = localize(await get(`${ORIGIN}/${encodeURI(p.slug)}/`));
      const $ = cheerio.load(html);
      const body = $('[data-elementor-type="wp-post"]').first();
      if (!body.length || !body.text().trim()) throw new Error('no Elementor post body found');
      // The theme template already renders the post title as the page <h1>;
      // demote any <h1> inside the body so each page keeps exactly one H1.
      body.find('h1').each((_, el) => { el.tagName = 'h2'; });
      body.find('script').remove();
      const content = $.html(body).trim();
      const imgs = await ensureImages(content);
      const words = body.text().replace(/\s+/g, ' ').trim().split(' ').length;
      if (!DRY) {
        const fresh = store.getPost(p.id); // re-read to avoid clobbering concurrent edits
        fresh.content = content;
        store.savePost(fresh);
      }
      fixed++;
      console.log(`  ✓ ${p.slug}  (${words} words${imgs ? `, ${imgs} images downloaded` : ''})`);
    } catch (e) {
      failed.push(p.slug);
      console.log(`  ✗ ${p.slug}  – ${e.message}`);
    }
  }
  console.log(`\nRepaired ${fixed}/${empty.length}.${failed.length ? ` Failed: ${failed.join(', ')}` : ''}`);
  if (!DRY && fixed) console.log('Run "npm run build" (or restart the server / click Rebuild) to regenerate the pages.');
})();
