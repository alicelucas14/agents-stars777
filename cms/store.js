/**
 * File-based content store (no database).
 *   content/posts/<id>.json   one file per post
 *   content/pages/<id>.json   one file per page (pages created in the admin)
 *   content/terms.json        categories / tags / authors  { slug: name }
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

fs.mkdirSync(cfg.POSTS_DIR, { recursive: true });
fs.mkdirSync(cfg.PAGES_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic-ish write
}

/* ---------- slugs ---------- */

function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'post';
}

/* ---------- posts ---------- */

function allPosts() {
  return fs.readdirSync(cfg.POSTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(cfg.POSTS_DIR, f), null))
    .filter(Boolean);
}

function publishedPosts() {
  return allPosts()
    .filter((p) => p.status === 'publish')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getPost(id) {
  return readJson(path.join(cfg.POSTS_DIR, `${+id}.json`), null);
}

function nextId() {
  const ids = [...allPosts(), ...allPages()].map((p) => p.id);
  return Math.max(10000, ...ids) + 1;
}

function savePost(post) {
  writeJson(path.join(cfg.POSTS_DIR, `${post.id}.json`), post);
  return post;
}

function deletePost(id) {
  const file = path.join(cfg.POSTS_DIR, `${+id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/* ---------- pages ---------- */

function allPages() {
  return fs.readdirSync(cfg.PAGES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(cfg.PAGES_DIR, f), null))
    .filter(Boolean);
}
const publishedPages = () => allPages().filter((p) => p.status === 'publish');
const getPage = (id) => readJson(path.join(cfg.PAGES_DIR, `${+id}.json`), null);
function savePage(page) { writeJson(path.join(cfg.PAGES_DIR, `${page.id}.json`), page); return page; }
function deletePage(id) {
  const file = path.join(cfg.PAGES_DIR, `${+id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** True if `slug` is free for post/page `id` (no other post or page, not reserved, no static page folder). */
function slugAvailable(slug, id, manifest) {
  if (!slug || cfg.RESERVED_SLUGS.includes(slug)) return false;
  if ([...allPosts(), ...allPages()].some((p) => p.slug === slug && p.id !== id)) return false;
  const owned = new Set([...((manifest && manifest.posts) || []), ...((manifest && manifest.pages) || [])]);
  const dir = path.join(cfg.SITE_DIR, slug);
  if (fs.existsSync(dir) && !owned.has(slug)) return false; // a static page already lives there
  return true;
}

function uniqueSlug(base, id, manifest) {
  let slug = base, n = 2;
  while (!slugAvailable(slug, id, manifest)) slug = `${base}-${n++}`;
  return slug;
}

/* ---------- terms ---------- */

function getTerms() {
  const t = readJson(cfg.TERMS_FILE, {});
  return { categories: t.categories || {}, tags: t.tags || {}, authors: t.authors || {} };
}
function saveTerms(t) { writeJson(cfg.TERMS_FILE, t); }

function ensureTerm(type, nameOrSlug) {
  const terms = getTerms();
  const map = terms[type];
  const slug = slugify(nameOrSlug);
  if (!map[slug]) {
    // if the value given is already a known slug keep it, otherwise register the new name
    map[slug] = String(nameOrSlug).trim();
    saveTerms(terms);
  }
  return slug;
}

module.exports = {
  readJson, writeJson, slugify,
  allPosts, publishedPosts, getPost, nextId, savePost, deletePost, slugAvailable, uniqueSlug,
  allPages, publishedPages, getPage, savePage, deletePage,
  getTerms, saveTerms, ensureTerm,
};
