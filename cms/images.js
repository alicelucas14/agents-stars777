/**
 * Shrinks images uploaded in the admin so pages stay fast on phones.
 *
 * JPG / PNG / WebP photos larger than 150 KB are resized to at most 1600 px wide and saved
 * as WebP (usually 70–90% smaller, looks the same). GIF (animations), SVG, AVIF and small
 * files are left exactly as uploaded. The optimised copy replaces the upload only when it
 * is clearly smaller.
 *
 * Uses the optional "sharp" package. If it isn't installed or fails for any reason, the
 * original upload is kept – uploads never break because of this step.
 */
const fs = require('fs');
const path = require('path');

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false); // don't keep uploaded files open after processing
} catch { /* optional – uploads are kept as they are */ }

const MAX_WIDTH = 1600;
const MIN_BYTES = 150 * 1024; // smaller files are already fine
const QUALITY = 80;
const CONVERT = /\.(jpe?g|png|webp)$/i;

const available = () => !!sharp;

/**
 * Optimise an uploaded file. Returns the path of the file to use: the original path, or a
 * new .webp path (the original is then deleted). Never throws.
 */
async function optimize(file) {
  if (!sharp || !CONVERT.test(file)) return file;
  const out = file.replace(/\.[a-z0-9]+$/i, '') + '.webp';
  const tmp = `${out}.tmp-${process.pid}-${Date.now()}`;
  let size, smaller;
  try {
    size = fs.statSync(file).size;
    if (size < MIN_BYTES) return file;
    const meta = await sharp(file).metadata();
    if ((meta.pages || 1) > 1) return file; // animated WebP – leave it
    await sharp(file)
      .rotate() // apply the phone's orientation flag before it is stripped
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(tmp);
    smaller = fs.statSync(tmp).size;
    // keep the original when converting doesn't save much, or a .webp of that name already exists
    if (smaller > size * 0.9 || (out !== file && fs.existsSync(out))) { fs.unlinkSync(tmp); return file; }
    fs.renameSync(tmp, out);
  } catch (e) {
    console.warn('Image optimisation skipped:', path.basename(file), e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    return file;
  }
  // the optimised file is in place – remove the original upload
  if (out !== file) {
    try { fs.unlinkSync(file); } catch (e) { console.warn('Could not remove original upload:', path.basename(file), e.message); }
  }
  console.log(`Image optimised: ${path.basename(file)} ${Math.round(size / 1024)} KB -> ${path.basename(out)} ${Math.round(smaller / 1024)} KB`);
  return out;
}

module.exports = { optimize, available, MAX_WIDTH };
