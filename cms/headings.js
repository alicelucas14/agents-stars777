/**
 * Makes sure every static (mirrored Elementor) page has exactly one <h1>.
 *
 * - No <h1>: if the first content heading already is the page title, it is
 *   promoted to <h1> (keeping its size). Otherwise the theme's standard title
 *   band – the same markup the other pages on the site already use – is added
 *   with the page name taken from <title>.
 * - Two or more: the theme title band's <h1> is turned into a styled <p> so the
 *   page's own designed <h1> remains (no visual change).
 *
 * Idempotent: pages that already have one <h1> are left untouched.
 */

// Kadence heading sizes (from the theme's inline CSS)
const SIZE = { 1: 32, 2: 28, 3: 24, 4: 22, 5: 20, 6: 18 };

const decode = (s) => String(s)
  .replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => decode(String(s).replace(/<[^>]+>/g, '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "Plinko on Stars777 | Big Agents | Earning App" -> "Plinko on Stars777" */
function nameFromTitle(title) {
  let t = decode(title).replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+[-–|]\s+Big Agents?\s*$/i, '');
  t = t.split(/\s+\|\s+/)[0];
  for (const sep of [/\s-\s/, /\s–\s/]) {
    const [left] = t.split(sep);
    if (left !== t && left.trim().split(' ').length >= 2) t = left;
  }
  return t.replace(/\s+:\s+/g, ': ').replace(/[\s:–-]+$/, '').trim();
}

const band = (name) => `
<section class="entry-hero page-hero-section entry-hero-layout-standard">
	<div class="entry-hero-container-inner">
		<div class="hero-section-overlay"></div>
		<div class="hero-container site-container">
			<header class="entry-header page-title title-align-inherit title-tablet-align-inherit title-mobile-align-inherit">
				<h1 class="entry-title">${escape(name)}</h1>
			</header><!-- .entry-header -->
		</div>
	</div>
</section><!-- .entry-hero -->`;

/**
 * @returns {{html: string, action: string}|null} null when nothing changes
 */
function ensureH1(html) {
  const count = (html.match(/<h1\b/gi) || []).length;
  if (count === 1) return null;

  if (count > 1) {
    const re = /<h1 class="entry-title">([\s\S]*?)<\/h1>/i;
    if (!re.test(html)) return null;
    const style = `font-size:${SIZE[1]}px;font-weight:700;line-height:1.5;margin:0;color:var(--global-palette3);font-family:var(--global-heading-font-family)`;
    return { html: html.replace(re, `<p class="entry-title" style="${style}">$1</p>`), action: 'demoted duplicate title' };
  }

  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1];
  const open = /<(?:main|div) id="inner-wrap"[^>]*>/i.exec(html);
  if (!title || !open) return null;
  const name = nameFromTitle(title);
  if (!name) return null;

  // the page's own first heading, when it already is the title
  const start = open.index + open[0].length;
  let end = html.search(/<footer\b|elementor-location-footer|id="colophon"/i);
  if (end < start) end = html.length;
  const m = /<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/i.exec(html.slice(start, end));
  if (m) {
    const first = norm(m[3]);
    const words = norm(name).split(' ');
    const fw = first.split(' ');
    const question = /\?\s*$/.test(decode(m[3].replace(/<[^>]+>/g, '')).trim()) || /^(what|how|why|who|when|where|which|is|are|can|do|does)\b/.test(first);
    const hasAll = !question && words.length >= 3 && fw.length <= words.length + 2 && words.every((w) => fw.includes(w));
    if (first && (first === norm(name) || hasAll || (first.length >= 12 && norm(title).startsWith(first)))) {
      const at = start + m.index;
      const attrs = /\bstyle="/i.test(m[2])
        ? m[2].replace(/\bstyle="/i, `style="font-size:${SIZE[m[1]]}px;`)
        : `${m[2]} style="font-size:${SIZE[m[1]]}px"`;
      const h1 = `<h1${attrs}>${m[3]}</h1>`;
      return { html: html.slice(0, at) + h1 + html.slice(at + m[0].length), action: `promoted <h${m[1]}> "${norm(m[3]).slice(0, 50)}"` };
    }
  }
  return { html: html.slice(0, start) + band(name) + html.slice(start), action: `added title "${name}"` };
}

module.exports = { ensureH1, nameFromTitle };
