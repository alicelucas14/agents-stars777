/**
 * Floating social-media sidebar.
 *
 * Settings live in content/social.json:
 *   { enabled, position: 'left'|'right', mobile, style: 'light'|'dark'|'brand',
 *     items: [{ network, url, label?, icon?, color? }] }
 *
 * Any number of links can be added from the admin (built-in networks or a
 * "custom" link with its own label / icon). Older files that used the fixed
 * { links: { telegram, instagram, x, facebook } } shape are migrated on read.
 *
 * The bar is injected before </body> of every HTML page between
 * <!--cms:social--> markers, so it can be replaced or removed cleanly on
 * every save / rebuild.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const store = require('./store');

const FILE = path.join(cfg.CONTENT_DIR, 'social.json');
const MAX_ITEMS = 16;
const STYLES = ['light', 'dark', 'brand'];

const fillIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="${d}"/></svg>`;
const lineIcon = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/**
 * Built-in networks. `base` turns a bare handle into a URL, `hosts` recognises
 * a URL typed without https://. Icons are Simple Icons (CC0) / Feather (MIT).
 */
const NETWORKS = {
  telegram: {
    label: 'Telegram', color: '#229ED9', base: 'https://t.me/',
    hosts: /^(www\.)?(t\.me|telegram\.me|telegram\.org)\//i,
    placeholder: '@yourchannel or https://t.me/yourchannel',
    icon: fillIcon('M21.94 4.6 18.7 19.86c-.24 1.08-.88 1.34-1.78.84l-4.93-3.63-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L6.2 13.47l-4.86-1.52c-1.06-.33-1.08-1.06.22-1.57L20.6 3.05c.88-.32 1.65.21 1.34 1.55z'),
  },
  whatsapp: {
    label: 'WhatsApp', color: '#25D366', base: 'https://wa.me/',
    hosts: /^(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com)\//i,
    placeholder: 'Phone number with country code, e.g. 919876543210',
    icon: fillIcon('M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z'),
  },
  instagram: {
    label: 'Instagram', color: '#E4405F', bg: 'linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)',
    base: 'https://www.instagram.com/', hosts: /^(www\.)?(instagram\.com|instagr\.am)\//i,
    placeholder: '@yourpage or https://www.instagram.com/yourpage',
    icon: lineIcon('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/>'),
  },
  facebook: {
    label: 'Facebook', color: '#1877F2', base: 'https://www.facebook.com/',
    hosts: /^(www\.|m\.)?(facebook\.com|fb\.com|fb\.me)\//i,
    placeholder: 'Page name or https://www.facebook.com/yourpage',
    icon: fillIcon('M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.2c-.3-.1-1.4-.2-2.6-.2-2.5 0-4.2 1.5-4.2 4.3v2.2H7.5v3.7h2.7V22H14v-9.8h2.8l.4-3.7H14z'),
  },
  x: {
    label: 'X', color: '#000000', base: 'https://x.com/',
    hosts: /^(www\.)?(x\.com|twitter\.com)\//i,
    placeholder: '@yourhandle or https://x.com/yourhandle',
    icon: fillIcon('M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z'),
  },
  youtube: {
    label: 'YouTube', color: '#FF0000', base: 'https://www.youtube.com/@',
    hosts: /^(www\.|m\.)?(youtube\.com|youtu\.be)\//i,
    placeholder: '@yourchannel or https://www.youtube.com/@yourchannel',
    icon: fillIcon('M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z'),
  },
  tiktok: {
    label: 'TikTok', color: '#010101', base: 'https://www.tiktok.com/@',
    hosts: /^(www\.|vm\.)?tiktok\.com\//i,
    placeholder: '@yourhandle or https://www.tiktok.com/@yourhandle',
    icon: fillIcon('M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z'),
  },
  linkedin: {
    label: 'LinkedIn', color: '#0A66C2', base: 'https://www.linkedin.com/company/',
    hosts: /^(www\.)?linkedin\.com\//i,
    placeholder: 'https://www.linkedin.com/company/yourcompany',
    icon: fillIcon('M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'),
  },
  threads: {
    label: 'Threads', color: '#000000', base: 'https://www.threads.net/@',
    hosts: /^(www\.)?threads\.(net|com)\//i,
    placeholder: '@yourhandle or https://www.threads.net/@yourhandle',
    icon: fillIcon('M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z'),
  },
  discord: {
    label: 'Discord', color: '#5865F2', base: 'https://discord.gg/',
    hosts: /^(www\.)?(discord\.gg|discord\.com)\//i,
    placeholder: 'Invite code or https://discord.gg/yourinvite',
    icon: fillIcon('M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'),
  },
  pinterest: {
    label: 'Pinterest', color: '#E60023', base: 'https://www.pinterest.com/',
    hosts: /^(\w+\.)?pinterest\.[a-z.]+\//i,
    placeholder: 'Username or https://www.pinterest.com/yourname',
    icon: fillIcon('M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z'),
  },
  email: {
    label: 'Email', color: '#EA4335', kind: 'email',
    placeholder: 'support@example.com',
    icon: lineIcon('<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m22 7-10 6L2 7"/>'),
  },
  phone: {
    label: 'Call us', color: '#16A34A', kind: 'phone',
    placeholder: '+91 98765 43210',
    icon: lineIcon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  },
  website: {
    label: 'Website', color: '#475569',
    placeholder: 'https://example.com',
    icon: lineIcon('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
  },
  custom: {
    label: 'Custom link', color: '#6366F1', custom: true,
    placeholder: 'https://…',
    icon: lineIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  },
};
const ORDER = Object.keys(NETWORKS);
/** Networks whose links are "profiles" (go into schema sameAs / rel="me"). */
const NOT_PROFILE = new Set(['email', 'phone', 'whatsapp', 'website', 'custom']);
const LEGACY_ORDER = ['telegram', 'instagram', 'x', 'facebook'];

const DEFAULTS = { enabled: false, position: 'left', mobile: true, style: 'light', items: [] };

const ICON_SHARE = lineIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>');
const ICON_CLOSE = lineIcon('<path d="M18 6 6 18M6 6l12 12"/>');

/* ---------- helpers ---------- */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function safeHttp(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : ''; } catch { return ''; }
}

