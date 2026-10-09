/**
 * Static page generator.
 *
 * Real pages captured from the original WordPress theme ("shells":
 * content/templates/post.html + archive.html) are parsed ONCE and compiled into
 * string templates with %%PLACEHOLDERS%%. Every page is then a fast string fill,
 * so a full rebuild of all posts + archives takes well under a few seconds and
 * the output looks exactly like the original site.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const social = require('./social');

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (u) => (u && u.startsWith('/') ? cfg.SITE_URL + u : u || '');
const TERM_BASE = { categories: 'category', tags: 'tag', authors: 'author' };

const postUrl = (p) => `/${encodeURI(p.slug)}/`;
const termUrl = (type, slug) => `/${TERM_BASE[type]}/${encodeURI(slug)}/`;
const isoTz = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;|&rsquo;/g, '\u2019').replace(/&#8211;|&ndash;/g, '\u2013')
    .replace(/&#8212;|&mdash;/g, '\u2014').replace(/&#8230;|&hellip;/g, '\u2026').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, ' ').trim();
}

const excerptCache = new Map();
function excerptOf(post, words = 55) {
  if (post.excerpt && post.excerpt.trim()) return post.excerpt.trim();
  const key = `${post.id}|${post.modified}|${words}|${(post.content || '').length}`;
  if (!excerptCache.has(key)) {
    const all = stripHtml(post.content).split(' ');
    excerptCache.set(key, all.length > words ? all.slice(0, words).join(' ') + '\u2026' : all.join(' '));
  }
  return excerptCache.get(key);
}

const termName = (terms, type, slug) => (terms[type] && terms[type][slug]) || String(slug).replace(/-/g, ' ');

function firstImage(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : '';
}

/**
 * Find an FAQ section (heading containing "FAQ" / "Frequently Asked") and pull
 * out question/answer pairs: a question is a short block ending in "?", its
 * answer is the next non-empty block. Used for FAQPage structured data, which
 * AI answer engines read even where Google no longer shows FAQ rich results.
 */
const faqCache = new Map();
function faqFrom(html) {
  if (!html || !/faq|frequently asked/i.test(html)) return [];
  const key = html.length + ':' + html.slice(0, 64);
  if (faqCache.has(key)) return faqCache.get(key);
  const $ = cheerio.load(html);
  const head = $('h2,h3,h4').filter((_, el) => /\bfaqs?\b|frequently asked/i.test($(el).text())).first();
  const out = [];
  if (head.length) {
    const level = +head[0].tagName[1];
    const blocks = $('h2,h3,h4,h5,h6,p,li').toArray();
    let cur = null;
    for (const el of blocks.slice(blocks.indexOf(head[0]) + 1)) {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const isHead = /^h\d$/.test(el.tagName);
      if (isHead && +el.tagName[1] <= level && !t.endsWith('?')) break; // next section
      if (t.endsWith('?') && t.length <= 200) { cur = { q: t, a: '' }; out.push(cur); continue; }
      if (cur && !cur.a) cur.a = t;
    }
  }
  const pairs = out.filter((x) => x.a).slice(0, 20);
  faqCache.set(key, pairs);
  return pairs;
}

/** Single-pass placeholder fill: inserted values are never re-scanned. */
function fill(tpl, map) {
  return tpl.replace(/<!--%%([A-Z0-9_]+)%%-->|%%([A-Z0-9_]+)%%/g, (m, a, b) => {
    const v = map[a || b];
    return v === undefined ? '' : String(v);
  });
}

function writePage(rel, html) {
  const file = path.join(cfg.SITE_DIR, ...rel.split('/').filter(Boolean), 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, social.inject(html));
}

/* ---------- shell compilation ---------- */

const MANAGED_HEAD = [
  'meta[name="description"]', 'meta[name="robots"]', 'meta[property^="og:"]', 'meta[property^="article:"]',
  'meta[name^="twitter:"]', 'meta[name="generator"]', 'link[rel="canonical"]', 'link[rel="shortlink"]',
  'link[rel="EditURI"]', 'link[rel="alternate"]', 'link[rel="https://api.w.org/"]', 'script[type="application/ld+json"]',
].join(',');

function prepHead($) {
  $(MANAGED_HEAD).remove();
  $('head > title').first().text('%%TITLE%%').after('\n<!--%%HEAD%%-->');
}

