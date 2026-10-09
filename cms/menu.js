/**
 * Header navigation menu (desktop #primary-menu + mobile #mobile-menu).
 * Stored in content/menu.json and written into the theme shells (so generated
 * posts/pages/archives get it) and into every static page.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Turn mirrored relative links ("index.html#About", "register/index.html") into root-relative ones. */
function normUrl(href) {
  let u = String(href || '').trim();
  if (!u || /^(https?:|mailto:|tel:|#|\/)/i.test(u)) return u;
  u = '/' + u.replace(/^(\.\.\/)+|^\.\//, '');
  return u.replace(/(^|\/)index\.html(?=$|[#?])/i, '$1');
}

function fromHtml(html) {
  const $ = cheerio.load(html);
  return $('#primary-menu > li').toArray().map((li) => {
    const a = $(li).children('a').first();
    return { label: a.text().trim(), url: normUrl(a.attr('href')), newTab: a.attr('target') === '_blank' };
  }).filter((i) => i.label);
}

function get() {
  const saved = store.readJson(cfg.MENU_FILE, null);
  if (saved && Array.isArray(saved.items)) return saved.items;
  try { return fromHtml(fs.readFileSync(path.join(cfg.TEMPLATE_DIR, 'post.html'), 'utf8')); } catch { return []; }
}

function itemsHtml(items, withId) {
  return items.map((it, i) => {
    const n = 90001 + i;
    const target = it.newTab ? ' target="_blank" rel="noopener"' : '';
    return `<li${withId ? ` id="menu-item-${n}"` : ''} class="menu-item menu-item-type-custom menu-item-object-custom menu-item-${n}"><a href="${esc(it.url)}"${target}>${esc(it.label)}</a></li>`;
  }).join('\n');
}

/** Replace the inner HTML of <ul id="..."> (handles nested lists). */
function replaceUl(html, id, inner) {
  const start = html.search(new RegExp(`<ul\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i'));
  if (start === -1) return html;
  const open = html.indexOf('>', start) + 1;
  const re = /<\/?ul\b[^>]*>/gi;
  re.lastIndex = open;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(0, open) + inner + html.slice(m.index);
  }
  return html;
}

function applyTo(html, items) {
  return replaceUl(replaceUl(html, 'primary-menu', itemsHtml(items, true)), 'mobile-menu', itemsHtml(items, false));
}

function sanitize(items) {
  return (Array.isArray(items) ? items : [])
    .map((i) => ({ label: String(i.label || '').trim().slice(0, 80), url: normUrl(String(i.url || '').trim().slice(0, 500)), newTab: !!i.newTab }))
    .filter((i) => i.label && i.url && !/^\s*javascript:/i.test(i.url));
}

/** Save the menu and write it into templates + static pages. Caller rebuilds generated pages. */
function save(items) {
  const clean = sanitize(items);
  store.writeJson(cfg.MENU_FILE, { items: clean });
  let files = 0;
  const targets = [
    path.join(cfg.TEMPLATE_DIR, 'post.html'), path.join(cfg.TEMPLATE_DIR, 'archive.html'),
    ...seo.staticPages().map((p) => p.file),
  ];
  for (const f of targets) {
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const out = applyTo(html, clean);
    if (out !== html) { fs.writeFileSync(f, out); files++; }
  }
  return { items: clean, files };
}

module.exports = { get, save, normUrl, applyTo };
