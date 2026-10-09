#!/usr/bin/env node
/**
 * One-time import from the live WordPress site into the file-based CMS.
 *
 *  - Post list, dates, categories, tags, featured images  -> WP REST API
 *  - Post body (Elementor markup), SEO title/description   -> the live post page
 *  - Theme "shells" for posts and archives                  -> content/templates/
 *  - Any CSS / JS / image referenced but missing locally    -> downloaded into site/
 *
 * Usage: node tools/import-wp.js
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const cfg = require('../cms/config');
const store = require('../cms/store');

const ORIGIN = cfg.ORIGIN;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HOST_RE = ORIGIN.replace(/^https?:\/\//, '').replace(/\./g, '\\.');

async function get(url, as = 'text', tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return as === 'json' ? { data: await r.json(), headers: r.headers } : as === 'buf' ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 600 * i));
    }
  }
}

async function getAll(endpoint) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const { data, headers } = await get(`${ORIGIN}/wp-json/wp/v2/${endpoint}${sep}per_page=100&page=${page}`, 'json');
    out.push(...data);
    if (page >= +(headers.get('x-wp-totalpages') || 1)) break;
  }
  return out;
}

/** Turn absolute links to the old domain into root-relative ones (plain + JSON-escaped). */
function localize(s) {
  return s
    .replace(new RegExp(`(?:https?:)?//${HOST_RE}(?=["'\\s<)])`, 'g'), '/')
    .replace(new RegExp(`(?:https?:)?//${HOST_RE}(?=/)`, 'g'), '')
    .replace(new RegExp(`(?:https?:)?\\\\/\\\\/${HOST_RE}(?=["'])`, 'g'), '\\/')
    .replace(new RegExp(`(?:https?:)?\\\\/\\\\/${HOST_RE}`, 'g'), '');
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/* ---------- missing-asset downloader ---------- */

const seenAssets = new Set();
async function ensureAsset(p) {
  p = p.split(/[?#]/)[0];
  try { p = decodeURI(p); } catch {}
  if (seenAssets.has(p) || !/^\/wp-(content|includes)\/.+\.[a-z0-9]+$/i.test(p)) return;
  seenAssets.add(p);
  const file = path.join(cfg.SITE_DIR, ...p.split('/').filter(Boolean));
  const isCss = /\.css$/i.test(p);
  if (fs.existsSync(file) && !isCss) return;
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    try { buf = await get(ORIGIN + encodeURI(p), 'buf', 2); } catch { return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log(`  + ${p}`);
  }
  if (isCss) {
    for (const [, ref] of buf.toString('utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      if (/^(data:|#|https?:|\/\/)/i.test(ref)) continue;
      await ensureAsset(new URL(ref, 'https://x' + p).pathname);
    }
  }
}
async function ensureAssetsIn(html) {
  const refs = new Set();
  for (const [, u] of html.matchAll(/(?:src|href|data-src|content)=["'](\/wp-(?:content|includes)\/[^"']+)["']/gi)) refs.add(u);
  for (const [, set] of html.matchAll(/srcset=["']([^"']+)["']/gi)) set.split(',').forEach((s) => { const u = s.trim().split(/\s+/)[0]; if (u.startsWith('/wp-')) refs.add(u); });
  for (const [, u] of html.matchAll(/url\(\s*['"]?(\/wp-(?:content|includes)\/[^'")]+)/gi)) refs.add(u);
  for (const u of refs) await ensureAsset(u.replace(/&amp;/g, '&'));
}

/* ---------- main ---------- */

async function main() {
  console.log('Fetching taxonomy + post list from REST API…');
  const [cats, tags, posts] = await Promise.all([
    getAll('categories?_fields=id,slug,name'),
    getAll('tags?_fields=id,slug,name'),
    getAll('posts?_fields=id,slug,link,date_gmt,modified_gmt,title,categories,tags,featured_media'),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  console.log(`  ${posts.length} posts, ${cats.length} categories, ${tags.length} tags`);

  const terms = { categories: {}, tags: {}, authors: {} };
  const unionCss = new Map(); // id -> <link> html (widget CSS that differs between posts)
  const imported = [];

  console.log('Fetching post pages…');
  await pool(posts, 6, async (wp) => {
    const html = localize(await get(wp.link));
    const $ = cheerio.load(html);
    const authorA = $('.entry-header .author a').first();
    const authorSlug = ((authorA.attr('href') || '').match(/\/author\/([^/]+)/) || [])[1] || 'admin';
    terms.authors[authorSlug] = authorA.text().trim() || authorSlug;

    const extraCss = [];
    $('head link[rel="stylesheet"]').each((_, el) => {
      const id = $(el).attr('id') || '';
      if (id === `elementor-post-${wp.id}-css`) extraCss.push($(el).attr('href'));
      else if (id) unionCss.set(id, $.html(el));
    });

    let featuredImage = '';
    if (wp.featured_media) {
      try { featuredImage = localize((await get(`${ORIGIN}/wp-json/wp/v2/media/${wp.featured_media}?_fields=source_url`, 'json')).data.source_url); } catch {}
    }

    const content = ($('.entry-content.single-content').first().html() || '').trim();
    await ensureAssetsIn(content);
    for (const h of extraCss) await ensureAsset(h);

    const post = {
      id: wp.id,
      slug: decodeURIComponent(wp.slug),
      title: cheerio.load(`<i>${wp.title.rendered}</i>`)('i').text(),
      status: 'publish',
      date: wp.date_gmt + 'Z',
      modified: wp.modified_gmt + 'Z',
      author: authorSlug,
      categories: wp.categories.map((id) => catById.get(id)).filter(Boolean).map((c) => c.slug),
      tags: wp.tags.map((id) => tagById.get(id)).filter(Boolean).map((t) => t.slug),
      excerpt: '',
      content,
      seoTitle: $('title').first().text().trim(),
      metaDescription: $('meta[name="description"]').attr('content') || '',
      featuredImage,
      extraCss,
    };
    const decode = (s) => cheerio.load(`<i>${s}</i>`)('i').text();
    post.categories.forEach((s) => { terms.categories[s] = decode(cats.find((c) => c.slug === s).name); });
    post.tags.forEach((s) => { terms.tags[s] = decode(tags.find((t) => t.slug === s).name); });
    imported.push(post);
    process.stdout.write(`\r  ${imported.length}/${posts.length}`);
  });
  console.log('');

  console.log('Building theme shells…');
  fs.mkdirSync(cfg.TEMPLATE_DIR, { recursive: true });
  const newest = [...imported].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  {
    const $ = cheerio.load(localize(await get(`${ORIGIN}/${encodeURI(newest.slug)}/`)));
    $(`link#elementor-post-${newest.id}-css`).remove();
    const have = new Set($('head link[rel="stylesheet"]').map((_, el) => $(el).attr('id')).get());
    const last = $('head link[rel="stylesheet"]').last();
    for (const [id, html] of unionCss) if (!have.has(id) && !/^elementor-post-\d+-css$/.test(id)) last.after('\n' + html);
    const out = $.html();
    await ensureAssetsIn(out);
    fs.writeFileSync(path.join(cfg.TEMPLATE_DIR, 'post.html'), out);
  }
  {
    const out = localize(await get(`${ORIGIN}/category/blog/`));
    await ensureAssetsIn(out);
    fs.writeFileSync(path.join(cfg.TEMPLATE_DIR, 'archive.html'), out);
  }

  console.log('Saving content…');
  for (const p of imported) store.savePost(p);
  store.saveTerms(terms);

  const listDirs = (sub) => {
    const d = path.join(cfg.SITE_DIR, sub);
    return fs.existsSync(d) ? fs.readdirSync(d).map((n) => `${sub}/${n}`) : [];
  };
  store.writeJson(cfg.MANIFEST_FILE, {
    posts: imported.map((p) => p.slug),
    archives: [...listDirs('category'), ...listDirs('tag'), ...listDirs('author')],
    importedAt: new Date().toISOString(),
  });
  console.log(`Done: ${imported.length} posts imported into content/posts/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