function compileLoopItem($, $li) {
  $li.find('article').attr('class', '%%L_CLASS%%');
  $li.find('a.post-thumbnail').remove();
  $li.find('article').prepend('<!--%%L_THUMB%%-->');
  $li.find('.entry-taxonomies .category-links').html('%%L_CATS%%');
  $li.find('.entry-title a').attr('href', '%%L_URL%%').text('%%L_TITLE%%');
  compileMeta($li, 'L_');
  $li.find('.entry-summary').html('<p>%%L_SUMMARY%%</p>');
  const more = $li.find('a.post-more-link').attr('href', '%%L_URL%%');
  more.find('.screen-reader-text').text(' %%L_TITLE%%');
  return $.html($li);
}

function compileMeta($scope, p) {
  $scope.find('.author a').first().attr('href', `%%${p}AUTHOR_URL%%`).text(`%%${p}AUTHOR%%`);
  $scope.find('time.entry-date').first().attr('datetime', `%%${p}PUB_ISO%%`).text(`%%${p}PUB%%`);
  $scope.find('time.updated').first().attr('datetime', `%%${p}MOD_ISO%%`).text(`%%${p}MOD%%`);
}

let compiled = null;
function shells() {
  if (compiled) return compiled;
  const read = (n) => fs.readFileSync(path.join(cfg.TEMPLATE_DIR, `${n}.html`), 'utf8');

  // ---- single post
  let $ = cheerio.load(read('post'));
  prepHead($);
  $('head link[rel="stylesheet"]').last().after('\n<!--%%EXTRA_CSS%%-->');
  const postBodyClass = $('body').attr('class') || '';
  $('body').attr('class', '%%BODY_CLASS%%');
  const art = $('article.single-entry').first();
  art.attr('id', '%%ARTICLE_ID%%').attr('class', '%%ARTICLE_CLASS%%');
  art.find('.entry-header .entry-taxonomies .category-links').html('%%CATS%%');
  art.find('h1.entry-title').text('%%H1%%');
  compileMeta(art.find('.entry-header'), '');
  art.find('.entry-content.single-content').first().html('\n<!--%%CONTENT%%-->\n');
  art.find('.entry-tags').replaceWith('<!--%%TAGS%%-->');

  const nav = $('nav.post-navigation').first();
  const iconLeft = $.html(nav.find('.kadence-svg-iconset').first()) || '';
  const iconRight = $.html($('.post-more-link .kadence-svg-iconset').first()) || '';
  nav.find('.nav-links').html('<!--%%NAV_LINKS%%-->');
  const navTpl = $.html(nav);
  nav.replaceWith('<!--%%NAV%%-->');

  const related = $('.entry-related').first();
  const list = related.find('.splide__list');
  const relItemTpl = compileLoopItem($, list.children('li').first());
  list.html('<!--%%RELATED_ITEMS%%-->');
  const relatedTpl = $.html(related);
  related.replaceWith('<!--%%RELATED%%-->');
  $('#comments, .comments-area').remove();
  const postTpl = $.html();

  // ---- archive
  $ = cheerio.load(read('archive'));
  prepHead($);
  const archiveBodyClass = $('body').attr('class') || '';
  $('body').attr('class', '%%BODY_CLASS%%');
  $('h1.archive-title').text('%%H1%%');
  const alist = $('#archive-container');
  const archItemTpl = compileLoopItem($, alist.children('li').first());
  alist.html('<!--%%ITEMS%%-->');
  const pnav = $('nav.pagination').first();
  pnav.find('.nav-links').html('<!--%%PAGE_LINKS%%-->');
  const pagTpl = $.html(pnav);
  pnav.replaceWith('<!--%%PAGINATION%%-->');
  const archiveTpl = $.html();

  // ---- page (derived from the post shell: no meta, tags, post navigation or related posts)
  $ = cheerio.load(read('post'));
  prepHead($);
  $('body').attr('class', '%%BODY_CLASS%%');
  const part = $('article.single-entry').first();
  part.attr('id', '%%ARTICLE_ID%%').attr('class', '%%ARTICLE_CLASS%%');
  const ph = part.find('header.entry-header').first();
  ph.find('.entry-taxonomies, .entry-meta').remove();
  ph.contents().filter((i, n) => n.type === 'comment').remove();
  ph.removeClass('post-title').addClass('page-title');
  ph.find('h1.entry-title').text('%%H1%%');
  const pageHeaderTpl = $.html(ph);
  ph.replaceWith('<!--%%PAGE_HEADER%%-->');
  part.find('.entry-content.single-content').first().html('\n<!--%%CONTENT%%-->\n');
  part.find('.entry-tags, .entry-footer').remove();
  $('nav.post-navigation, .entry-related, #comments, .comments-area').remove();
  const pageTpl = $.html();

  compiled = { postTpl, postBodyClass, navTpl, iconLeft, iconRight, relatedTpl, relItemTpl, archiveTpl, archiveBodyClass, archItemTpl, pagTpl, pageTpl, pageHeaderTpl };
  return compiled;
}

