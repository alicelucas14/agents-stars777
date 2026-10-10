#!/usr/bin/env node
/**
 * One-off fixes for the static (mirrored Elementor) pages in site/.
 *
 *   node tools/fix-static.js            apply
 *   node tools/fix-static.js --dry-run  only report what would change
 *
 * Broken image candidates: srcset/src entries pointing at
 * "…/uploads/YYYY/MM/elementor/thumbs/<file>" (a mirroring mistake) are
 * pointed at "…/uploads/YYYY/MM/<file>" when that file exists, or dropped
 * from the srcset so the browser uses one of the other sizes.
 *
 * Headings: every page gets exactly one <h1> (see cms/headings.js). The
 * server also does this on start-up.
 *
 * Safe to run more than once.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');
const seo = require('../cms/seo');
const { ensureH1 } = require('../cms/headings');

const DRY = process.argv.includes('--dry-run');

function fixThumbs(html) {
  let n = 0;
  const out = html.replace(/((?:\.\.\/)*|\/|https?:\/\/[^/"'\s]+\/)wp-content\/uploads\/(\d{4}\/\d{2})\/elementor\/thumbs\/([^\s"',]+)(\s+\d+w)?(\s*,\s*)?/g,
    (all, pre, ym, name, w = '', comma = '') => {
      n++;
      const real = path.join(cfg.SITE_DIR, 'wp-content', 'uploads', ...ym.split('/'), name);
      if (fs.existsSync(real)) return `${pre}wp-content/uploads/${ym}/${name}${w}${comma}`;
      return ''; // drop the candidate; the other srcset sizes still work
    });
  // a dropped last candidate can leave a trailing ", " before the closing quote
  return n ? { out: out.replace(/,\s*(["'])/g, '$1'), n } : null;
}

let total = 0, headings = 0;
for (const p of seo.staticPages()) {
  const html = fs.readFileSync(p.file, 'utf8');
  let out = html;
  const t = fixThumbs(out);
  if (t) {
    total += t.n;
    out = t.out;
    console.log(`${p.path.padEnd(50)} ${t.n} broken thumbnail link(s)`);
  }
  const h = ensureH1(out);
  if (h) {
    headings++;
    out = h.html;
    console.log(`${p.path.padEnd(50)} h1: ${h.action}`);
  }
  if (!DRY && out !== html) fs.writeFileSync(p.file, out);
}
console.log(`\n${DRY ? '[dry run] would fix' : 'Fixed'} ${total} broken thumbnail link(s) and ${headings} page heading(s).`);
