#!/usr/bin/env node
/**
 * Re-generate everything in site/ from content/ – run after deploying code
 * (e.g. after `git checkout -- site/ && git pull`), so the live site's own
 * posts, menu, SEO and social settings are written back into the pages.
 *
 *   node tools/reapply.js
 *
 * Steps: header menu -> static-page SEO overrides -> global SEO head + H1 fix
 * -> social bar -> clean-hash script -> rebuild posts/archives/sitemap/404.
 * Safe to run any time. Restart the server afterwards.
 */
const fs = require('fs');
const cfg = require('../cms/config');
const store = require('../cms/store');
const seo = require('../cms/seo');
const menu = require('../cms/menu');
const social = require('../cms/social');
const cleanhash = require('../cms/cleanhash');
const render = require('../cms/render');

const step = (name, fn) => {
  try { console.log(`${name.padEnd(28)} ${JSON.stringify(fn())}`); }
  catch (e) { console.error(`${name.padEnd(28)} FAILED: ${e.message}`); process.exitCode = 1; }
};

step('menu', () => {
  if (!fs.existsSync(cfg.MENU_FILE)) return 'no saved menu (kept as is)';
  const items = (store.readJson(cfg.MENU_FILE, {}) || {}).items;
  return Array.isArray(items) && items.length ? menu.save(items).files + ' files' : 'empty menu (kept as is)';
});
step('static page SEO overrides', () => seo.reapplyPages());
step('global SEO head + H1', () => seo.applyGlobalToStatic());
step('social bar', () => social.applyAll());
step('clean-hash', () => cleanhash.applyAll());
step('rebuild posts/archives', () => render.buildAll());
console.log('\nDone. Now restart the server.');