/* ---------- shared pieces ---------- */

function robotsContent(r = {}) {
  const parts = [r.noindex ? 'noindex' : 'index', r.nofollow ? 'nofollow' : 'follow'];
  if (r.noarchive) parts.push('noarchive');
  if (r.noimageindex) parts.push('noimageindex');
  if (r.nosnippet) parts.push('nosnippet');
  if (!r.noindex && !r.nosnippet) parts.push('max-snippet:-1', 'max-video-preview:-1', 'max-image-preview:large');
  return parts.join(', ');
}

function headHtml(m) {
  const meta = (attr, k, v) => (v ? `<meta ${attr}="${k}" content="${esc(v)}" />\n` : '');
  const ogImg = abs(m.ogImage || m.image);
  const twImg = abs(m.twImage || m.ogImage || m.image);
  return [
    meta('name', 'description', m.description),
    meta('name', 'robots', robotsContent(m.robots)),
    `<link rel="canonical" href="${esc(abs(m.canonical || m.url))}" />\n`,
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:type', m.type || 'website'),
    meta('property', 'og:title', m.ogTitle || m.title),
    meta('property', 'og:description', m.ogDescription || m.description),
    meta('property', 'og:url', abs(m.url)),
    meta('property', 'og:site_name', cfg.SITE_NAME),
    meta('property', 'og:updated_time', m.modified && isoTz(m.modified)),
    meta('property', 'og:image', ogImg),
    meta('property', 'og:image:secure_url', ogImg),
    meta('property', 'og:image:alt', ogImg && (m.ogTitle || m.title)),
    ...(m.tags || []).map((t) => meta('property', 'article:tag', t)),
    meta('property', 'article:section', m.section),
    meta('property', 'article:published_time', m.published && isoTz(m.published)),
    meta('property', 'article:modified_time', m.modified && isoTz(m.modified)),
    meta('name', 'twitter:card', m.twCard || 'summary_large_image'),
    meta('name', 'twitter:title', m.twTitle || m.ogTitle || m.title),
    meta('name', 'twitter:description', m.twDescription || m.ogDescription || m.description),
    meta('name', 'twitter:image', twImg),
    m.schema ? `<script type="application/ld+json" class="seo-schema">${JSON.stringify({ '@context': 'https://schema.org', '@graph': m.schema }).replace(/</g, '\\u003c')}</script>\n` : '',
    seo.wrapGlobal(), '\n',
  ].join('');
}

/** Organization / WebSite nodes shared by every page's JSON-LD graph. */
function baseGraph() {
  const s = seo.get();
  const site = cfg.SITE_URL;
  const logo = s.orgLogo ? { '@type': 'ImageObject', '@id': `${site}/#logo`, url: abs(s.orgLogo) } : undefined;
  const org = {
    '@type': s.schemaType === 'Person' ? 'Person' : 'Organization', '@id': `${site}/#organization`,
    name: s.orgName || cfg.SITE_NAME, url: `${site}/`,
    ...(s.schemaType === 'Person' ? { image: logo } : { logo }),
    sameAs: (s.sameAs || []).filter(Boolean).length ? s.sameAs.filter(Boolean) : undefined,
  };
  const website = {
    '@type': 'WebSite', '@id': `${site}/#website`, url: `${site}/`, name: cfg.SITE_NAME,
    publisher: { '@id': org['@id'] }, inLanguage: 'en-US',
  };
  return [org, website];
}

function breadcrumb(id, items) {
  return {
    '@type': 'BreadcrumbList', '@id': id,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.url) })),
  };
}

function articleClasses(post, extra) {
  return ['entry content-bg', extra, `post-${post.id} post type-post status-publish format-standard hentry`]
    .concat((post.categories || []).map((c) => `category-${c}`), (post.tags || []).map((t) => `tag-${t}`))
    .join(' ');
}

function categoryLinks(post, terms) {
  return (post.categories || [])
    .map((c) => `<a href="${termUrl('categories', c)}" class="category-link-${esc(c)}" rel="tag">${esc(termName(terms, 'categories', c))}</a>`)
    .join(' | ');
}

function metaMap(post, terms, p = '') {
  return {
    [`${p}AUTHOR_URL`]: termUrl('authors', post.author),
    [`${p}AUTHOR`]: esc(termName(terms, 'authors', post.author)),
    [`${p}PUB_ISO`]: isoTz(post.date),
    [`${p}PUB`]: fmtDate(post.date),
    [`${p}MOD_ISO`]: isoTz(post.modified || post.date),
    [`${p}MOD`]: fmtDate(post.modified || post.date),
  };
}

