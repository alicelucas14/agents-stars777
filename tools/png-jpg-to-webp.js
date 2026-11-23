#!/usr/bin/env node
/**
 * Make a small WebP copy of every big PNG / JPG in site/wp-content/uploads
 * (x.png -> x.png.webp, x.jpg -> x.jpg.webp, next to the original). The originals are NOT
 * touched or deleted: they stay for social-media preview images (og:image / twitter:image)
 * and schema, while the pages themselves load the WebP (see cms/webpswap.js).
 *
 *   node tools/png-jpg-to-webp.js            convert what is missing, skip what exists
 *   node tools/png-jpg-to-webp.js --force    redo everything
 *   node tools/png-jpg-to-webp.js --dry      only list what would be converted
 *
 * The copy keeps the exact pixel size of the original (so width/height attributes and
 * srcset "1024w" sizes stay true and nothing on the page moves). It is kept only when it
 * is at least 15% smaller; otherwise it is thrown away and the original keeps being used.
 * The ".png.webp" name can never clash with an existing upload called x.webp.
 * Needs the "sharp" package (same one the admin upload optimiser uses).
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');

const MIN_BYTES = 150 * 1024; // smaller files are already fine (same rule as admin uploads)
const QUALITY = 80;           // same as admin uploads (cms/images.js)
const EFFORT = 5;             // 0 (fast) .. 6 (smallest)
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
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(png|jpe?g)$/i.test(e.name) && fs.statSync(f).size >= MIN_BYTES) files.push(f);
  }
})(root);

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const stats = { converted: 0, existing: 0, kept_original: 0, failed: 0, origBytes: 0, webpBytes: 0 };

async function convert(file) {
  const out = file + '.webp';
  const rel = path.relative(cfg.SITE_DIR, file).split(path.sep).join('/');
  if (!FORCE && fs.existsSync(out)) { stats.existing++; return; }
  const size = fs.statSync(file).size;
  if (DRY) { console.log('would convert', rel, mb(size)); return; }
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    const src = await sharp(file).metadata();
    if ((src.pages || 1) > 1) throw new Error('animated image – left as it is');
    // .rotate() applies a camera orientation flag, so the copy looks the way browsers show the original
    await sharp(file).rotate().webp({ quality: QUALITY, effort: EFFORT, smartSubsample: true }).toFile(tmp);
    const res = await sharp(tmp).metadata();
    const turned = (src.orientation || 1) >= 5; // EXIF 5-8 = shown rotated by 90°
    const w = turned ? src.height : src.width, h = turned ? src.width : src.height;
    if (res.width !== w || res.height !== h) throw new Error(`size changed ${w}x${h} -> ${res.width}x${res.height}`);
    const outSize = fs.statSync(tmp).size;
    if (outSize > size * KEEP_IF_BELOW) {
      fs.unlinkSync(tmp);
      stats.kept_original++;
      console.log(`keep      ${rel}  ${mb(size)} -> ${mb(outSize)} (not worth it)`);
      return;
    }
    fs.renameSync(tmp, out);
    stats.converted++; stats.origBytes += size; stats.webpBytes += outSize;
    console.log(`ok        ${rel}  ${mb(size)} -> ${mb(outSize)}`);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    stats.failed++;
    console.warn(`FAILED    ${rel}: ${e.message}`);
  }
}

(async () => {
  console.log(`${files.length} PNG/JPG files of ${MIN_BYTES / 1024} KB or more${DRY ? ' (dry run)' : ''}`);
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < files.length) await convert(files[i++]);
  }));
  console.log('\n' + JSON.stringify({
    ...stats,
    originalTotal: mb(stats.origBytes), webpTotal: mb(stats.webpBytes),
    saved: stats.origBytes ? Math.round((1 - stats.webpBytes / stats.origBytes) * 100) + '%' : '-',
  }));
})();
