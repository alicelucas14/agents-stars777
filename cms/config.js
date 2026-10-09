const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,
  SITE_DIR: path.join(ROOT, 'site'),
  CONTENT_DIR: path.join(ROOT, 'content'),
  POSTS_DIR: path.join(ROOT, 'content', 'posts'),
  PAGES_DIR: path.join(ROOT, 'content', 'pages'),
  MENU_FILE: path.join(ROOT, 'content', 'menu.json'),
  TEMPLATE_DIR: path.join(ROOT, 'content', 'templates'),
  TERMS_FILE: path.join(ROOT, 'content', 'terms.json'),
  MANIFEST_FILE: path.join(ROOT, 'content', 'build-manifest.json'),
  AUTH_FILE: path.join(ROOT, 'content', 'admin.json'),

  // Public URL of the site – used for canonical / Open Graph / sitemap.
  SITE_URL: (process.env.SITE_URL || 'https://agents.stars777.org').replace(/\/$/, ''),
  SITE_NAME: process.env.SITE_NAME || 'Big Agents',
  ORIGIN: 'https://agents.stars777.org', // original WordPress site (used by the importer)

  POSTS_PER_PAGE: 10,
  RELATED_POSTS: 6,
  PORT: +(process.env.PORT || 3000),

  // Top-level folders that can never be used as a post slug.
  RESERVED_SLUGS: ['admin', 'api', 'wp-content', 'wp-includes', 'wp-admin', 'category', 'tag', 'author', 'page', 'feed'],
};