function loopItem(tpl, post, terms) {
  const url = postUrl(post);
  return fill(tpl, {
    L_CLASS: articleClasses(post, 'loop-entry'),
    L_THUMB: post.featuredImage
      ? `<a aria-hidden="true" tabindex="-1" role="presentation" class="post-thumbnail kadence-thumbnail-ratio-2-3" href="${url}"><div class="post-thumbnail-inner"><img loading="lazy" src="${esc(post.featuredImage)}" alt="${esc(post.title)}" class="attachment-medium_large size-medium_large wp-post-image"></div></a>`
      : '',
    L_CATS: categoryLinks(post, terms),
    L_URL: url,
    L_TITLE: esc(post.title),
    L_SUMMARY: esc(excerptOf(post)),
    ...metaMap(post, terms, 'L_'),
  });
}

/* ---------- single post ---------- */

function relatedPosts(post, posts) {
  const tags = new Set(post.tags || []);
  const cats = new Set(post.categories || []);
  return posts
    .filter((p) => p.id !== post.id && (p.categories || []).some((c) => cats.has(c)))
    .map((p) => ({ p, score: (p.tags || []).filter((t) => tags.has(t)).length }))
    .sort((a, b) => b.score - a.score || new Date(b.p.date) - new Date(a.p.date))
    .slice(0, cfg.RELATED_POSTS)
    .map((x) => x.p);
}

