#!/usr/bin/env node
/**
 * Make a small animated-WebP copy of every animated GIF in site/wp-content/uploads
 * (x.gif -> x.webp, next to the original). The originals are NOT touched or deleted:
 * they stay for social-media preview images (og:image / twitter:image), while the pages
 * themselves load the WebP (see cms/gifswap.js).
 *
 *   node tools/gif-to-webp.js            convert what is missing, skip what exists
 *   node tools/gif-to-webp.js --force    redo everything
 *   node tools/gif-to-webp.js --dry      only list what would be converted
 *
 * A WebP is kept only when it has the same size and number of frames as the GIF and is at
 * least 15% smaller; otherwise it is thrown away and the GIF keeps being used.
 * Needs the "sharp" package (same one the admin upload optimiser uses).
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');

const QUALITY = 60;   // looks the same as the GIF on screen, ~75% smaller
const EFFORT = 4;     // 0 (fast) .. 6 (smallest)
const KEEP_IF_BELOW = 0.85;
const CONCURRENCY = 3;

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY = args.has('--dry');

let sharp;
try { sharp = require('sharp'); sharp.cache(false); } catch (e) {
  console.error('sharp is not installed (npm install). Cannot convert.');
  process.exit(1);
}

const root = path.join(cfg.SITE_DIR, 'wp-content', 'uploads');
const gifs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.gif$/i.test(e.name)) gifs.push(f);
  }
})(root);

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const stats = { converted: 0, existing: 0, kept_gif: 0, failed: 0, gifBytes: 0, webpBytes: 0 };

async function convert(gif) {
  const out = gif.replace(/\.gif$/i, '.webp');
  const rel = path.relative(cfg.SITE_DIR, gif).split(path.sep).join('/');
  if (!FORCE && fs.existsSync(out)) { stats.existing++; return; }
  const size = fs.statSync(gif).size;
  if (DRY) { console.log('would convert', rel, mb(size)); return; }
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    const src = await sharp(gif, { animated: true }).metadata();
    await sharp(gif, { animated: true }).webp({ quality: QUALITY, effort: EFFORT, smartSubsample: true }).toFile(tmp);
    const res = await sharp(tmp, { animated: true }).metadata();
    // WebP merges identical neighbouring frames (150 frames can become 127), so compare the
    // picture size and the total running time instead of the frame count.
    const total = (m) => (m.delay || []).reduce((a, b) => a + b, 0);
    const srcMs = total(src), outMs = total(res);
    const sameSize = res.width === src.width && res.pageHeight === src.pageHeight;
    const stillAnimated = (res.pages || 1) > 1 || (src.pages || 1) === 1;
    const sameLength = srcMs > 0 && Math.abs(outMs - srcMs) <= srcMs * 0.03;
    const outSize = fs.statSync(tmp).size;
    if (!sameSize || !stillAnimated || !sameLength) {
      throw new Error(`differs from the GIF (${src.width}x${src.pageHeight}, ${src.pages} frames, ${srcMs} ms -> ${res.width}x${res.pageHeight}, ${res.pages} frames, ${outMs} ms)`);
    }
    if (outSize > size * KEEP_IF_BELOW) {
      fs.unlinkSync(tmp);
      stats.kept_gif++;
      console.log(`keep GIF  ${rel}  ${mb(size)} -> ${mb(outSize)} (not worth it)`);
      return;
    }
    fs.renameSync(tmp, out);
    stats.converted++; stats.gifBytes += size; stats.webpBytes += outSize;
    console.log(`ok        ${rel}  ${mb(size)} -> ${mb(outSize)}  (${src.pages || 1} frames)`);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    stats.failed++;
    console.warn(`FAILED    ${rel}: ${e.message}`);
  }
}

(async () => {
  console.log(`${gifs.length} GIFs found${DRY ? ' (dry run)' : ''}`);
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < gifs.length) await convert(gifs[i++]);
  }));
  console.log('\n' + JSON.stringify({
    ...stats,
    gifTotal: mb(stats.gifBytes), webpTotal: mb(stats.webpBytes),
    saved: stats.gifBytes ? Math.round((1 - stats.webpBytes / stats.gifBytes) * 100) + '%' : '-',
  }));
})();