/** Accept a full URL, a URL without https://, or just a @handle / page name / number. Returns '' if invalid. */
function normalize(net, v) {
  v = String(v ?? '').trim();
  if (!v) return '';
  const n = NETWORKS[net] || NETWORKS.custom;
  if (n.kind === 'email') {
    v = v.replace(/^mailto:/i, '');
    return /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(v) ? `mailto:${v}` : '';
  }
  if (n.kind === 'phone') {
    const d = v.replace(/^tel:/i, '').replace(/[^\d+]/g, '');
    return d.replace(/\D/g, '').length >= 5 ? `tel:${d}` : '';
  }
  if (/^https?:\/\//i.test(v)) return safeHttp(v);
  if (n.hosts && n.hosts.test(v)) return safeHttp(`https://${v}`);
  if (net === 'whatsapp') { const d = v.replace(/\D/g, ''); return d.length >= 6 ? `${n.base}${d}` : ''; }
  if (n.base && /^@?[\w.\-~]+(\/[\w.\-~/?=&%]*)?$/.test(v)) return safeHttp(n.base + v.replace(/^@/, ''));
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return safeHttp(`https://${v}`); // bare domain
  return '';
}

/** Icon for a custom item: only site-relative paths or https URLs. */
function cleanIcon(v) {
  v = String(v ?? '').trim();
  if (!v) return '';
  if (/^\/(?!\/)[^\s"'<>]*$/.test(v)) return v.slice(0, 500);
  return /^https:\/\//i.test(v) ? safeHttp(v).slice(0, 500) : '';
}

const legacyItems = (links = {}) => LEGACY_ORDER.filter((k) => links && links[k]).map((k) => ({ network: k, url: links[k] }));

/** Turn admin input into a clean settings object. Rows without a valid URL are dropped. */
function clean(input = {}) {
  const raw = Array.isArray(input.items) ? input.items : legacyItems(input.links);
  const items = [];
  for (const it of raw) {
    if (items.length >= MAX_ITEMS) break;
    if (!it || typeof it !== 'object') continue;
    const network = NETWORKS[it.network] ? it.network : 'custom';
    const url = normalize(network, it.url).slice(0, 500);
    if (!url) continue;
    const o = { network, url };
    const label = String(it.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (label) o.label = label;
    if (network === 'custom') {
      if (!o.label) { try { o.label = new URL(url).hostname.replace(/^www\./, ''); } catch { o.label = 'Link'; } }
      const icon = cleanIcon(it.icon);
      if (icon) o.icon = icon;
      if (HEX.test(String(it.color || ''))) o.color = it.color;
    }
    items.push(o);
  }
  return {
    enabled: !!input.enabled,
    position: input.position === 'right' ? 'right' : 'left',
    mobile: input.mobile !== false,
    style: STYLES.includes(input.style) ? input.style : 'light',
    items,
  };
}

/** Labels of rows that have something typed in the URL field but it isn't a valid link. */
function invalid(input = {}) {
  const raw = Array.isArray(input.items) ? input.items : [];
  return raw
    .filter((it) => it && String(it.url ?? '').trim() && !normalize(NETWORKS[it.network] ? it.network : 'custom', it.url))
    .map((it) => String(it.label || '').trim() || (NETWORKS[it.network] || NETWORKS.custom).label);
}

function get() {
  const s = store.readJson(FILE, {}) || {};
  // migrate the old fixed-network format; values were already normalised when saved
  const items = Array.isArray(s.items) ? s.items : legacyItems(s.links);
  return clean({ ...DEFAULTS, ...s, items });
}

function save(input) {
  const s = clean(input);
  store.writeJson(FILE, s);
  return s;
}

/** Profile URLs (for schema sameAs). */
const profileUrls = (s = get()) => s.items.filter((i) => !NOT_PROFILE.has(i.network) && /^https?:/i.test(i.url)).map((i) => i.url);
/** First URL for a given network, or ''. */
const firstUrl = (s, network) => (s.items.find((i) => i.network === network) || {}).url || '';

/* ---------- front-end markup ---------- */
const CSS = `
.s7s{--s7-panel:rgba(255,255,255,.94);--s7-line:rgba(15,23,42,.09);--s7-tg:#fff;--s7-tgc:#0f172a;position:fixed;top:50%;transform:translateY(-50%);z-index:9990;margin:0;padding:0;font:600 12.5px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
.s7s-dark{--s7-panel:rgba(15,23,42,.9);--s7-line:rgba(255,255,255,.1);--s7-ic:#e2e8f0;--s7-tg:#0f172a;--s7-tgc:#fff}
.s7s-l{left:0}.s7s-r{right:0}
.s7s-tg{display:none}
.s7s .s7s-list{list-style:none;margin:0;padding:6px;display:flex;flex-direction:column;gap:4px;background:var(--s7-panel);border:1px solid var(--s7-line);box-shadow:0 14px 34px -14px rgba(15,23,42,.4),0 2px 8px -2px rgba(15,23,42,.12);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px)}
.s7s-l .s7s-list{border-left:0;border-radius:0 16px 16px 0}
.s7s-r .s7s-list{border-right:0;border-radius:16px 0 0 16px}
.s7s .s7s-list>li{list-style:none;margin:0;padding:0;position:relative}
.s7s .s7s-list>li::before,.s7s .s7s-list>li::marker{content:none}
.s7s a.s7s-a{position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:40px;height:40px;border-radius:11px;color:var(--s7-ic,var(--c))!important;background:transparent;text-decoration:none!important;border:0;box-shadow:none;transition:background .2s ease,color .2s ease,transform .2s ease,filter .2s ease}
.s7s a.s7s-a:hover,.s7s a.s7s-a:focus-visible{background:var(--bg,var(--c));color:#fff!important;transform:translateY(-1px);outline:none}
.s7s a.s7s-a:focus-visible{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--c)}
.s7s svg,.s7s a.s7s-a img{width:20px;height:20px;flex:none;display:block;object-fit:contain}
.s7s-tip{position:absolute;top:50%;padding:7px 11px;border-radius:8px;background:#0f172a;color:#fff;white-space:nowrap;letter-spacing:.01em;pointer-events:none;opacity:0;visibility:hidden;transform:translate(var(--s7-tx,-4px),-50%);transition:opacity .16s ease,transform .16s ease,visibility .16s;box-shadow:0 8px 20px -8px rgba(0,0,0,.45)}
.s7s-tip::before{content:"";position:absolute;top:50%;width:8px;height:8px;background:inherit;border-radius:1px;transform:translateY(-50%) rotate(45deg)}
.s7s-l .s7s-tip{left:calc(100% + 14px)}.s7s-l .s7s-tip::before{left:-3px}
.s7s-r .s7s-tip{right:calc(100% + 14px);--s7-tx:4px}.s7s-r .s7s-tip::before{right:-3px}
.s7s a.s7s-a:hover .s7s-tip,.s7s a.s7s-a:focus-visible .s7s-tip{opacity:1;visibility:visible;transform:translate(0,-50%)}
.s7s-brand .s7s-list{background:none;border:0;box-shadow:none;padding:0;gap:6px;-webkit-backdrop-filter:none;backdrop-filter:none}
.s7s-brand a.s7s-a{width:44px;height:44px;background:var(--bg,var(--c));color:#fff!important;box-shadow:0 6px 16px -6px rgba(0,0,0,.45)}
.s7s-brand.s7s-l a.s7s-a{border-radius:0 12px 12px 0}.s7s-brand.s7s-r a.s7s-a{border-radius:12px 0 0 12px}
.s7s-brand a.s7s-a:hover,.s7s-brand a.s7s-a:focus-visible{filter:brightness(1.1);transform:translateX(3px)}
.s7s-brand.s7s-r a.s7s-a:hover,.s7s-brand.s7s-r a.s7s-a:focus-visible{transform:translateX(-3px)}
@media (min-width:1200px) and (max-width:1439px){
.s7s .s7s-list{padding:4px;gap:3px}
.s7s a.s7s-a{width:36px;height:36px;border-radius:10px}
.s7s svg,.s7s a.s7s-a img{width:18px;height:18px}
.s7s-brand .s7s-list{padding:0;gap:5px}
.s7s-brand a.s7s-a{width:40px;height:40px}
}
@media (max-width:1199px){
.s7s{top:auto;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:none}
.s7s-l{left:16px}.s7s-r{right:16px}
.s7s-tg{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:50px;height:50px;margin:0;padding:0;border:1px solid var(--s7-line);border-radius:50%;background:var(--s7-tg);color:var(--s7-tgc);cursor:pointer;box-shadow:0 12px 28px -10px rgba(15,23,42,.55),0 2px 6px rgba(15,23,42,.14);transition:transform .2s ease}
.s7s-brand .s7s-tg{background:#0f172a;color:#fff;border-color:transparent}
.s7s-tg:active{transform:scale(.94)}
.s7s-tg:focus-visible{outline:2px solid #2563eb;outline-offset:3px}
.s7s-tg svg{width:22px;height:22px}
.s7s-tg .s7s-x,.s7s-open .s7s-tg .s7s-sh{display:none}.s7s-open .s7s-tg .s7s-x{display:block}
.s7s .s7s-list{position:absolute;bottom:calc(100% + 12px);border:1px solid var(--s7-line);border-radius:18px;opacity:0;visibility:hidden;transform:translateY(10px) scale(.96);transition:opacity .2s ease,transform .2s ease,visibility .2s}
.s7s-l .s7s-list{left:0;transform-origin:bottom left}.s7s-r .s7s-list{right:0;transform-origin:bottom right}
.s7s.s7s-open .s7s-list{opacity:1;visibility:visible;transform:none}
.s7s-brand .s7s-list{border:0}
.s7s a.s7s-a{width:44px;height:44px}
.s7s-brand a.s7s-a,.s7s-brand.s7s-l a.s7s-a,.s7s-brand.s7s-r a.s7s-a{width:50px;height:50px;border-radius:50%}
.s7s-tip{display:none}
}
@media (max-width:768px){.s7s-nm{display:none}}
@media (prefers-reduced-motion:reduce){.s7s,.s7s *{transition:none!important}}
@media print{.s7s{display:none}}`.replace(/\n/g, '');

// tiny toggle for the mobile button (desktop shows the list without it)
const JS = `(function(){var n=document.querySelector('.s7s');if(!n)return;var b=n.querySelector('.s7s-tg');if(!b)return;function s(o){n.classList.toggle('s7s-open',o);b.setAttribute('aria-expanded',o?'true':'false');}b.addEventListener('click',function(e){e.stopPropagation();s(!n.classList.contains('s7s-open'));});document.addEventListener('click',function(e){if(!n.contains(e.target))s(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&n.classList.contains('s7s-open')){s(false);b.focus();}});})();`;

/** One item's display data (shared by the site markup and the admin UI). */
function view(it) {
  const n = NETWORKS[it.network] || NETWORKS.custom;
  const color = it.network === 'custom' && HEX.test(it.color || '') ? it.color : n.color;
  return {
    label: it.label || n.label,
    color,
    bg: it.network === 'custom' ? color : n.bg || n.color,
    icon: it.network === 'custom' && it.icon ? `<img src="${esc(it.icon)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : n.icon,
  };
}

/** The bar's HTML (empty string when disabled or no links). `force` ignores the enabled flag (admin preview). */
function block(s = get(), { force = false } = {}) {
  const items = (s.items || []).filter((i) => i && i.url);
  if ((!s.enabled && !force) || !items.length) return '';
  const cls = ['s7s', s.position === 'right' ? 's7s-r' : 's7s-l', `s7s-${STYLES.includes(s.style) ? s.style : 'light'}`, s.mobile ? '' : 's7s-nm'].filter(Boolean).join(' ');
  const links = items.map((it) => {
    const v = view(it);
    const ext = /^https?:/i.test(it.url);
    const rel = ext ? ` target="_blank" rel="noopener${NOT_PROFILE.has(it.network) || it.network === 'custom' ? '' : ' me'}"` : '';
    return `<li><a class="s7s-a" href="${esc(it.url)}"${rel} aria-label="${esc(v.label)}" style="--c:${v.color};--bg:${v.bg}">${v.icon}<span class="s7s-tip" aria-hidden="true">${esc(v.label)}</span></a></li>`;
  }).join('');
  return `<!--cms:social--><style>${CSS}</style><nav class="${cls}" aria-label="Social media">`
    + `<button type="button" class="s7s-tg" aria-expanded="false" aria-controls="s7s-list" aria-label="Follow us"><span class="s7s-sh">${ICON_SHARE}</span><span class="s7s-x">${ICON_CLOSE}</span></button>`
    + `<ul class="s7s-list" id="s7s-list">${links}</ul></nav><script>${JS}</script><!--/cms:social-->`;
}

const RE = /\n?<!--cms:social-->[\s\S]*?<!--\/cms:social-->\n?/g;

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

/** Network catalogue for the admin UI. */
const catalogue = () => ORDER.map((k) => {
  const n = NETWORKS[k];
  return { key: k, label: n.label, color: n.color, bg: n.bg || n.color, icon: n.icon, placeholder: n.placeholder || '', custom: !!n.custom };
});

module.exports = {
  NETWORKS, ORDER, STYLES, MAX_ITEMS, DEFAULTS,
  get, save, clean, invalid, normalize, block, inject, applyAll, htmlFiles, profileUrls, firstUrl, catalogue, view,
};