function postSeo(post, terms, preview) {
  const s = seo.get();
  const url = postUrl(post);
  const canonical = post.canonical || url;
  const description = post.metaDescription || excerptOf(post, 30);
  const title = post.seoTitle || seo.titleFrom(s.postTitle, { title: post.title });
  const image = post.ogImage || post.featuredImage || firstImage(post.content) || s.defaultOgImage;
  const robots = { ...(post.robots || {}) };
  if (preview) Object.assign(robots, { noindex: true, nofollow: true });
  const cat = (post.categories || [])[0];
  const schemaType = post.schemaType || s.articleSchema || 'BlogPosting';
  const pageId = `${abs(url)}#webpage`;
  const graph = [
    ...baseGraph(),
    breadcrumb(`${abs(url)}#breadcrumb`, [
      { name: 'Home', url: '/' },
      ...(cat ? [{ name: termName(terms, 'categories', cat), url: termUrl('categories', cat) }] : []),
      { name: post.title, url },
    ]),
    {
      '@type': 'WebPage', '@id': pageId, url: abs(url), name: title, description,
      datePublished: isoTz(post.date), dateModified: isoTz(post.modified || post.date),
      isPartOf: { '@id': `${cfg.SITE_URL}/#website` }, breadcrumb: { '@id': `${abs(url)}#breadcrumb` },
      primaryImageOfPage: image ? { '@type': 'ImageObject', url: abs(image) } : undefined, inLanguage: 'en-US',
    },
  ];
  if (schemaType !== 'none') {
    graph.push({
      '@type': schemaType, '@id': `${abs(url)}#article`, headline: post.title.slice(0, 110), description,
      keywords: [post.focusKeyword, ...(post.tags || []).map((t) => termName(terms, 'tags', t))].filter(Boolean).join(', ') || undefined,
      datePublished: isoTz(post.date), dateModified: isoTz(post.modified || post.date),
      author: { '@type': 'Person', name: termName(terms, 'authors', post.author), url: abs(termUrl('authors', post.author)) },
      publisher: { '@id': `${cfg.SITE_URL}/#organization` },
      image: image ? { '@type': 'ImageObject', url: abs(image) } : undefined,
      articleSection: cat ? termName(terms, 'categories', cat) : undefined,
      wordCount: stripHtml(post.content).split(' ').filter(Boolean).length,
      mainEntityOfPage: { '@id': pageId }, inLanguage: 'en-US',
    });
  }
  const faq = faqFrom(post.content);
  if (faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage', '@id': `${abs(url)}#faq`, isPartOf: { '@id': pageId },
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  return {
    title, description, url, canonical, type: 'article', image, robots,
    published: post.date, modified: post.modified,
    ogTitle: post.ogTitle, ogDescription: post.ogDescription, ogImage: post.ogImage,
    twTitle: post.twitterTitle, twDescription: post.twitterDescription, twImage: post.twitterImage, twCard: post.twitterCard,
    section: cat ? termName(terms, 'categories', cat) : '', tags: (post.tags || []).map((t) => termName(terms, 'tags', t)),
    schema: graph,
  };
}

function renderPost(post, ctx, { preview = false } = {}) {
  const S = shells();
  const { posts, terms } = ctx;
  const meta = postSeo(post, terms, preview);

  const idx = posts.findIndex((p) => p.id === post.id);
  const older = idx >= 0 ? posts[idx + 1] : posts[0];
  const newer = idx > 0 ? posts[idx - 1] : null;
  const navLinks =
    (older ? `<div class="nav-previous"><a href="${postUrl(older)}" rel="prev"><div class="post-navigation-sub"><small>${S.iconLeft}Previous</small></div>${esc(older.title)}</a></div>` : '') +
    (newer ? `<div class="nav-next"><a href="${postUrl(newer)}" rel="next"><div class="post-navigation-sub"><small>Next${S.iconRight}</small></div>${esc(newer.title)}</a></div>` : '');

  const rel = relatedPosts(post, posts);
  const tagsHtml = (post.tags || []).length
    ? `<div class="entry-tags"><span class="tags-links"><span class="tags-label screen-reader-text">Post Tags:</span>${post.tags
      .map((t) => `<a href="${termUrl('tags', t)}" title="${esc(termName(terms, 'tags', t))}" class="tag-link tag-item-${esc(t)}" rel="tag"><span class="tag-hash">#</span>${esc(termName(terms, 'tags', t))}</a>`)
      .join('')}</span></div>`
    : '';

  return fill(S.postTpl, {
    TITLE: esc(meta.title),
    HEAD: headHtml(meta),
    EXTRA_CSS: (post.extraCss || []).map((h) => `<link rel="stylesheet" href="${esc(h)}" media="all" />`).join('\n'),
    BODY_CLASS: S.postBodyClass.replace(/\bpostid-\d+\b/, `postid-${post.id}`).replace(/\belementor-page-\d+\b/, `elementor-page-${post.id}`),
    ARTICLE_ID: `post-${post.id}`,
    ARTICLE_CLASS: articleClasses(post, 'single-entry'),
    CATS: categoryLinks(post, terms),
    H1: esc(post.title),
    ...metaMap(post, terms),
    CONTENT: post.content || '',
    TAGS: tagsHtml,
    NAV: navLinks ? fill(S.navTpl, { NAV_LINKS: navLinks }) : '',
    RELATED: rel.length ? fill(S.relatedTpl, { RELATED_ITEMS: rel.map((p) => loopItem(S.relItemTpl, p, terms)).join('\n') }) : '',
  });
}

/* ---------- pages ---------- */

const PAGE_SCHEMAS = ['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage'];

function pageSeo(page, preview) {
  const s = seo.get();
  const url = postUrl(page);
  const description = page.metaDescription || excerptOf(page, 30);
  const title = page.seoTitle || seo.titleFrom(s.pageTitle || s.postTitle, { title: page.title });
  const image = page.ogImage || page.featuredImage || firstImage(page.content) || s.defaultOgImage;
  const robots = { ...(page.robots || {}) };
  if (preview) Object.assign(robots, { noindex: true, nofollow: true });
  const type = PAGE_SCHEMAS.includes(page.schemaType) ? page.schemaType : 'WebPage';
  const graph = [
    ...baseGraph(),
    breadcrumb(`${abs(url)}#breadcrumb`, [{ name: 'Home', url: '/' }, { name: page.title, url }]),
    {
      '@type': type, '@id': `${abs(url)}#webpage`, url: abs(url), name: title, description,
      datePublished: isoTz(page.date), dateModified: isoTz(page.modified || page.date),
      isPartOf: { '@id': `${cfg.SITE_URL}/#website` }, about: { '@id': `${cfg.SITE_URL}/#organization` },
      breadcrumb: { '@id': `${abs(url)}#breadcrumb` },
      primaryImageOfPage: image ? { '@type': 'ImageObject', url: abs(image) } : undefined, inLanguage: 'en-US',
    },
  ];
  return {
    title, description, url, canonical: page.canonical || url, type: 'website', image, robots, modified: page.modified,
    ogTitle: page.ogTitle, ogDescription: page.ogDescription, ogImage: page.ogImage,
    twTitle: page.twitterTitle, twDescription: page.twitterDescription, twImage: page.twitterImage, twCard: page.twitterCard,
    schema: graph,
  };
}

