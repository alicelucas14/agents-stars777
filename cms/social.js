/**
 * Floating social-media bar (Telegram, Instagram, X, Facebook).
 * Settings live in content/social.json; the bar is injected before </body>
 * of every HTML page between <!--cms:social--> markers, so it can be
 * replaced or removed cleanly on every save / rebuild.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const store = require('./store');

const FILE = path.join(cfg.CONTENT_DIR, 'social.json');

const NETWORKS = {
  telegram: {
    label: 'Telegram', base: 'https://t.me/', bg: '#229ED9',
    hosts: /^(www\.)?(t\.me|telegram\.me|telegram\.org)\//i,
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M21.94 4.6 18.7 19.86c-.24 1.08-.88 1.34-1.78.84l-4.93-3.63-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L6.2 13.47l-4.86-1.52c-1.06-.33-1.08-1.06.22-1.57L20.6 3.05c.88-.32 1.65.21 1.34 1.55z"/></svg>',
  },
  instagram: {
    label: 'Instagram', base: 'https://www.instagram.com/', bg: 'linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)',
    hosts: /^(www\.)?(instagram\.com|instagr\.am)\//i,
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
  },
  x: {
    label: 'X', base: 'https://x.com/', bg: '#000000',
    hosts: /^(www\.)?(x\.com|twitter\.com)\//i,
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z"/></svg>',
  },
  facebook: {
    label: 'Facebook', base: 'https://www.facebook.com/', bg: '#1877F2',
    hosts: /^(www\.|m\.)?(facebook\.com|fb\.com|fb\.me)\//i,
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.2c-.3-.1-1.4-.2-2.6-.2-2.5 0-4.2 1.5-4.2 4.3v2.2H7.5v3.7h2.7V22H14v-9.8h2.8l.4-3.7H14z"/></svg>',
  },
};
const ORDER = ['telegram', 'instagram', 'x', 'facebook'];

const DEFAULTS = { enabled: false, position: 'left', mobile: true, links: { telegram: '', instagram: '', x: '', facebook: '' } };

function get() {
  const s = store.readJson(FILE, {}) || {};
  return { ...DEFAULTS, ...s, links: { ...DEFAULTS.links, ...(s.links || {}) } };
}

/** Accept a full URL, a bare domain URL, or just a @handle / page name. */
function normalize(net, v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (NETWORKS[net].hosts.test(v)) return 'https://' + v;
  return NETWORKS[net].base + v.replace(/^@/, '').replace(/^\/+/, '');
}

function clean(input = {}) {
  const links = {};
  for (const k of ORDER) links[k] = normalize(k, (input.links || {})[k]).slice(0, 300);
  return {
    enabled: !!input.enabled,
    position: input.position === 'right' ? 'right' : 'left',
    mobile: input.mobile !== false,
    links,
  };
}

function save(input) {
  const s = clean(input);
  store.writeJson(FILE, s);
  return s;
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
.s7-social{position:fixed;top:50%;transform:translateY(-50%);z-index:9990;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.s7-social.s7-l{left:0;align-items:flex-start}.s7-social.s7-r{right:0;align-items:flex-end}
.s7-social a{display:flex;align-items:center;gap:12px;box-sizing:border-box;height:46px;width:46px;padding:0 13px;overflow:hidden;color:#fff!important;text-decoration:none!important;font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;white-space:nowrap;box-shadow:0 6px 18px -6px rgba(0,0,0,.5);transition:width .28s ease,filter .2s ease}
.s7-social.s7-l a{border-radius:0 12px 12px 0}.s7-social.s7-r a{border-radius:12px 0 0 12px;flex-direction:row-reverse}
.s7-social a:hover,.s7-social a:focus-visible{width:148px;filter:brightness(1.1);outline:none}
.s7-social svg{width:20px;height:20px;flex:none}
.s7-social span{opacity:0;transition:opacity .2s ease .05s}
.s7-social a:hover span,.s7-social a:focus-visible span{opacity:1}
@media (max-width:768px){.s7-social{top:auto;bottom:90px;transform:none;gap:4px}.s7-social a,.s7-social a:hover{width:40px;height:40px;padding:0 10px}.s7-social span{display:none}.s7-social svg{width:18px;height:18px}.s7-social.s7-nm{display:none}}
@media print{.s7-social{display:none}}`.replace(/\n/g, '');

/** The bar's HTML (empty string when disabled or no links). `force` ignores the enabled flag (admin preview). */
function block(s = get(), { force = false } = {}) {
  const items = ORDER.filter((k) => s.links[k]);
  if ((!s.enabled && !force) || !items.length) return '';
  const cls = ['s7-social', s.position === 'right' ? 's7-r' : 's7-l', s.mobile ? '' : 's7-nm'].filter(Boolean).join(' ');
  const links = items.map((k) => {
    const n = NETWORKS[k];
    return `<a href="${esc(s.links[k])}" target="_blank" rel="noopener" aria-label="${n.label}" title="${n.label}" style="background:${n.bg}">${n.icon}<span>${n.label}</span></a>`;
  }).join('');
  return `<!--cms:social--><style>${CSS}</style><nav class="${cls}" aria-label="Social media">${links}</nav><!--/cms:social-->`;
}

const RE = /\n?<!--cms:social-->[\s\S]*?<!--\/cms:social-->/g;

/** Remove any old bar from a page and insert the current one before </body>. */
function inject(html, b = block()) {
  let out = String(html).replace(RE, '');
  if (!b) return out;
  const i = out.lastIndexOf('</body>');
  if (i === -1) return out;
  return `${out.slice(0, i)}\n${b}\n${out.slice(i)}`;
}

function htmlFiles() {
  const out = [];
  const walk = (dir, top) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (top && /^(wp-content|wp-includes|admin|api)$/.test(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, false);
      else if (/\.html$/i.test(e.name)) out.push(f);
    }
  };
  walk(cfg.SITE_DIR, true);
  return out;
}

/** Apply the current bar to every HTML page in the site. Returns number of files changed. */
function applyAll() {
  const b = block();
  let changed = 0;
  for (const f of htmlFiles()) {
    const html = fs.readFileSync(f, 'utf8');
    const out = inject(html, b);
    if (out !== html) { fs.writeFileSync(f, out); changed++; }
  }
  return changed;
}

module.exports = { NETWORKS, ORDER, DEFAULTS, get, save, clean, normalize, block, inject, applyAll };