function renderPage(page, { preview = false } = {}) {
  const S = shells();
  const meta = pageSeo(page, preview);
  const drop = /^(post-template-default|single|single-post|single-format-standard|elementor-page|postid-\d+|elementor-page-\d+)$/;
  const bodyClass = S.postBodyClass.split(/\s+/).filter((c) => c && !drop.test(c)).join(' ') + ` page-template-default page page-id-${page.id}`;
  return fill(S.pageTpl, {
    TITLE: esc(meta.title),
    HEAD: headHtml(meta),
    BODY_CLASS: bodyClass,
    ARTICLE_ID: `post-${page.id}`,
    ARTICLE_CLASS: `entry content-bg single-entry post-${page.id} page type-page status-publish hentry`,
    PAGE_HEADER: page.showTitle === false ? '' : fill(S.pageHeaderTpl, { H1: esc(page.title) }),
    CONTENT: page.content || '',
  });
}

function previewPage(page) { return renderPage(page, { preview: true }); }

/* ---------- archives ---------- */

function paginationHtml(current, total, base) {
  if (total <= 1) return '';
  const href = (n) => (n === 1 ? base : `${base}page/${n}/`);
  const out = [];
  if (current > 1) out.push(`<a class="prev page-numbers" href="${href(current - 1)}"><span class="screen-reader-text">Previous Page</span>&larr;</a>`);
  let dots = false;
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - current) <= 2) {
      out.push(n === current ? `<span aria-current="page" class="page-numbers current">${n}</span>` : `<a class="page-numbers" href="${href(n)}">${n}</a>`);
      dots = false;
    } else if (!dots) { out.push('<span class="page-numbers dots">&hellip;</span>'); dots = true; }
  }
  if (current < total) out.push(`<a class="next page-numbers" href="${href(current + 1)}"><span class="screen-reader-text">Next Page</span>&rarr;</a>`);
  return out.join('\n');
}

function archiveIndexable(type, slug, page) {
  const s = seo.get();
  const t = s.terms[`${type}:${slug}`] || {};
  return !t.noindex && s.index[type] !== false && (page <= 1 || s.index.paginated !== false);
}

function renderArchive({ type, slug, name, posts, page, total, terms }) {
  const S = shells();
  const s = seo.get();
  const t = s.terms[`${type}:${slug}`] || {};
  const base = termUrl(type, slug);
  const url = page > 1 ? `${base}page/${page}/` : base;
  const kind = TERM_BASE[type];
  const title = page > 1
    ? seo.titleFrom(s.pagedTitle, { term: t.title || name, page, pages: total })
    : t.title || seo.titleFrom(s.archiveTitle, { term: name });
  const label = { category: 'Posts in', tag: 'Posts tagged', author: 'Posts by' }[kind];
  const description = (t.description || `${label} ${name}.`) + (page > 1 ? ` Page ${page} of ${total}.` : '');
  const keep = S.archiveBodyClass.split(/\s+/).filter((c) => c && !/^(archive|category|tag|author|paged)(-|$)/.test(c));
  const pag = paginationHtml(page, total, base);
  const listLabel = { category: 'Blog', tag: 'Tags', author: 'Authors' }[kind];

  return fill(S.archiveTpl, {
    TITLE: esc(title),
    HEAD: headHtml({
      title, url, description, image: s.defaultOgImage,
      robots: { noindex: !archiveIndexable(type, slug, page) },
      schema: [
        ...baseGraph(),
        breadcrumb(`${abs(url)}#breadcrumb`, [{ name: 'Home', url: '/' }, ...(type === 'categories' ? [] : [{ name: listLabel, url: '/category/blog/' }]), { name, url: base }]),
        { '@type': 'CollectionPage', '@id': `${abs(url)}#webpage`, url: abs(url), name: title, description,
          isPartOf: { '@id': `${cfg.SITE_URL}/#website` }, breadcrumb: { '@id': `${abs(url)}#breadcrumb` }, inLanguage: 'en-US' },
      ],
    }),
    BODY_CLASS: [`archive ${kind} ${kind}-${slug}`, page > 1 ? `paged paged-${page}` : '', ...keep].filter(Boolean).join(' '),
    H1: esc(name),
    ITEMS: posts.map((p) => loopItem(S.archItemTpl, p, terms)).join('\n'),
    PAGINATION: pag ? fill(S.pagTpl, { PAGE_LINKS: pag }) : '',
  });
}

/* ---------- sitemap / robots.txt / RSS ---------- */

const postIndexable = (p) => !(p.robots && p.robots.noindex) && (!p.canonical || abs(p.canonical) === abs(postUrl(p)));

function defaultRobotsTxt() {
  return [
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
    '# AI search / answer engines: allowed so the site can be cited in AI answers.',
    '# Delete a line to opt that crawler out.',
    'User-agent: GPTBot',
    'User-agent: OAI-SearchBot',
    'User-agent: ChatGPT-User',
    'User-agent: ClaudeBot',
    'User-agent: Claude-SearchBot',
    'User-agent: PerplexityBot',
    'User-agent: Google-Extended',
    'User-agent: Applebot-Extended',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
  ].join('\n');
}

function writeSitemap(posts, archives, pages = []) {
  const s = seo.get();
  const urls = new Map(); // path -> { mod, img }
  if (s.sitemap.pages !== false) {
    for (const p of pages) if (postIndexable(p)) urls.set(postUrl(p), { mod: p.modified || p.date, img: p.featuredImage || firstImage(p.content) });
    for (const p of seo.staticPages()) {
      const o = s.pages[p.path] || {};
      if (o.noindex) continue;
      if (o.canonical && abs(o.canonical) !== cfg.SITE_URL + p.path) continue;
      if (/noindex/i.test(seo.readHeadInfo(p.file).robots)) continue;
      urls.set(p.path, { mod: fs.statSync(p.file).mtime });
    }
  }
  if (s.sitemap.posts !== false) for (const p of posts) if (postIndexable(p)) urls.set(postUrl(p), { mod: p.modified || p.date, img: p.featuredImage || firstImage(p.content) });
  for (const a of archives) {
    if (s.sitemap[a.type] === false || !archiveIndexable(a.type, a.slug, 1)) continue;
    urls.set(termUrl(a.type, a.slug), { mod: a.lastmod });
  }
  const body = [...urls].map(([u, { mod, img }]) =>
    `  <url><loc>${esc(cfg.SITE_URL + encodeURI(decodeURI(u)))}</loc>${mod ? `<lastmod>${isoTz(mod)}</lastmod>` : ''}${img ? `<image:image><image:loc>${esc(abs(img))}</image:loc></image:image>` : ''}</url>`).join('\n');
  fs.writeFileSync(path.join(cfg.SITE_DIR, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`);

  const robots = (s.robotsTxt && s.robotsTxt.trim() ? s.robotsTxt.trim() + '\n' : defaultRobotsTxt());
  fs.writeFileSync(path.join(cfg.SITE_DIR, 'robots.txt'),
    /sitemap:/i.test(robots) ? robots : `${robots}\nSitemap: ${cfg.SITE_URL}/sitemap.xml\n`);
  return urls.size;
}

/**
 * /llms.txt – a plain-markdown map of the site for AI assistants and answer
 * engines (proposed standard, https://llmstxt.org). Regenerated on every build.
 */
function writeLlmsTxt(posts, pages) {
  const s = seo.get();
  const line = (title, url, desc) => `- [${String(title).replace(/[[\]]/g, '')}](${abs(url)})${desc ? `: ${String(desc).replace(/\s+/g, ' ').trim()}` : ''}`;
  let home = { description: '' };
  let statics = [];
  try {
    statics = seo.listPages().filter((p) => !(s.pages[p.path] || {}).noindex && !/noindex/i.test(p.robots || ''));
    home = statics.find((p) => p.path === '/') || home;
  } catch { /* static pages unreadable – skip */ }
  const desc = (s.pages['/'] && s.pages['/'].description) || home.description || `${cfg.SITE_NAME} blog`;
  const short = (t) => String(t || '').split(/\s+[-–—|]\s+/)[0].trim();
  const out = [
    `# ${cfg.SITE_NAME}${s.orgName && s.orgName !== cfg.SITE_NAME ? ` (${s.orgName})` : ''}`,
    '',
    `> ${desc}`,
    '',
    '## Main pages',
    ...statics.map((p) => line(short(p.title) || p.path, p.path, (s.pages[p.path] || {}).description || p.description)),
    ...pages.filter(postIndexable).map((p) => line(p.title, postUrl(p), p.metaDescription || excerptOf(p, 25))),
    '',
    '## Blog posts',
    ...posts.filter(postIndexable).map((p) => line(p.title, postUrl(p), p.metaDescription || excerptOf(p, 25))),
    '',
    '## Optional',
    `- [Sitemap](${cfg.SITE_URL}/sitemap.xml)`,
    ...(s.rss ? [`- [RSS feed](${cfg.SITE_URL}/feed/)`] : []),
    '',
  ];
  fs.writeFileSync(path.join(cfg.SITE_DIR, 'llms.txt'), out.join('\n'));
}

function writeFeed(posts, terms) {
  const s = seo.get();
  const file = path.join(cfg.SITE_DIR, 'feed.xml');
  if (!s.rss) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  const x = (v) => esc(v).replace(/&#?\w+;/g, (m) => (['&amp;', '&lt;', '&gt;', '&quot;'].includes(m) ? m : ''));
  const items = posts.filter(postIndexable).slice(0, 20).map((p) => `    <item>
      <title>${x(p.title)}</title>
      <link>${x(abs(postUrl(p)))}</link>
      <guid isPermaLink="true">${x(abs(postUrl(p)))}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <dc:creator>${x(termName(terms, 'authors', p.author))}</dc:creator>
${(p.categories || []).map((c) => `      <category>${x(termName(terms, 'categories', c))}</category>`).join('\n')}
      <description>${x(p.metaDescription || excerptOf(p))}</description>
    </item>`).join('\n');
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${x(cfg.SITE_NAME)}</title>
    <link>${x(cfg.SITE_URL)}/</link>
    <atom:link href="${x(cfg.SITE_URL)}/feed/" rel="self" type="application/rss+xml" />
    <description>${x(cfg.SITE_NAME)} blog</description>
    <language>en-US</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`);
}

/* ---------- full build ---------- */

function safeRemove(rel) {
  if (!rel || rel.includes('..')) return;
  const top = rel.split('/')[0];
  if (cfg.RESERVED_SLUGS.includes(top) && !['category', 'tag', 'author'].includes(top)) return;
  const dir = path.join(cfg.SITE_DIR, ...rel.split('/').filter(Boolean));
  if (dir !== cfg.SITE_DIR && dir.startsWith(cfg.SITE_DIR + path.sep) && fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (e) { console.warn(`Could not remove ${rel}: ${e.code || e.message}`); }
  }
}

function buildAll() {
  const t0 = Date.now();
  const posts = store.publishedPosts();
  const pages = store.publishedPages();
  const terms = store.getTerms();
  const ctx = { posts, terms };
  const old = store.readJson(cfg.MANIFEST_FILE, { posts: [], archives: [] });

  const newPosts = posts.map((p) => p.slug);
  const newPages = pages.map((p) => p.slug);
  const live = new Set([...newPosts, ...newPages]);
  for (const s of [...(old.posts || []), ...(old.pages || [])]) if (!live.has(s)) safeRemove(s);
  for (const p of posts) writePage(p.slug, renderPost(p, ctx));
  for (const p of pages) writePage(p.slug, renderPage(p));

  const groups = new Map();
  for (const p of posts) {
    for (const [type, list] of [['categories', p.categories], ['tags', p.tags], ['authors', [p.author]]]) {
      for (const slug of list || []) {
        if (!slug) continue;
        const k = `${type}|${slug}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
    }
  }
  const newArchives = [];
  const archiveList = [];
  let archivePages = 0;
  for (const [k, list] of groups) {
    const [type, slug] = k.split('|');
    const base = `${TERM_BASE[type]}/${slug}`;
    newArchives.push(base);
    archiveList.push({ type, slug, lastmod: list[0].modified || list[0].date });
    const total = Math.max(1, Math.ceil(list.length / cfg.POSTS_PER_PAGE));
    for (let page = 1; page <= total; page++) {
      const chunk = list.slice((page - 1) * cfg.POSTS_PER_PAGE, page * cfg.POSTS_PER_PAGE);
      writePage(page === 1 ? base : `${base}/page/${page}`, renderArchive({ type, slug, name: termName(terms, type, slug), posts: chunk, page, total, terms }));
      archivePages++;
    }
    // drop pagination pages that no longer exist
    const pageDir = path.join(cfg.SITE_DIR, ...base.split('/'), 'page');
    if (fs.existsSync(pageDir)) {
      for (const n of fs.readdirSync(pageDir)) if (!(+n >= 2 && +n <= total)) safeRemove(`${base}/page/${n}`);
    }
  }
  for (const a of old.archives || []) if (!newArchives.includes(a)) safeRemove(a);

  store.writeJson(cfg.MANIFEST_FILE, { posts: newPosts, pages: newPages, archives: newArchives, builtAt: new Date().toISOString() });
  const sitemapUrls = writeSitemap(posts, archiveList, pages);
  writeFeed(posts, terms);
  writeLlmsTxt(posts, pages);
  return { posts: posts.length, pages: pages.length, archivePages, sitemapUrls, ms: Date.now() - t0 };
}

function previewPost(post) {
  const posts = store.publishedPosts();
  const list = posts.some((p) => p.id === post.id) ? posts.map((p) => (p.id === post.id ? post : p)) : [post, ...posts];
  return renderPost(post, { posts: list, terms: store.getTerms() }, { preview: true });
}

module.exports = { buildAll, previewPost, previewPage, renderPost, renderPage, excerptOf, stripHtml, postUrl, defaultRobotsTxt, PAGE_SCHEMAS, reloadTemplates: () => { compiled = null; } };
