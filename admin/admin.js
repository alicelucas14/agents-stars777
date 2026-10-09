/* =========================================================
   Big Agents – Admin panel (vanilla JS, no build step)
   ========================================================= */
(() => {
  'use strict';

  /* ---------- tiny helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let view = $('#view');
  const state = { me: null, siteUrl: '', siteName: '', dirty: false, lastHash: '', skipGuard: false };

  const slugify = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const spinner = '<span class="spinner"></span>';

  /* ---------- SEO helpers ---------- */
  const scoreClass = (n) => (n == null ? 'none' : n >= 80 ? 'good' : n >= 50 ? 'ok' : 'bad');
  const scoreBadge = (n, title = 'SEO score') => `<span class="score-badge ${scoreClass(n)}" title="${esc(title)}">${n == null ? '–' : `${n}<small>/100</small>`}</span>`;
  const scoreBadgeBtn = (n, id, kind = 'post', title = 'SEO score') =>
    `<button type="button" class="score-badge ${scoreClass(n)}" data-seo-diag="${id}" data-seo-kind="${kind}" title="${esc(title)}">${n == null ? '–' : `${n}<small>/100</small>`}</button>`;

  const applyTpl = (tpl, seoS, vars = {}) => String(tpl || '')
    .replace(/%sep%/g, (seoS && seoS.separator) || '-').replace(/%sitename%/g, state.siteName)
    .replace(/%title%/g, vars.title || '').replace(/%term%/g, vars.term || '')
    .replace(/%page%/g, vars.page || '').replace(/%pages%/g, vars.pages || '')
    .replace(/\s+/g, ' ').trim();

  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot',
    'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each',
    'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
    'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
    'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s',
    'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or',
    'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll',
    'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs',
    'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve',
    'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll',
    'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while',
    'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll',
    'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves'
  ]);

  function extractKeywordCandidates(title = '', heads = [], text = '', tags = []) {
    const results = new Set();
    const cleanTitle = title.replace(/\s*[-–—|].*$/, '').trim();
    const cleanWords = cleanTitle.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

    // 1. Direct clean title if concise
    const trimmedTitle = cleanTitle.replace(/^(the|a|an|how to|why|top|best)\s+/i, '').trim();
    if (trimmedTitle && trimmedTitle.length >= 4 && trimmedTitle.length <= 40) results.add(trimmedTitle);
    if (cleanTitle && cleanTitle.length <= 35) results.add(cleanTitle);

    // 2. 2-3 word segments from title
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i <= cleanWords.length - len; i++) {
        const slice = cleanWords.slice(i, i + len);
        if (STOP_WORDS.has(slice[0].toLowerCase()) || STOP_WORDS.has(slice[slice.length - 1].toLowerCase())) continue;
        const phrase = slice.join(' ');
        if (phrase.length >= 5 && phrase.length <= 32) results.add(phrase);
      }
    }

    // 3. From tags
    tags.forEach((t) => {
      const tagStr = String(t || '').replace(/-/g, ' ').trim();
      if (tagStr.length >= 4 && tagStr.length <= 30) results.add(tagStr);
    });

    // 4. From subheadings
    heads.forEach((h) => {
      const hText = (h.textContent || '').replace(/[^\w\s]/g, ' ').trim();
      const hWords = hText.split(/\s+/).filter((w) => w.length > 2);
      if (hWords.length >= 2 && hWords.length <= 4) {
        const ph = hWords.join(' ');
        if (ph.length >= 8 && ph.length <= 35) results.add(ph);
      }
    });

    return [...results].slice(0, 6);
  }

  function buildAutoDescription(text, kw, title) {
    if (!text) return `${title} - Explore detailed tips, guide and comprehensive insights.`;
    const clean = text.replace(/\s+/g, ' ').trim();
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
    let best = '';
    if (kw) {
      const kwLower = kw.toLowerCase();
      best = sentences.find((s) => s.toLowerCase().includes(kwLower)) || '';
    }
    if (!best) best = sentences[0] || clean;
    best = best.trim();
    if (best.length > 155) {
      best = best.slice(0, 150).replace(/\s+\S*$/, '') + '…';
    }
    if (best.length < 120 && sentences[1]) {
      const combo = (best + ' ' + sentences[1].trim()).trim();
      if (combo.length <= 158) best = combo;
    }
    return best;
  }

  async function openSeoDiagModal(postId, kind = 'post') {
    const K = KINDS[kind];
    const modal = $('#seo-modal');
    const body = $('#seo-modal-body');
    if (!modal || !body) return;
    modal.hidden = false;
    body.innerHTML = '<div class="empty">Analyzing SEO…</div>';
    const close = () => { modal.hidden = true; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.onclick = (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); };

    try {
      const post = await api(`${K.base}/${postId}`);
      const doc = new DOMParser().parseFromString(post.content || '', 'text/html');
      doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
      const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      const kw = (post.focusKeyword || '').trim();
      const title = post.seoTitle || post.title || '';
      const desc = post.metaDescription || '';
      const words = text ? text.split(/\s+/).length : 0;
      const heads = [...doc.querySelectorAll('h2,h3,h4,h5,h6')];
      const tags = post.tags || [];
      const sugKws = extractKeywordCandidates(post.title, heads, text, tags);

      const issues = [];
      const passed = [];

      if (!kw) {
        issues.push({ st: 'bad', title: 'Focus Keyword is missing', desc: 'Setting a focus keyword is the #1 way to boost this score (adds up to 40+ points).' });
      } else {
        if (!title.toLowerCase().includes(kw.toLowerCase())) issues.push({ st: 'bad', title: 'Focus Keyword missing from SEO title', desc: `Include "${kw}" in your SEO title for higher rankings.` });
        else passed.push({ title: 'Focus Keyword is present in SEO title' });

        if (!desc.toLowerCase().includes(kw.toLowerCase())) issues.push({ st: 'warn', title: 'Focus Keyword missing from Meta Description', desc: `Add "${kw}" to the meta description.` });
        else passed.push({ title: 'Focus Keyword is present in Meta Description' });
      }

      if (!desc || desc.length < 120 || desc.length > 160) {
        issues.push({ st: 'warn', title: 'Meta Description needs optimization', desc: desc ? `Currently ${desc.length} chars (aim for 120–160 characters).` : 'Custom meta description is missing.' });
      } else {
        passed.push({ title: `Meta Description length is ideal (${desc.length} chars)` });
      }

      if (title.length < 30 || title.length > 60) {
        issues.push({ st: 'warn', title: 'SEO Title length', desc: `Currently ${title.length} chars (aim for 30–60 characters).` });
      } else {
        passed.push({ title: `SEO Title length is ideal (${title.length} chars)` });
      }

      if (words < 600) {
        issues.push({ st: 'warn', title: 'Content length', desc: `Post is ${words} words long (aim for 600+ words for competitive ranking).` });
      } else {
        passed.push({ title: `Good content depth (${words} words)` });
      }

      const score = post.seoScore;

      body.innerHTML = `
        <div class="seo-diag-grid">
          <div class="seo-diag-header">
            <div>
              <div class="seo-diag-title">${esc(post.title)}</div>
              <div class="muted" style="font-size:12.5px;margin-top:2px">${kw ? `Focus keyword: <b>${esc(kw)}</b>` : '<span style="color:var(--danger)">No focus keyword set</span>'}</div>
            </div>
            <div>${scoreBadge(score, 'Current score')}</div>
          </div>

          ${sugKws.length && !kw ? `
            <div style="background:var(--accent-soft);padding:10px 12px;border-radius:8px">
              <strong style="font-size:12.5px;color:#9a3d00">💡 Suggested Focus Keywords:</strong>
              <div class="sug-chips" style="margin-top:6px">
                ${sugKws.map((k) => `<span class="pill accent">${esc(k)}</span>`).join(' ')}
              </div>
            </div>
          ` : ''}

          <div>
            <strong style="font-size:13px;display:block;margin-bottom:8px">Actionable Recommendations:</strong>
            <ul class="seo-diag-list">
              ${issues.map((it) => `
                <li class="${it.st}">
                  <strong>${it.st === 'bad' ? '❌' : '⚠️'} ${esc(it.title)}</strong>
                  <div style="font-size:12px;margin-top:2px">${esc(it.desc)}</div>
                </li>
              `).join('')}
              ${passed.slice(0, 3).map((it) => `
                <li class="good">
                  <strong>✅ ${esc(it.title)}</strong>
                </li>
              `).join('')}
            </ul>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--line)">
            <button type="button" class="btn btn-ghost" data-close>Close</button>
            <a href="#/${K.edit}/${post.id}" class="btn btn-primary" id="seo-diag-edit-btn">✏️ Edit &amp; Improve SEO</a>
          </div>
        </div>
      `;
      const editBtn = $('#seo-diag-edit-btn');
      if (editBtn) editBtn.onclick = () => close();
    } catch (e) {
      body.innerHTML = `<div class="empty">Could not load post details: ${esc(e.message)}</div>`;
    }
  }
  const imgField = (id, value, placeholder = '', attrs = '') =>
    `<div class="img-field"><input id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}><button type="button" class="btn btn-sm" data-pick="${id}">Choose</button></div>`;
  function wirePickers(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      e.preventDefault();
      const input = document.getElementById(b.dataset.pick);
      openMediaModal((url) => { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); });
    });
  }
  // accept either the bare code or a full <meta ... content="code"> tag
  const verifyValue = (v) => { const m = /content\s*=\s*["']([^"']+)["']/i.exec(v || ''); return (m ? m[1] : v || '').trim(); };

  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (res.status === 401 && path !== '/login' && path !== '/me') { showLogin(); throw new Error('Session expired – please log in again.'); }
    if (!res.ok) throw new Error((typeof data === 'object' && data && data.error) || (typeof data === 'string' && data) || res.statusText || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, type = 'ok', ms = 4500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, ms);
    setTimeout(() => el.remove(), ms + 350);
  }
  const buildNote = (b) => (b ? ` Site rebuilt in ${(b.ms / 1000).toFixed(1)}s.` : '');

  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `${spinner}${label || ''}`; btn.disabled = true; }
    else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
  }

  function setDirty(v) {
    state.dirty = v;
    const dot = $('#dirty-dot');
    if (dot) dot.hidden = !v;
  }
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- auth ---------- */
  function showLogin() {
    destroyEditor();
    $('#app').hidden = true;
    $('#login-view').hidden = false;
    setTimeout(() => $('#login-username').focus(), 50);
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-submit');
    const err = $('#login-error');
    err.hidden = true;
    busy(btn, true, ' Signing in…');
    try {
      await api('/login', { method: 'POST', body: { username: $('#login-username').value.trim(), password: $('#login-password').value } });
      $('#login-password').value = '';
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { busy(btn, false); }
  });

  $('#logout-btn').addEventListener('click', async () => {
    if (state.dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    setDirty(false);
    await api('/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  async function boot() {
    try {
      const me = await api('/me');
      Object.assign(state, { me: me.user, siteUrl: me.siteUrl, siteName: me.siteName });
      $('#current-user').textContent = `(${me.user})`;
      $('#login-view').hidden = true;
      $('#app').hidden = false;
      if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard';
      else route();
    } catch { showLogin(); }
  }

  /* ---------- router ---------- */
  window.addEventListener('hashchange', () => {
    if (state.skipGuard) { state.skipGuard = false; return route(); }
    if (state.dirty && !confirm('You have unsaved changes. Leave this page anyway?')) {
      state.skipGuard = true;
      location.hash = state.lastHash;
      return;
    }
    setDirty(false);
    route();
  });

  function go(hash) { state.skipGuard = true; location.hash = hash; }

  async function route() {
    if ($('#app').hidden) return;
    state.lastHash = location.hash;
    const [, name, arg] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
    const navName = { edit: 'posts', 'edit-page': 'pages', 'new-page': 'pages' }[name] || name;
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navName));
    destroyEditor();
    const fresh = view.cloneNode(false); // drop listeners from the previous screen
    view.replaceWith(fresh);
    view = fresh;
    view.innerHTML = '<div class="empty">Loading…</div>';
    try {
      if (name === 'new') await renderEditor(null);
      else if (name === 'edit') await renderEditor(arg);
      else if (name === 'pages') await renderPosts('page');
      else if (name === 'new-page') await renderEditor(null, 'page');
      else if (name === 'edit-page') await renderEditor(arg, 'page');
      else if (name === 'menu') await renderMenu();
      else if (name === 'social') await renderSocial();
      else if (name === 'media') await renderMedia();
      else if (name === 'seo') await renderSeoSettings(arg);
      else if (name === 'settings') await renderSettings();
      else if (name === 'users') await renderUsers();
      else if (name === 'posts') await renderPosts();
      else await renderDashboard();
    } catch (e) {
      view.innerHTML = `<div class="empty">Could not load this page: ${esc(e.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }

  /* =========================================================
     DASHBOARD
     ========================================================= */
  async function renderDashboard() {
    const [posts, pages, seoData, statics, media, usersData] = await Promise.all([
      api('/posts'), api('/pages'), api('/seo'),
      api('/seo/pages').catch(() => []), api('/media').catch(() => []), api('/users').catch(() => ({ users: [] })),
    ]);
    const s = seoData.settings || {};
    const siteUrl = seoData.siteUrl || state.siteUrl || '';
    const published = posts.filter((p) => p.status === 'publish');
    const drafts = posts.filter((p) => p.status === 'draft');
    const content = [...posts.map((p) => ({ ...p, kind: 'post' })), ...pages.map((p) => ({ ...p, kind: 'page' }))];
    const live = content.filter((p) => p.status === 'publish');

    // SEO distribution across published posts + pages
    const dist = { good: 0, ok: 0, bad: 0, none: 0 };
    live.forEach((p) => { dist[scoreClass(p.seoScore)]++; });
    const scored = live.filter((p) => p.seoScore != null);
    const avg = scored.length ? Math.round(scored.reduce((a, p) => a + p.seoScore, 0) / scored.length) : null;
    const noKw = live.filter((p) => !p.focusKeyword).length;
    const attention = live.slice().sort((a, b) => (a.seoScore ?? -1) - (b.seoScore ?? -1)).filter((p) => (p.seoScore ?? 0) < 80).slice(0, 7);
    const recent = content.slice().sort((a, b) => new Date(b.modified || b.date) - new Date(a.modified || a.date)).slice(0, 7);
    const pct = (n) => (live.length ? (n / live.length) * 100 : 0);

    // setup checklist
    const head = String(s.headCode || '');
    const v = s.verification || {};
    const checks = [
      { ok: /G-[A-Z0-9]{6,}|googletagmanager/i.test(head), t: 'Google Analytics (GA4)', d: 'Tracking code in Custom &lt;head&gt; code', href: '#/seo/webmaster' },
      { ok: !!v.google, t: 'Google Search Console', d: 'Verification code', href: '#/seo/webmaster' },
      { ok: !!v.bing, t: 'Bing Webmaster Tools', d: 'Verification code (also feeds ChatGPT search)', href: '#/seo/webmaster' },
      { ok: !!(s.orgName && s.orgLogo), t: 'Organisation name &amp; logo', d: 'Shown in Google knowledge panel', href: '#/seo/social' },
      { ok: (s.sameAs || []).length > 0, t: 'Social profiles', d: 'Links your brand across the web (AI SEO)', href: '#/seo/social' },
      { ok: !!s.defaultOgImage, t: 'Default share image', d: 'Used when sharing on WhatsApp, Facebook, X', href: '#/seo/general' },
      { ok: /^https:\/\//.test(siteUrl) && !/localhost|127\.0\.0\.1/.test(siteUrl), t: 'Live site URL (HTTPS)', d: esc(siteUrl || 'not set') + ' – set SITE_URL on the server', href: null },
    ];
    const done = checks.filter((c) => c.ok).length;

    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const ico = {
      post: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
      draft: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
      page: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
      media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-8 8"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
      seo: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    };
    const stat = (id, icon, label, value, sub, href, tone = '') => `
      <a class="dash-stat ${tone}" href="${href}" id="dash-stat-${id}">
        <span class="dash-ico"><svg viewBox="0 0 24 24">${ico[icon]}</svg></span>
        <span class="dash-stat-body"><span class="dash-stat-label">${label}</span><strong>${value}</strong><small>${sub}</small></span>
      </a>`;
    const editHref = (p) => `#/${KINDS[p.kind].edit}/${p.id}`;

    view.innerHTML = `
      <div class="dash-hero">
        <div>
          <h1>${hello}, ${esc(state.me)} 👋</h1>
          <p>Here's what's happening on <a href="${esc(siteUrl || '/')}" target="_blank" rel="noopener">${esc(state.siteName || 'your site')}</a> today.</p>
        </div>
        <div class="dash-actions">
          <a href="#/new" class="btn btn-primary" id="dash-new-post"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New post</a>
          <a href="#/new-page" class="btn" id="dash-new-page">New page</a>
          <a href="#/media" class="btn" id="dash-media">Upload media</a>
          <a href="/" target="_blank" rel="noopener" class="btn btn-ghost" id="dash-view-site">View site ↗</a>
        </div>
      </div>

      <div class="dash-stats">
        ${stat('published', 'post', 'Published posts', published.length, `${posts.length} total`, '#/posts')}
        ${stat('drafts', 'draft', 'Drafts', drafts.length, drafts.length ? 'waiting to publish' : 'all caught up', '#/posts', drafts.length ? 'warn' : '')}
        ${stat('pages', 'page', 'Pages', pages.length + statics.length, `${statics.length} original · ${pages.length} custom`, '#/pages')}
        ${stat('media', 'media', 'Media files', media.length, 'images in library', '#/media')}
        ${stat('users', 'users', 'Users', (usersData.users || []).length, 'with admin access', '#/users')}
        ${stat('seo', 'seo', 'Average SEO score', avg == null ? '–' : `${avg}<small>/100</small>`, `based on ${scored.length} of ${live.length} analysed`, '#/posts', avg == null ? '' : scoreClass(avg))}
      </div>

      <div class="dash-grid">
        <div class="card">
          <div class="card-head">SEO health <span class="muted" style="font-weight:500;font-size:12.5px">${live.length} published posts &amp; pages</span></div>
          <div class="card-body">
            <div class="dash-bar" role="img" aria-label="SEO score distribution">
              <span class="good" style="width:${pct(dist.good)}%"></span><span class="ok" style="width:${pct(dist.ok)}%"></span><span class="bad" style="width:${pct(dist.bad)}%"></span><span class="none" style="width:${pct(dist.none)}%"></span>
            </div>
            <div class="dash-legend">
              <span><i class="good"></i>Good (80+) <b>${dist.good}</b></span>
              <span><i class="ok"></i>Needs work (50–79) <b>${dist.ok}</b></span>
              <span><i class="bad"></i>Poor (&lt;50) <b>${dist.bad}</b></span>
              <span><i class="none"></i>Not analysed <b>${dist.none}</b></span>
            </div>
            <h3 class="dash-sub">Needs attention</h3>
            ${attention.length ? `<ul class="dash-list">${attention.map((p) => `
              <li>
                ${scoreBadgeBtn(p.seoScore, p.id, p.kind, 'Click for recommendations')}
                <a href="${editHref(p)}" class="dash-list-title">${esc(p.title)}</a>
                <span class="muted dash-list-meta">${p.focusKeyword ? esc(p.focusKeyword) : '<span style="color:var(--danger)">no keyword</span>'}</span>
              </li>`).join('')}</ul>` : '<div class="empty" style="padding:18px">🎉 Everything scores 80 or higher.</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head">Site setup <span class="pill ${done === checks.length ? 'ok' : 'accent'}">${done}/${checks.length}</span></div>
          <div class="card-body">
            <div class="dash-progress"><span style="width:${(done / checks.length) * 100}%"></span></div>
            <ul class="dash-checks">${checks.map((c) => `
              <li class="${c.ok ? 'ok' : 'todo'}">
                <span class="dash-check">${c.ok ? '✓' : '!'}</span>
                <span class="dash-check-body"><strong>${c.t}</strong><small>${c.d}</small></span>
                ${!c.ok && c.href ? `<a href="${c.href}" class="btn btn-sm">Set up</a>` : ''}
              </li>`).join('')}</ul>
          </div>
        </div>

        <div class="card dash-wide">
          <div class="card-head">Recent activity <a href="#/posts" class="btn btn-ghost btn-sm" style="margin-left:auto">All posts →</a></div>
          <table class="posts">
            <thead><tr><th>Title</th><th>Type</th><th class="col-seo">SEO</th><th>Last change</th></tr></thead>
            <tbody>${recent.map((p) => `
              <tr>
                <td><a class="post-title" href="${editHref(p)}">${esc(p.title)}</a>${p.status === 'draft' ? ' <span class="status draft">Draft</span>' : ''}
                  <div class="row-actions"><a href="${editHref(p)}">Edit</a>${p.status === 'publish' && p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">View</a>` : ''}</div></td>
                <td><span class="pill">${p.kind === 'page' ? 'Page' : 'Post'}</span></td>
                <td class="col-seo">${scoreBadgeBtn(p.seoScore, p.id, p.kind, 'Click for recommendations')}</td>
                <td class="date-cell">${fmtDate(p.modified || p.date)}<small>${fmtTime(p.modified || p.date)}</small></td>
              </tr>`).join('') || '<tr><td colspan="4"><div class="empty">No content yet.</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    view.addEventListener('click', (e) => {
      const diag = e.target.closest('[data-seo-diag]');
      if (diag) { e.preventDefault(); openSeoDiagModal(diag.dataset.seoDiag, diag.dataset.seoKind || 'post'); }
    });
  }

  /* =========================================================
     POSTS / PAGES LIST
     ========================================================= */
  const KINDS = {
    post: { base: '/posts', edit: 'edit', add: 'new', one: 'Post', many: 'Posts' },
    page: { base: '/pages', edit: 'edit-page', add: 'new-page', one: 'Page', many: 'Pages' },
  };

  async function renderPosts(kind = 'post') {
    const K = KINDS[kind];
    const isPage = kind === 'page';
    const [posts, terms] = await Promise.all([api(K.base), api('/terms')]);
    const ui = { filter: 'all', q: '', page: 1, per: 20 };
    const cols = isPage ? 3 : 6;

    view.innerHTML = `
      <div class="page-head">
        <h1>${K.many}</h1>
        <a href="#/${K.add}" class="btn btn-primary" id="add-new-${kind}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add New ${K.one}</a>
        ${isPage ? '<span class="spacer"></span><a href="#/menu" class="btn btn-ghost" id="pages-edit-menu">Edit header menu</a>' : ''}
      </div>
      ${isPage ? '<p class="hint" style="margin:-8px 0 16px">Pages you create here use your site\'s header and footer. Your original pages (home page, game pages…) are listed under <a href="#/seo/pages">SEO → Static Pages</a>.</p>' : ''}
      <div class="toolbar">
        <div class="tabs" id="status-tabs"></div>
        <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input class="input" id="post-search" type="search" placeholder="Search ${K.many.toLowerCase()}…"></label>
      </div>
      <div class="card">
        <table class="posts">
          <thead><tr><th>Title</th>${isPage ? '' : '<th class="col-author">Author</th><th>Categories</th><th class="col-tags">Tags</th>'}<th class="col-seo">SEO</th><th>Date</th></tr></thead>
          <tbody id="posts-body"></tbody>
        </table>
        <div class="pager" id="posts-pager"></div>
      </div>`;

    const name = (type, s) => (terms[type] && terms[type][s]) || s;

    function draw() {
      const counts = { all: posts.length, publish: posts.filter((p) => p.status === 'publish').length, draft: posts.filter((p) => p.status === 'draft').length };
      $('#status-tabs').innerHTML = [['all', 'All'], ['publish', 'Published'], ['draft', 'Drafts']]
        .map(([k, l]) => `<button data-f="${k}" class="${ui.filter === k ? 'active' : ''}" id="tab-${k}">${l}<span class="count">${counts[k]}</span></button>`).join('');

      const q = ui.q.toLowerCase();
      const list = posts.filter((p) => (ui.filter === 'all' || p.status === ui.filter) && (!q || p.title.toLowerCase().includes(q) || p.slug.includes(q)));
      const pages = Math.max(1, Math.ceil(list.length / ui.per));
      ui.page = Math.min(ui.page, pages);
      const slice = list.slice((ui.page - 1) * ui.per, ui.page * ui.per);

      $('#posts-body').innerHTML = slice.length ? slice.map((p) => `
        <tr data-id="${p.id}">
          <td>
            <a class="post-title" href="#/${K.edit}/${p.id}">${esc(p.title)}</a>
            ${p.status === 'draft' ? ' <span class="status draft">Draft</span>' : ''}
            ${isPage ? `<div class="row-sub mono">/${esc(p.slug)}/</div>` : ''}
            <div class="row-actions">
              <a href="#/${K.edit}/${p.id}">Edit</a>
              ${p.status === 'publish' ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">View</a>` : ''}
              <button class="del" data-del="${p.id}">Delete</button>
            </div>
          </td>
          ${isPage ? '' : `<td class="col-author">${esc(name('authors', p.author))}</td>
          <td>${(p.categories || []).map((c) => `<span class="pill">${esc(name('categories', c))}</span>`).join('')}</td>
          <td class="col-tags">${(p.tags || []).slice(0, 3).map((t) => `<span class="pill">${esc(name('tags', t))}</span>`).join('')}${p.tags.length > 3 ? `<span class="muted">+${p.tags.length - 3}</span>` : ''}</td>`}
          <td class="col-seo">${scoreBadgeBtn(p.seoScore, p.id, kind, p.seoScore == null ? `Not analysed yet – click to view recommendations for this ${kind}` : 'Click to view SEO diagnosis & recommendations')}${p.focusKeyword ? `<small class="kw" title="Focus keyword">${esc(p.focusKeyword)}</small>` : ''}${p.noindex ? '<span class="pill warn">noindex</span>' : ''}</td>
          <td class="date-cell">${p.status === 'publish' ? 'Published' : 'Last modified'}<small>${fmtDate(p.status === 'publish' ? p.date : p.modified)} at ${fmtTime(p.status === 'publish' ? p.date : p.modified)}</small></td>
        </tr>`).join('') : `<tr><td colspan="${cols}"><div class="empty">${isPage && !posts.length ? 'No pages yet. <a href="#/new-page">Create your first page</a>.' : `No ${K.many.toLowerCase()} found.`}</div></td></tr>`;

      $('#posts-pager').innerHTML = `${list.length} item${list.length === 1 ? '' : 's'}
        <button class="btn btn-sm" id="pg-prev" ${ui.page <= 1 ? 'disabled' : ''}>&lsaquo;</button>
        <span>Page ${ui.page} of ${pages}</span>
        <button class="btn btn-sm" id="pg-next" ${ui.page >= pages ? 'disabled' : ''}>&rsaquo;</button>`;
    }

    view.addEventListener('click', async (e) => {
      const diag = e.target.closest('[data-seo-diag]');
      if (diag) {
        e.preventDefault();
        return openSeoDiagModal(diag.dataset.seoDiag, diag.dataset.seoKind || 'post');
      }
      const tab = e.target.closest('[data-f]');
      if (tab) { ui.filter = tab.dataset.f; ui.page = 1; draw(); }
      if (e.target.closest('#pg-prev')) { ui.page--; draw(); }
      if (e.target.closest('#pg-next')) { ui.page++; draw(); }
      const del = e.target.closest('[data-del]');
      if (del) {
        const p = posts.find((x) => x.id === +del.dataset.del);
        if (!confirm(`Delete "${p.title}" permanently?`)) return;
        try {
          del.textContent = 'Deleting…';
          const r = await api(`${K.base}/${p.id}`, { method: 'DELETE' });
          posts.splice(posts.indexOf(p), 1);
          draw();
          toast(`${K.one} deleted.${buildNote(r.build)}`);
        } catch (ex) { toast(esc(ex.message), 'err'); draw(); }
      }
    });
    $('#post-search').addEventListener('input', (e) => { ui.q = e.target.value; ui.page = 1; draw(); });
    draw();
  }

  /* =========================================================
     EDITOR
     ========================================================= */
  function destroyEditor() {
    if (window.tinymce) tinymce.remove();
    document.onkeydown = null;
  }

  async function renderEditor(id, kind = 'post') {
    const K = KINDS[kind];
    const isPage = kind === 'page';
    const noun = K.one.toLowerCase();
    const [terms, posts, seoData, loaded] = await Promise.all([api('/terms'), api(K.base), api('/seo'), id ? api(`${K.base}/${id}`) : null]);
    const seoS = seoData.settings;
    const post = loaded || {
      title: '', slug: '', content: '', excerpt: '', status: 'draft', categories: ['blog'], tags: [],
      author: Object.keys(terms.authors)[0] || state.me, date: new Date().toISOString(),
      seoTitle: '', metaDescription: '', featuredImage: '', showTitle: true,
    };
    const host = state.siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const isNew = !id;
    let slugTouched = !isNew;
    const tags = [...(post.tags || [])].map((t) => terms.tags[t] || t);
    let featured = post.featuredImage || '';
    let status = post.status;

    view.innerHTML = `
      <div class="page-head">
        <h1>${isNew ? `Add New ${K.one}` : `Edit ${K.one}`}<span id="dirty-dot" class="dirty-dot" title="Unsaved changes" hidden></span></h1>
        <span class="spacer"></span>
        <a href="#/${isPage ? 'pages' : 'posts'}" class="btn btn-ghost" id="back-to-posts">&larr; All ${K.many.toLowerCase()}</a>
      </div>
      <div class="editor-grid">
        <div>
          <input id="post-title" class="title-input" placeholder="Add title" autocomplete="off">
          <div class="permalink" id="permalink"></div>
          <div class="editor-wrap"><textarea id="post-content"></textarea></div>
          <div class="below-editor">
            <div class="card seo-card" id="seo-card">
              <div class="card-head"><span>SEO</span><span id="seo-score-badge">${scoreBadge(null)}</span></div>
              <div class="seo-tabs" id="seo-tabs" role="tablist">
                <button type="button" class="active" data-seotab="general" id="seotab-general"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>General</button>
                <button type="button" data-seotab="advanced" id="seotab-advanced"><svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>Advanced</button>
                <button type="button" data-seotab="social" id="seotab-social"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>Social</button>
              </div>
              <div class="card-body">
                <div data-seopane="general">
                  <label class="field"><span>Focus keyword <small>the main phrase this ${noun} should rank for</small></span><input id="seo-kw" placeholder="e.g. become a casino agent" autocomplete="off"></label>

                  <div class="seo-suggestions-card" id="seo-suggestions-card">
                    <div class="sug-head"><span class="sug-icon">⚡</span><span>Suggestions to Improve Score</span></div>
                    <div class="sug-body" id="sug-body"></div>
                  </div>

                  <div class="serp-bar"><strong>Google preview</strong>
                    <div class="seg" id="serp-mode"><button type="button" class="active" data-mode="desktop" id="serp-desktop">Desktop</button><button type="button" data-mode="mobile" id="serp-mobile">Mobile</button></div>
                  </div>
                  <div class="serp" id="serp" aria-label="Google preview">
                    <div class="s-site"><img src="/wp-content/uploads/2024/07/Stars777-Logo-100x100.webp" alt=""><div><div class="s-name">${esc(state.siteName)}</div><div class="s-url" id="serp-url"></div></div></div>
                    <div class="s-title" id="serp-title"></div>
                    <div class="s-desc" id="serp-desc"></div>
                  </div>
                  <label class="field" style="margin:16px 0 4px"><span>SEO title <small id="seo-title-count"></small></span><input id="seo-title"></label>
                  <div class="meter"><i id="seo-title-meter"></i></div>
                  <label class="field" style="margin-bottom:4px"><span>Meta description <small id="seo-desc-count"></small></span><textarea id="seo-desc" rows="3" placeholder="Leave empty to use the start of the post"></textarea></label>
                  <div class="meter"><i id="seo-desc-meter"></i></div>
                  <div class="checks-head"><strong>SEO analysis</strong><span class="muted" id="checks-summary"></span></div>
                  <ul class="checklist" id="seo-checks"></ul>
                </div>

                <div data-seopane="advanced" hidden>
                  <label class="field"><span>Canonical URL <small>only change this if the original version lives on another URL</small></span><input id="seo-canonical"></label>
                  <div class="field"><span>Robots meta</span>
                    <div class="robots-grid">
                      <label class="check"><input type="checkbox" id="rb-noindex"> <span><strong>No Index</strong><small>Hide this post from search results</small></span></label>
                      <label class="check"><input type="checkbox" id="rb-nofollow"> <span><strong>No Follow</strong><small>Don't pass link authority</small></span></label>
                      <label class="check"><input type="checkbox" id="rb-noarchive"> <span><strong>No Archive</strong><small>No cached copy in Google</small></span></label>
                      <label class="check"><input type="checkbox" id="rb-noimageindex"> <span><strong>No Image Index</strong><small>Keep images out of image search</small></span></label>
                      <label class="check"><input type="checkbox" id="rb-nosnippet"> <span><strong>No Snippet</strong><small>No text snippet in results</small></span></label>
                    </div>
                  </div>
                  <label class="field"><span>Schema type <small>structured data for rich results</small></span>
                    <select id="seo-schema">${isPage ? `
                      <option value="">Web Page (default)</option>
                      <option value="AboutPage">About Page</option>
                      <option value="ContactPage">Contact Page</option>
                      <option value="CollectionPage">Collection Page</option>` : `
                      <option value="">Default (${esc(seoS.articleSchema === 'none' ? 'None' : seoS.articleSchema)})</option>
                      <option value="BlogPosting">Blog Post</option>
                      <option value="Article">Article</option>
                      <option value="NewsArticle">News Article</option>
                      <option value="none">None</option>`}
                    </select></label>
                  <p class="hint">Breadcrumb, WebPage, WebSite and ${esc(seoS.schemaType)} schema are added automatically. A 301 redirect is created automatically if you change the URL of a published ${noun}.</p>
                </div>

                <div data-seopane="social" hidden>
                  <div class="social-grid">
                    <div>
                      <h4 class="sub-h"><span class="dot fb"></span>Facebook &amp; Open Graph</h4>
                      <label class="field"><span>Title</span><input id="og-title"></label>
                      <label class="field"><span>Description</span><textarea id="og-desc" rows="2"></textarea></label>
                      <div class="field"><span>Image <small>1200×630 recommended</small></span>${imgField('og-image', post.ogImage || '')}</div>
                      <h4 class="sub-h"><span class="dot tw"></span>Twitter / X</h4>
                      <label class="field"><span>Card type</span><select id="tw-card"><option value="summary_large_image">Summary with large image</option><option value="summary">Summary</option></select></label>
                      <label class="field"><span>Title</span><input id="tw-title"></label>
                      <label class="field"><span>Description</span><textarea id="tw-desc" rows="2"></textarea></label>
                      <div class="field"><span>Image</span>${imgField('tw-image', post.twitterImage || '')}</div>
                    </div>
                    <div class="social-previews">
                      <div class="sp-label">Facebook preview</div>
                      <div class="social-card fb"><div class="sc-img"><img id="fb-img" alt=""></div><div class="sc-meta"><div class="sc-domain">${esc(host.toUpperCase())}</div><div class="sc-title" id="fb-title"></div><div class="sc-desc" id="fb-desc"></div></div></div>
                      <div class="sp-label">Twitter / X preview</div>
                      <div class="social-card tw" id="tw-preview"><div class="sc-img"><img id="tw-img" alt=""></div><div class="sc-meta"><div class="sc-title" id="tw-ptitle"></div><div class="sc-desc" id="tw-pdesc"></div><div class="sc-domain">${esc(host)}</div></div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <details class="card box">
              <summary class="card-head">${isPage ? 'Summary' : 'Excerpt'}</summary>
              <div class="card-body">
                <label class="field"><span>${isPage ? 'Short summary <small>used when no meta description is set</small>' : 'Custom excerpt <small>shown on blog listing pages</small>'}</span><textarea id="post-excerpt" rows="3" placeholder="Leave empty to generate automatically"></textarea></label>
              </div>
            </details>
          </div>
        </div>

        <aside class="side-col">
          <div class="card">
            <div class="card-head">Publish</div>
            <div class="card-body">
              <div class="publish-row"><span>Status</span><strong id="status-label"></strong></div>
              <label class="field" style="margin:10px 0 0"><span>Publish date</span><input type="datetime-local" id="post-date"></label>
              <label class="field" style="margin:10px 0 0" ${isPage ? 'hidden' : ''}><span>Author</span><select id="post-author"></select></label>
              ${isPage ? `<label class="check" style="margin:14px 0 0"><input type="checkbox" id="page-show-title" ${post.showTitle === false ? '' : 'checked'}> Show page title at the top</label>` : ''}
              ${isNew ? '' : '<p style="margin:12px 0 0"><button class="link-btn btn-danger" id="delete-post" style="color:var(--danger)">Move to trash</button></p>'}
            </div>
            <div class="publish-actions" id="publish-actions"></div>
          </div>

          <div class="card" ${isPage ? 'hidden' : ''}>
            <div class="card-head">Categories</div>
            <div class="card-body">
              <div class="cat-list" id="cat-list"></div>
              <div class="inline-add"><input class="input" id="new-cat" placeholder="New category"><button class="btn btn-sm" id="add-cat">Add</button></div>
            </div>
          </div>

          <div class="card" ${isPage ? 'hidden' : ''}>
            <div class="card-head">Tags</div>
            <div class="card-body">
              <div class="inline-add"><input class="input" id="tag-input" placeholder="Add tag, press Enter"><button class="btn btn-sm" id="add-tag">Add</button></div>
              <div class="chips" id="tag-chips"></div>
              <div class="suggest" id="tag-suggest"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">Featured image</div>
            <div class="card-body featured-box" id="featured-box"></div>
          </div>
        </aside>
      </div>`;

    /* --- fill fields --- */
    $('#post-title').value = post.title;
    $('#post-content').value = post.content || '';
    $('#seo-title').value = post.seoTitle || '';
    $('#seo-desc').value = post.metaDescription || '';
    $('#post-excerpt').value = post.excerpt || '';
    $('#seo-kw').value = post.focusKeyword || '';
    $('#seo-canonical').value = post.canonical || '';
    const rb = post.robots || {};
    ['noindex', 'nofollow', 'noarchive', 'noimageindex', 'nosnippet'].forEach((k) => { $(`#rb-${k}`).checked = !!rb[k]; });
    $('#seo-schema').value = post.schemaType || '';
    $('#og-title').value = post.ogTitle || '';
    $('#og-desc').value = post.ogDescription || '';
    $('#tw-title').value = post.twitterTitle || '';
    $('#tw-desc').value = post.twitterDescription || '';
    $('#tw-card').value = post.twitterCard || 'summary_large_image';
    $('#post-date').value = toLocalInput(post.date);
    $('#post-author').innerHTML = Object.entries(terms.authors).map(([s, n]) => `<option value="${esc(s)}">${esc(n)}</option>`).join('')
      || `<option value="${esc(state.me)}">${esc(state.me)}</option>`;
    $('#post-author').value = post.author;
    let slug = post.slug || '';

    /* --- permalink --- */
    function drawPermalink(editing) {
      const el = $('#permalink');
      const s = slug || slugify($('#post-title').value) || 'your-post';
      if (editing) {
        el.innerHTML = `Permalink: ${esc(state.siteUrl)}/<input id="slug-input" value="${esc(s)}">/ <button class="btn btn-sm" id="slug-ok">OK</button>`;
        const inp = $('#slug-input');
        inp.focus(); inp.select();
        const done = () => { slug = slugify(inp.value) || slug; slugTouched = true; setDirty(true); drawPermalink(false); updateSerp(); };
        $('#slug-ok').onclick = done;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } if (e.key === 'Escape') drawPermalink(false); };
      } else {
        const live = status === 'publish' && !isNew;
        el.innerHTML = `Permalink: ${live ? `<a href="/${esc(post.slug)}/" target="_blank" rel="noopener">${esc(state.siteUrl)}/${esc(s)}/</a>` : `<span>${esc(state.siteUrl)}/${esc(s)}/</span>`}
          <button class="btn btn-sm" id="slug-edit">Edit</button>`;
        $('#slug-edit').onclick = () => drawPermalink(true);
      }
    }

    $('#post-title').addEventListener('input', () => {
      if (!slugTouched) slug = slugify($('#post-title').value);
      drawPermalink(false);
      updateSerp();
    });

    /* --- SEO: previews, social cards, live analysis --- */
    let parsed = { doc: document.implementation.createHTMLDocument(''), text: '' };
    let lastScore = null;
    const contentHtml = () => { const ed = window.tinymce && tinymce.get('post-content'); return ed && ed.initialized ? ed.getContent() : $('#post-content').value; };
    function reparse() {
      const doc = new DOMParser().parseFromString(contentHtml() || '', 'text/html');
      doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
      parsed = { doc, text: (doc.body.textContent || '').replace(/\s+/g, ' ').trim() };
    }
    const curSlug = () => slug || slugify($('#post-title').value) || 'your-post';
    const autoTitle = () => applyTpl(isPage ? (seoS.pageTitle || seoS.postTitle) : seoS.postTitle, seoS, { title: $('#post-title').value.trim() || `${K.one} title` });
    const effTitle = () => $('#seo-title').value.trim() || autoTitle();
    const autoDesc = () => {
      const ex = $('#post-excerpt').value.trim();
      if (ex) return ex;
      const w = parsed.text.split(' ').filter(Boolean);
      return w.slice(0, 30).join(' ') + (w.length > 30 ? '…' : '');
    };
    const effDesc = () => $('#seo-desc').value.trim() || autoDesc();
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hl = (str, kw) => (kw ? esc(str).replace(new RegExp(`(${reEsc(esc(kw))})`, 'gi'), '<b>$1</b>') : esc(str));
    const setMeter = (el, len, lo, hi) => { el.style.width = `${Math.min(100, (len / hi) * 100)}%`; el.className = !len ? '' : len < lo ? 'warn' : len > hi ? 'bad' : 'good'; };

    function updateSerp() {
      const kw = $('#seo-kw').value.trim();
      const t = effTitle(), d = effDesc();
      $('#seo-title').placeholder = autoTitle();
      $('#seo-canonical').placeholder = `${state.siteUrl}/${curSlug()}/`;
      $('#serp-url').textContent = `${state.siteUrl} › ${curSlug()}`;
      $('#serp-title').innerHTML = hl(t, kw);
      $('#serp-desc').innerHTML = hl(d.length > 160 ? `${d.slice(0, 157)}…` : d, kw);
      $('#seo-title-count').textContent = `${t.length} / 60`;
      $('#seo-title-count').classList.toggle('over', t.length > 60);
      $('#seo-desc-count').textContent = `${d.length} / 160${$('#seo-desc').value.trim() ? '' : ' (auto)'}`;
      $('#seo-desc-count').classList.toggle('over', d.length > 160);
      setMeter($('#seo-title-meter'), t.length, 30, 60);
      setMeter($('#seo-desc-meter'), d.length, 120, 160);

      const ogT = $('#og-title').value.trim() || t;
      const ogD = $('#og-desc').value.trim() || d;
      const ogI = $('#og-image').value.trim() || featured || seoS.defaultOgImage || '';
      $('#og-title').placeholder = t; $('#og-desc').placeholder = d;
      $('#og-image').placeholder = featured ? 'Featured image (default)' : seoS.defaultOgImage ? 'Default share image' : 'Image URL';
      $('#tw-title').placeholder = ogT; $('#tw-desc').placeholder = ogD;
      $('#tw-image').placeholder = 'Same as Facebook image';
      $('#fb-img').src = ogI; $('#fb-img').hidden = !ogI;
      $('#fb-title').textContent = ogT; $('#fb-desc').textContent = ogD;
      const twI = $('#tw-image').value.trim() || ogI;
      $('#tw-img').src = twI; $('#tw-img').hidden = !twI;
      $('#tw-ptitle').textContent = $('#tw-title').value.trim() || ogT;
      $('#tw-pdesc').textContent = $('#tw-desc').value.trim() || ogD;
      $('#tw-preview').classList.toggle('small', $('#tw-card').value === 'summary');
      analyze();
    }

    function analyze() {
      const { doc, text } = parsed;
      const lower = text.toLowerCase();
      const words = text ? text.split(' ').length : 0;
      const kw = $('#seo-kw').value.trim();
      const k = kw.toLowerCase();
      const title = effTitle(), desc = effDesc(), s = curSlug();
      const imgs = [...doc.querySelectorAll('img')];
      const heads = [...doc.querySelectorAll('h2,h3,h4,h5,h6')];
      const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
      const internal = links.filter((h) => (h.startsWith('/') && !h.startsWith('//')) || h.includes(host));
      const external = links.filter((h) => /^(https?:)?\/\//i.test(h) && !h.includes(host));
      const longParas = [...doc.querySelectorAll('p')].filter((p) => (p.textContent || '').trim().split(/\s+/).length > 150).length;
      const checks = [];
      const add = (w, st, msg) => checks.push({ w, st, msg });
      const has = (str) => String(str || '').toLowerCase().includes(k);

      if (!k) add(40, 'bad', 'Set a <b>focus keyword</b> to unlock the keyword checks.');
      else {
        add(8, has(title) ? 'good' : 'bad', has(title) ? 'Focus keyword is used in the SEO title.' : 'Add the focus keyword to the <b>SEO title</b>.');
        const pos = title.toLowerCase().indexOf(k);
        add(3, pos >= 0 && pos <= title.length / 2 ? 'good' : 'warn', pos >= 0 && pos <= title.length / 2 ? 'Focus keyword appears near the beginning of the title.' : 'Move the focus keyword closer to the <b>start of the title</b>.');
        add(6, has(desc) ? 'good' : 'bad', has(desc) ? 'Focus keyword is used in the meta description.' : 'Add the focus keyword to the <b>meta description</b>.');
        const ks = slugify(kw);
        add(5, ks && s.includes(ks) ? 'good' : 'bad', ks && s.includes(ks) ? 'Focus keyword is used in the URL.' : 'Use the focus keyword in the <b>URL</b> (permalink).');
        const first = lower.slice(0, Math.max(300, Math.round(lower.length * 0.1)));
        add(5, first.includes(k) ? 'good' : 'bad', first.includes(k) ? 'Focus keyword appears at the beginning of the content.' : 'Use the focus keyword in the <b>first paragraph</b> (first 10% of the content).');
        const inHead = heads.some((h) => has(h.textContent));
        add(4, inHead ? 'good' : 'warn', inHead ? 'Focus keyword is used in a subheading.' : 'Use the focus keyword in at least one <b>subheading</b> (H2, H3…).');
        const inAlt = imgs.some((i) => has(i.getAttribute('alt')));
        add(3, inAlt ? 'good' : 'warn', inAlt ? 'An image has the focus keyword in its alt text.' : 'Add an image with the focus keyword in its <b>alt text</b>.');
        const count = k ? lower.split(k).length - 1 : 0;
        const density = words ? (count * k.split(/\s+/).length / words) * 100 : 0;
        add(5, density >= 0.5 && density <= 2.5 ? 'good' : count ? 'warn' : 'bad',
          `Keyword density is <b>${density.toFixed(2)}%</b> (used ${count}×). ${density > 2.5 ? 'That looks like keyword stuffing – aim for 0.5–2.5%.' : density < 0.5 ? 'Aim for 0.5–2.5%.' : 'Great.'}`);
        const dup = posts.find((p) => p.id !== post.id && (p.focusKeyword || '').toLowerCase() === k);
        add(3, dup ? 'warn' : 'good', dup ? `This focus keyword is already used in “${esc(dup.title)}”.` : "You haven't used this focus keyword before.");
      }
      add(8, words >= 600 ? 'good' : words >= 300 ? 'warn' : 'bad', `Content is <b>${words}</b> words long. ${words >= 600 ? 'Good job!' : 'Aim for at least 600 words.'}`);
      add(5, title.length >= 30 && title.length <= 60 ? 'good' : 'warn', `SEO title is <b>${title.length}</b> characters. ${title.length > 60 ? 'Google may cut it off – keep it under 60.' : title.length < 30 ? 'Try 30–60 characters.' : 'Perfect length.'}`);
      const customDesc = !!$('#seo-desc').value.trim();
      add(5, customDesc && desc.length >= 120 && desc.length <= 160 ? 'good' : 'warn',
        !customDesc ? 'Write a custom <b>meta description</b> (120–160 characters) instead of the automatic one.' : `Meta description is <b>${desc.length}</b> characters. ${desc.length > 160 ? 'Keep it under 160.' : desc.length < 120 ? 'Try 120–160 characters.' : 'Perfect length.'}`);
      const urlLen = `${state.siteUrl}/${s}/`.length;
      add(2, urlLen <= 75 ? 'good' : 'warn', urlLen <= 75 ? `URL is short (${urlLen} characters).` : `URL is <b>${urlLen}</b> characters – shorter URLs work better.`);
      add(3, internal.length ? 'good' : 'warn', internal.length ? `${internal.length} internal link${internal.length > 1 ? 's' : ''} found.` : 'Add <b>internal links</b> to other posts or pages on your site.');
      add(3, external.length ? 'good' : 'warn', external.length ? `${external.length} external link${external.length > 1 ? 's' : ''} found.` : 'Link out to at least one <b>external</b> authoritative source.');
      add(3, imgs.length || featured ? 'good' : 'warn', imgs.length || featured ? 'Content has images.' : 'Add at least one <b>image</b> to the post.');
      add(2, longParas ? 'warn' : 'good', longParas ? `${longParas} paragraph${longParas > 1 ? 's are' : ' is'} longer than 150 words – break ${longParas > 1 ? 'them' : 'it'} up.` : 'Paragraphs are a comfortable length.');
      if ($('#rb-noindex').checked) add(0, 'bad', 'This post is set to <b>No Index</b> (Advanced tab) – it will not appear in Google.');

      const total = checks.reduce((a, c) => a + c.w, 0);
      const got = checks.reduce((a, c) => a + c.w * (c.st === 'good' ? 1 : c.st === 'warn' ? 0.5 : 0), 0);
      lastScore = Math.round((got / total) * 100);
      $('#seo-score-badge').innerHTML = scoreBadge(lastScore);
      const order = { bad: 0, warn: 1, good: 2 };
      const n = { bad: 0, warn: 0, good: 0 };
      checks.forEach((c) => n[c.st]++);
      $('#seo-checks').innerHTML = checks.sort((a, b) => order[a.st] - order[b.st]).map((c) => `<li class="${c.st}">${c.msg}</li>`).join('');
      $('#checks-summary').textContent = `${n.bad} error${n.bad === 1 ? '' : 's'} · ${n.warn} warning${n.warn === 1 ? '' : 's'} · ${n.good} passed`;

      /* --- Actionable suggestions box --- */
      const sugCard = $('#seo-suggestions-card');
      const sugBody = $('#sug-body');
      if (sugCard && sugBody) {
        sugCard.className = `seo-suggestions-card ${scoreClass(lastScore)}`;
        const sugKws = extractKeywordCandidates($('#post-title').value.trim(), heads, text, tags);
        const sugItems = [];

        if (!k) {
          sugItems.push(`
            <div class="sug-item critical">
              <div class="sug-title">❌ <strong>Set a Focus Keyword</strong> <span class="pill warn">+40 pts</span></div>
              <div class="sug-desc">Adding a focus keyword unlocks all keyword optimization checks and boosts your score immediately.</div>
              ${sugKws.length ? `
                <div style="margin-top:4px;font-size:12px;font-weight:600;color:var(--ink-2)">Click to apply a suggested keyword from your title:</div>
                <div class="sug-chips">
                  ${sugKws.map((kwChoice) => `<button type="button" data-set-kw="${esc(kwChoice)}">+ ${esc(kwChoice)}</button>`).join('')}
                </div>
              ` : ''}
            </div>
          `);
        } else {
          if (!has(title)) {
            sugItems.push(`
              <div class="sug-item critical">
                <div class="sug-title">❌ <strong>Include Focus Keyword in SEO Title</strong> <span class="pill warn">+8 pts</span></div>
                <div class="sug-desc">Add “<b>${esc(kw)}</b>” to your SEO title so search engines recognize what this page is about.</div>
                <div class="sug-actions">
                  <button type="button" class="btn btn-sm" id="sug-btn-fix-title">✨ Auto-Optimize Title</button>
                </div>
              </div>
            `);
          }
          if (!has(desc)) {
            sugItems.push(`
              <div class="sug-item warn">
                <div class="sug-title">⚠️ <strong>Include Focus Keyword in Meta Description</strong> <span class="pill warn">+6 pts</span></div>
                <div class="sug-desc">Mention “<b>${esc(kw)}</b>” in the meta description to improve click-through rates.</div>
                <div class="sug-actions">
                  <button type="button" class="btn btn-sm" id="sug-btn-gen-desc">✨ Auto-Generate Description with Keyword</button>
                </div>
              </div>
            `);
          }
        }

        if (!customDesc || desc.length < 120 || desc.length > 160) {
          if (!sugItems.some((x) => x.includes('id="sug-btn-gen-desc"'))) {
            sugItems.push(`
              <div class="sug-item warn">
                <div class="sug-title">⚠️ <strong>Optimize Meta Description Length</strong> <span class="pill warn">+5 pts</span></div>
                <div class="sug-desc">${!customDesc ? 'No custom description set (using auto excerpt).' : `Currently ${desc.length} chars (sweet spot is 120–160 chars).`}</div>
                <div class="sug-actions">
                  <button type="button" class="btn btn-sm" id="sug-btn-gen-desc">✨ Auto-Generate 145-char Description</button>
                </div>
              </div>
            `);
          }
        }

        if (title.length < 30 || title.length > 60) {
          if (!sugItems.some((x) => x.includes('id="sug-btn-fix-title"'))) {
            sugItems.push(`
              <div class="sug-item warn">
                <div class="sug-title">⚠️ <strong>Optimize SEO Title Length</strong> <span class="pill warn">+5 pts</span></div>
                <div class="sug-desc">Currently ${title.length} characters (ideal is 30–60 characters for search results).</div>
                <div class="sug-actions">
                  <button type="button" class="btn btn-sm" id="sug-btn-fix-title">✨ Format Title Length</button>
                </div>
              </div>
            `);
          }
        }

        const moreTips = [];
        if (k && !heads.some((h) => has(h.textContent))) moreTips.push('Add your focus keyword to at least one <b>H2 or H3 subheading</b>.');
        if (k && !lower.slice(0, Math.max(300, Math.round(lower.length * 0.1))).includes(k)) moreTips.push('Use the focus keyword in the <b>first paragraph</b> of your content.');
        if (words < 600) moreTips.push(`Expand content length (currently <b>${words}</b> words, aim for 600+ words).`);
        if (!internal.length) moreTips.push('Add at least one <b>internal link</b> to another post or page on your site.');
        if (!imgs.length && !featured) moreTips.push('Add a <b>featured image</b> or image with alt text.');

        if (moreTips.length && lastScore < 80) {
          sugItems.push(`
            <div class="sug-item">
              <div class="sug-title">💡 <strong>Quick Content Tips:</strong></div>
              <ul class="sug-bullet-list">
                ${moreTips.map((tip) => `<li>${tip}</li>`).join('')}
              </ul>
            </div>
          `);
        }

        if (!sugItems.length || lastScore >= 80) {
          sugItems.unshift(`
            <div class="sug-item success">
              <div class="sug-title">🎉 <strong>Great SEO Health!</strong> (${lastScore}/100)</div>
              <div class="sug-desc">This ${noun} fulfills major SEO best practices and is well-optimized for search engines.</div>
            </div>
          `);
        }

        sugBody.innerHTML = sugItems.join('');
      }
    }

    let contentTimer;
    const contentChanged = () => { clearTimeout(contentTimer); contentTimer = setTimeout(() => { reparse(); updateSerp(); }, 400); };
    $('#seo-card').addEventListener('input', updateSerp);
    $('#seo-card').addEventListener('change', updateSerp);
    $('#post-excerpt').addEventListener('input', updateSerp);

    /* --- Click handlers for suggestions --- */
    $('#seo-card').addEventListener('click', (e) => {
      const setKwBtn = e.target.closest('[data-set-kw]');
      if (setKwBtn) {
        e.preventDefault();
        $('#seo-kw').value = setKwBtn.dataset.setKw;
        setDirty(true);
        updateSerp();
        toast(`Focus keyword set to “${esc(setKwBtn.dataset.setKw)}”.`, 'ok', 2500);
        return;
      }
      if (e.target.closest('#sug-btn-gen-desc')) {
        e.preventDefault();
        const auto = buildAutoDescription(parsed.text, $('#seo-kw').value.trim(), $('#post-title').value.trim());
        $('#seo-desc').value = auto;
        setDirty(true);
        updateSerp();
        toast('Meta description generated & applied.', 'ok', 2500);
        return;
      }
      if (e.target.closest('#sug-btn-fix-title')) {
        e.preventDefault();
        let t = $('#post-title').value.trim();
        const kwVal = $('#seo-kw').value.trim();
        if (kwVal && !t.toLowerCase().includes(kwVal.toLowerCase())) {
          t = `${kwVal} – ${t}`;
        }
        if (t.length < 35) {
          t = applyTpl(isPage ? (seoS.pageTitle || seoS.postTitle) : seoS.postTitle, seoS, { title: t });
        }
        if (t.length > 60) {
          t = t.slice(0, 58).replace(/\s+\S*$/, '');
        }
        $('#seo-title').value = t;
        setDirty(true);
        updateSerp();
        toast('SEO title optimized.', 'ok', 2500);
        return;
      }
    });

    $('#seo-tabs').onclick = (e) => {
      const b = e.target.closest('[data-seotab]');
      if (!b) return;
      $$('[data-seotab]').forEach((x) => x.classList.toggle('active', x === b));
      $$('[data-seopane]').forEach((p) => { p.hidden = p.dataset.seopane !== b.dataset.seotab; });
    };
    $('#serp-mode').onclick = (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      $$('#serp-mode button').forEach((x) => x.classList.toggle('active', x === b));
      $('#serp').classList.toggle('mobile', b.dataset.mode === 'mobile');
    };
    wirePickers($('#seo-card'));

    /* --- status / buttons --- */
    function drawActions() {
      $('#status-label').innerHTML = `<span class="status ${status}">${status === 'publish' ? 'Published' : 'Draft'}</span>`;
      $('#publish-actions').innerHTML = status === 'publish' && !isNew
        ? `<button class="btn btn-sm" id="btn-unpublish" title="Take this post offline">Unpublish</button>
           <button class="btn btn-sm" id="btn-preview">Preview</button>
           <button class="btn btn-primary btn-sm" id="btn-update">Update</button>`
        : `<button class="btn btn-sm" id="btn-draft">Save draft</button>
           <button class="btn btn-sm" id="btn-preview">Preview</button>
           <button class="btn btn-primary btn-sm" id="btn-publish">Publish</button>`;
    }

    /* --- categories --- */
    const selectedCats = new Set(post.categories || []);
    function drawCats() {
      $('#cat-list').innerHTML = Object.entries(terms.categories).map(([s, n]) =>
        `<label class="check"><input type="checkbox" value="${esc(s)}" ${selectedCats.has(s) ? 'checked' : ''}> ${esc(n)}</label>`).join('');
    }
    $('#cat-list').addEventListener('change', (e) => { e.target.checked ? selectedCats.add(e.target.value) : selectedCats.delete(e.target.value); setDirty(true); });
    async function addCat() {
      const n = $('#new-cat').value.trim();
      if (!n) return;
      const r = await api('/terms/categories', { method: 'POST', body: { name: n } });
      terms.categories = r.terms.categories;
      selectedCats.add(r.slug);
      $('#new-cat').value = '';
      drawCats(); setDirty(true);
    }
    $('#add-cat').onclick = addCat;
    $('#new-cat').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } };

    /* --- tags --- */
    const tagUse = {};
    posts.forEach((p) => (p.tags || []).forEach((t) => { tagUse[t] = (tagUse[t] || 0) + 1; }));
    function drawTags() {
      $('#tag-chips').innerHTML = tags.map((t, i) => `<span class="chip">${esc(t)}<button data-rm="${i}" aria-label="Remove tag">&times;</button></span>`).join('');
      const have = new Set(tags.map((t) => slugify(t)));
      const top = Object.entries(tagUse).sort((a, b) => b[1] - a[1]).map(([s]) => s).filter((s) => !have.has(s)).slice(0, 10);
      $('#tag-suggest').innerHTML = top.length ? `Most used: ${top.map((s) => `<button data-add="${esc(s)}">${esc(terms.tags[s] || s)}</button>`).join('')}` : '';
    }
    function addTags(text) {
      text.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
        if (!tags.some((x) => slugify(x) === slugify(t))) tags.push(t);
      });
      drawTags(); setDirty(true);
    }
    $('#add-tag').onclick = () => { addTags($('#tag-input').value); $('#tag-input').value = ''; };
    $('#tag-input').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTags($('#tag-input').value); $('#tag-input').value = ''; }
    };
    $('#tag-chips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { tags.splice(+b.dataset.rm, 1); drawTags(); setDirty(true); } };
    $('#tag-suggest').onclick = (e) => { const b = e.target.closest('[data-add]'); if (b) addTags(terms.tags[b.dataset.add] || b.dataset.add); };

    /* --- featured image --- */
    function drawFeatured() {
      $('#featured-box').innerHTML = featured
        ? `<img src="${esc(featured)}" alt=""><div style="display:flex;gap:8px"><button class="btn btn-sm" id="feat-change">Replace</button><button class="btn btn-sm btn-danger" id="feat-remove">Remove</button></div>`
        : `<div class="featured-empty" id="feat-set" role="button" tabindex="0">+ Set featured image</div>`;
    }
    $('#featured-box').onclick = (e) => {
      if (e.target.closest('#feat-set, #feat-change')) openMediaModal((url) => { featured = url; drawFeatured(); setDirty(true); updateSerp(); });
      if (e.target.closest('#feat-remove')) { featured = ''; drawFeatured(); setDirty(true); updateSerp(); }
    };

    /* --- collect + save --- */
    function collect(newStatus) {
      return {
        id: post.id,
        title: $('#post-title').value.trim(),
        slug: slug || slugify($('#post-title').value),
        content: tinymce.get('post-content') ? tinymce.get('post-content').getContent() : $('#post-content').value,
        excerpt: $('#post-excerpt').value,
        seoTitle: $('#seo-title').value,
        metaDescription: $('#seo-desc').value,
        featuredImage: featured,
        focusKeyword: $('#seo-kw').value.trim(),
        canonical: $('#seo-canonical').value.trim(),
        robots: Object.fromEntries(['noindex', 'nofollow', 'noarchive', 'noimageindex', 'nosnippet'].map((k) => [k, $(`#rb-${k}`).checked])),
        schemaType: $('#seo-schema').value,
        ogTitle: $('#og-title').value.trim(),
        ogDescription: $('#og-desc').value.trim(),
        ogImage: $('#og-image').value.trim(),
        twitterCard: $('#tw-card').value,
        twitterTitle: $('#tw-title').value.trim(),
        twitterDescription: $('#tw-desc').value.trim(),
        twitterImage: $('#tw-image').value.trim(),
        seoScore: lastScore,
        status: newStatus || status,
        date: $('#post-date').value ? new Date($('#post-date').value).toISOString() : new Date().toISOString(),
        author: $('#post-author').value,
        categories: [...selectedCats],
        tags,
        ...(isPage ? { kind: 'page', showTitle: $('#page-show-title').checked } : {}),
      };
    }

    async function save(newStatus, btn) {
      const data = collect(newStatus);
      if (!data.title) { toast('Please add a title first.', 'err'); $('#post-title').focus(); return; }
      busy(btn, true);
      try {
        const r = isNew
          ? await api(K.base, { method: 'POST', body: data })
          : await api(`${K.base}/${post.id}`, { method: 'PUT', body: data });
        setDirty(false);
        const p = r.post;
        const verb = p.status === 'publish' ? (newStatus === 'publish' && status !== 'publish' ? `${K.one} published.` : `${K.one} updated.`) : 'Draft saved.';
        toast(`${verb}${buildNote(r.build)}${p.status === 'publish' ? ` <a href="/${esc(p.slug)}/" target="_blank" rel="noopener">View ${noun}</a>` : ''}`);
        if (isNew || p.slug !== post.slug || p.status !== status) go(`#/${K.edit}/${p.id}`);
        else { Object.assign(post, p); slug = p.slug; drawPermalink(false); busy(btn, false); }
      } catch (ex) {
        toast(esc(ex.message), 'err');
        busy(btn, false);
      }
    }

    async function preview() {
      const w = window.open('', '_blank');
      if (!w) { toast('Allow pop-ups to preview.', 'err'); return; }
      w.document.write('<p style="font-family:sans-serif;padding:2rem">Loading preview…</p>');
      try {
        const html = await api('/preview', { method: 'POST', body: collect() });
        w.document.open(); w.document.write(html); w.document.close();
      } catch (ex) { w.close(); toast(esc(ex.message), 'err'); }
    }

    $('#publish-actions').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'btn-draft') save('draft', b);
      if (b.id === 'btn-publish') save('publish', b);
      if (b.id === 'btn-update') save('publish', b);
      if (b.id === 'btn-unpublish' && confirm(`Unpublish this ${noun}? It will be removed from the live site and kept as a draft.`)) save('draft', b);
      if (b.id === 'btn-preview') preview();
    };

    const delBtn = $('#delete-post');
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm(`Delete "${post.title}" permanently?`)) return;
      try {
        const r = await api(`${K.base}/${post.id}`, { method: 'DELETE' });
        setDirty(false);
        toast(`${K.one} deleted.${buildNote(r.build)}`);
        go(`#/${isPage ? 'pages' : 'posts'}`);
      } catch (ex) { toast(esc(ex.message), 'err'); }
    };

    document.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const b = $('#btn-update') || $('#btn-draft');
        if (b && !b.disabled) save(status, b);
      }
    };

    view.addEventListener('input', (e) => { if (e.target.closest('.editor-grid')) setDirty(true); });
    view.addEventListener('change', (e) => { if (e.target.closest('#seo-card') && e.target.matches('select, input[type=checkbox]')) setDirty(true); });

    drawPermalink(false); drawActions(); drawCats(); drawTags(); drawFeatured();
    reparse(); updateSerp();

    /* --- TinyMCE (self-hosted, GPL) --- */
    await tinymce.init({
      selector: '#post-content',
      license_key: 'gpl',
      height: 640,
      min_height: 460,
      menubar: 'edit view insert format table tools',
      plugins: 'advlist autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table wordcount autoresize',
      toolbar: 'undo redo | blocks | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image media table | blockquote hr | removeformat code fullscreen',
      toolbar_sticky: true,
      toolbar_sticky_offset: 0,
      autoresize_bottom_margin: 40,
      block_formats: 'Paragraph=p; Heading 2=h2; Heading 3=h3; Heading 4=h4; Heading 5=h5; Preformatted=pre',
      relative_urls: false,
      remove_script_host: true,
      convert_urls: true,
      valid_elements: '*[*]',
      extended_valid_elements: '*[*]',
      valid_children: '+body[style],+div[style]',
      image_caption: true,
      image_advtab: true,
      image_title: true,
      automatic_uploads: true,
      file_picker_types: 'image',
      file_picker_callback: (cb) => openMediaModal((url) => cb(url, { alt: '' })),
      images_upload_handler: (blobInfo) => uploadFile(blobInfo.blob(), blobInfo.filename()).then((r) => r.location),
      content_css: ['/wp-content/themes/kadence/assets/css/global.min.css', '/wp-content/themes/kadence/assets/css/content.min.css'],
      body_class: 'entry-content single-content',
      content_style: `
        body{max-width:860px;margin:24px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.6;color:#2D3748;background:#fff}
        h1,h2,h3,h4,h5,h6{color:#1A202C;font-weight:700;line-height:1.5} h2{font-size:28px} h3{font-size:24px}
        img{max-width:100%;height:auto} .aligncenter{display:block;margin-left:auto;margin-right:auto}
        .alignleft{float:left;margin:0 1em 1em 0} .alignright{float:right;margin:0 0 1em 1em} a{color:#2B6CB0}`,
      setup: (ed) => {
        ed.on('input change undo redo SetContent', (e) => { if (!e.initial && !e.load) setDirty(true); });
        ed.on('init', () => { setDirty(false); reparse(); updateSerp(); });
        ed.on('keyup change undo redo SetContent', contentChanged);
      },
    });
    if (isNew) $('#post-title').focus();
  }

  /* =========================================================
     MEDIA
     ========================================================= */
  async function uploadFile(file, name) {
    const fd = new FormData();
    fd.append('file', file, name || file.name);
    return api('/media', { method: 'POST', body: fd });
  }

  async function uploadMany(files) {
    const out = [];
    for (const f of files) {
      try { out.push(await uploadFile(f)); }
      catch (ex) { toast(`${esc(f.name)}: ${esc(ex.message)}`, 'err'); }
    }
    if (out.length) toast(`${out.length} image${out.length > 1 ? 's' : ''} uploaded.`);
    return out;
  }

  function mediaGrid(items) {
    return items.length
      ? items.map((m) => `<button class="media-item" data-url="${esc(m.url)}" title="${esc(m.url)}"><img loading="lazy" src="${esc(m.url)}" alt=""><span>${esc(m.url.split('/').pop())}</span></button>`).join('')
      : '<div class="empty">No images yet.</div>';
  }

  function wireDropzone(zone, input, onDone) {
    input.onchange = async () => { await uploadMany([...input.files]); input.value = ''; onDone(); };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = async (e) => {
      e.preventDefault(); zone.classList.remove('over');
      await uploadMany([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
      onDone();
    };
  }

  async function renderMedia() {
    view.innerHTML = `
      <div class="page-head"><h1>Media library</h1></div>
      <label class="dropzone" id="media-dropzone">
        <input type="file" accept="image/*" multiple hidden id="media-file-input">
        <strong>Drop images here</strong> or click to upload &middot; JPG, PNG, WebP, GIF, SVG up to 15&nbsp;MB
      </label>
      <p class="muted" style="margin:-6px 0 14px">Click an image to copy its URL.</p>
      <div class="media-grid" id="media-grid"><div class="empty">Loading…</div></div>`;
    const load = async () => { $('#media-grid').innerHTML = mediaGrid(await api('/media')); };
    wireDropzone($('#media-dropzone'), $('#media-file-input'), load);
    $('#media-grid').onclick = async (e) => {
      const b = e.target.closest('[data-url]');
      if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.url); toast('Image URL copied to clipboard.'); }
      catch { prompt('Image URL:', b.dataset.url); }
    };
    await load();
  }

  function openMediaModal(onSelect) {
    const modal = $('#media-modal');
    const grid = $('#modal-media-grid');
    modal.hidden = false;
    grid.innerHTML = '<div class="empty">Loading…</div>';
    const load = async () => { grid.innerHTML = mediaGrid(await api('/media')); };
    const close = () => { modal.hidden = true; grid.onclick = null; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wireDropzone($('#modal-dropzone'), $('#modal-file-input'), load);
    grid.onclick = (e) => { const b = e.target.closest('[data-url]'); if (b) { onSelect(b.dataset.url); close(); } };
    modal.onclick = (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); };
    load();
  }

  /* =========================================================
     HEADER MENU
     ========================================================= */
  async function renderMenu() {
    const [data, pages, statics] = await Promise.all([api('/menu'), api('/pages'), api('/seo/pages').catch(() => [])]);
    let items = data.items.map((i) => ({ ...i }));
    const short = (t) => String(t || '').split(/\s+[-–—|·•»]\s+/)[0].trim();
    const myPages = pages.filter((p) => p.status === 'publish').map((p) => [p.title, `/${p.slug}/`]);
    const sitePages = statics.filter((p) => p.path !== '/').map((p) => [short(p.title) || p.path, p.path]);
    const opt = ([l, u]) => `<option value="${esc(u)}" data-label="${esc(l)}">${esc(l)} — ${esc(decodeURI(u))}</option>`;

    view.innerHTML = `
      <div class="page-head"><h1>Header menu<span id="dirty-dot" class="dirty-dot" title="Unsaved changes" hidden></span></h1>
        <span class="spacer"></span><a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener" id="menu-view-site">View site ↗</a></div>
      <div class="menu-layout">
        <div class="card">
          <div class="card-head">Menu items <span class="pill" id="menu-count"></span></div>
          <div class="card-body">
            <ul class="menu-list" id="menu-list"></ul>
            <p class="hint">Drag the handle to reorder, or use the arrows. The same menu is shown on desktop and in the mobile menu.</p>
          </div>
        </div>
        <div class="card">
          <div class="card-head">Add items</div>
          <div class="card-body">
            <label class="field"><span>Add a page</span>
              <select id="menu-pick"><option value="">Choose a page…</option>
                <optgroup label="General">${[['Home', '/'], ['Blog', '/category/blog/']].map(opt).join('')}</optgroup>
                ${myPages.length ? `<optgroup label="Pages you created">${myPages.map(opt).join('')}</optgroup>` : ''}
                ${sitePages.length ? `<optgroup label="Original site pages">${sitePages.map(opt).join('')}</optgroup>` : ''}
              </select></label>
            <button type="button" class="btn btn-sm" id="menu-add-page">Add to menu</button>
            <div class="divider"></div>
            <label class="field"><span>Link text</span><input id="menu-new-label" placeholder="e.g. Contact"></label>
            <label class="field"><span>URL <small>/page/, /#section or https://…</small></span><input id="menu-new-url" class="mono" placeholder="/contact-us/"></label>
            <button type="button" class="btn btn-sm" id="menu-add-link">Add custom link</button>
          </div>
        </div>
      </div>
      <div class="save-bar" style="max-width:1100px"><span class="muted">The menu is updated on every page of the site when you save.</span><button type="button" class="btn btn-primary" id="menu-save">Save menu</button></div>`;

    let dragIdx = null;
    function draw() {
      $('#menu-count').textContent = items.length;
      $('#menu-list').innerHTML = items.length ? items.map((it, i) => `
        <li class="menu-row" draggable="false" data-i="${i}">
          <span class="grip" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>
          <input class="input" data-mi="${i}" data-mf="label" value="${esc(it.label)}" aria-label="Link text">
          <input class="input mono" data-mi="${i}" data-mf="url" value="${esc(it.url)}" aria-label="URL">
          <label class="check nowrap"><input type="checkbox" data-mi="${i}" data-mf="newTab" ${it.newTab ? 'checked' : ''}> New tab</label>
          <span class="row-btns">
            <button type="button" class="icon-sm" data-mup="${i}" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">↑</button>
            <button type="button" class="icon-sm" data-mdown="${i}" ${i === items.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">↓</button>
            <button type="button" class="icon-sm danger" data-mdel="${i}" title="Remove" aria-label="Remove">×</button>
          </span>
        </li>`).join('') : '<li class="empty" style="padding:30px">The menu is empty. Add items on the right.</li>';
    }
    const move = (from, to) => { if (to < 0 || to >= items.length || from === to) return; const [x] = items.splice(from, 1); items.splice(to, 0, x); draw(); setDirty(true); };
    const add = (label, url) => {
      if (!label || !url) return toast('Enter both the link text and the URL.', 'err');
      items.push({ label, url, newTab: false }); draw(); setDirty(true);
      toast(`“${esc(label)}” added – remember to save.`, 'ok', 2500);
    };

    view.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.mup !== undefined) move(+t.dataset.mup, +t.dataset.mup - 1);
      if (t.dataset.mdown !== undefined) move(+t.dataset.mdown, +t.dataset.mdown + 1);
      if (t.dataset.mdel !== undefined) { items.splice(+t.dataset.mdel, 1); draw(); setDirty(true); }
      if (t.id === 'menu-add-page') {
        const o = $('#menu-pick').selectedOptions[0];
        if (!o || !o.value) return toast('Choose a page first.', 'err');
        add(o.dataset.label, o.value);
        $('#menu-pick').value = '';
      }
      if (t.id === 'menu-add-link') {
        add($('#menu-new-label').value.trim(), $('#menu-new-url').value.trim());
        $('#menu-new-label').value = ''; $('#menu-new-url').value = '';
      }
      if (t.id === 'menu-save') {
        if (items.some((i) => !i.label.trim() || !i.url.trim())) return toast('Every menu item needs link text and a URL.', 'err');
        busy(t, true, ' Saving…');
        try {
          const r = await api('/menu', { method: 'PUT', body: { items } });
          items = r.items.map((i) => ({ ...i }));
          draw(); setDirty(false);
          toast(`Menu saved and updated on ${r.files} static page${r.files === 1 ? '' : 's'}.${buildNote(r.build)}`);
        } catch (ex) { toast(esc(ex.message), 'err'); }
        busy(t, false);
      }
    });
    view.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.mi === undefined) return;
      items[+el.dataset.mi][el.dataset.mf] = el.type === 'checkbox' ? el.checked : el.value;
      setDirty(true);
    });
    const list = $('#menu-list');
    list.addEventListener('mousedown', (e) => { const g = e.target.closest('.grip'); if (g) g.closest('.menu-row').draggable = true; });
    list.addEventListener('mouseup', () => $$('.menu-row', list).forEach((r) => { r.draggable = false; }));
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('.menu-row'); if (!li) return; dragIdx = +li.dataset.i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    list.addEventListener('dragend', () => { dragIdx = null; $$('.menu-row', list).forEach((r) => { r.draggable = false; r.classList.remove('dragging', 'drop-target'); }); });
    list.addEventListener('dragover', (e) => {
      const li = e.target.closest('.menu-row'); if (!li || dragIdx === null) return;
      e.preventDefault();
      $$('.menu-row', list).forEach((r) => r.classList.toggle('drop-target', r === li));
    });
    list.addEventListener('drop', (e) => { const li = e.target.closest('.menu-row'); if (!li || dragIdx === null) return; e.preventDefault(); move(dragIdx, +li.dataset.i); });
    document.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#menu-save').click(); } };
    draw();
  }

  /* =========================================================
     SEO SETTINGS
     ========================================================= */
  async function renderSeoSettings(arg) {
    const [data, posts, terms] = await Promise.all([api('/seo'), api('/posts'), api('/terms')]);
    let s = data.settings;
    let redirects = s.redirects.map((r) => ({ ...r }));
    const TABS = [
      ['general', 'Titles & Meta'], ['social', 'Social & Schema'], ['indexing', 'Indexing & Sitemap'], ['webmaster', 'Webmaster Tools'],
      ['robots', 'robots.txt'], ['redirects', 'Redirects'], ['pages', 'Static Pages'], ['terms', 'Categories & Tags'],
    ];
    const FORM_TABS = ['general', 'social', 'indexing', 'webmaster', 'robots', 'redirects'];
    let tab = TABS.some(([k]) => k === arg) ? arg : 'general';

    const val = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), s);
    const fid = (k) => `seo-${k.replace(/\./g, '-')}`;
    const lbl = (label, hint) => `<span>${label}${hint ? ` <small>${hint}</small>` : ''}</span>`;
    const text = (k, label, hint = '', ph = '') => `<label class="field">${lbl(label, hint)}<input id="${fid(k)}" data-k="${k}" value="${esc(val(k))}" placeholder="${esc(ph)}"></label>`;
    const area = (k, label, hint = '', ph = '', rows = 4, cls = '') => `<label class="field">${lbl(label, hint)}<textarea id="${fid(k)}" data-k="${k}" rows="${rows}" class="${cls}" placeholder="${esc(ph)}">${esc(val(k))}</textarea></label>`;
    const image = (k, label, hint = '') => `<div class="field">${lbl(label, hint)}${imgField(fid(k), val(k) || '', '', `data-k="${k}"`)}</div>`;
    const select = (k, label, opts, hint = '') => `<label class="field">${lbl(label, hint)}<select id="${fid(k)}" data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${val(k) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const toggle = (k, label, hint = '') => `<label class="toggle" for="${fid(k)}"><input type="checkbox" id="${fid(k)}" data-k="${k}" ${val(k) ? 'checked' : ''}><span class="tg" aria-hidden="true"></span><span class="tg-text"><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    const card = (title, body, extra = '') => `<div class="card"><div class="card-head">${title}${extra}</div><div class="card-body">${body}</div></div>`;
    const SEPS = ['-', '–', '—', '|', '·', '•', '»', '~', '/'];

    view.innerHTML = `
      <div class="page-head"><h1>SEO<span id="dirty-dot" class="dirty-dot" title="Unsaved changes" hidden></span></h1>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/sitemap.xml" target="_blank" rel="noopener" id="view-sitemap">Sitemap ↗</a>
        <a class="btn btn-ghost btn-sm" href="/robots.txt" target="_blank" rel="noopener" id="view-robots">robots.txt ↗</a>
      </div>
      <div class="seo-layout">
        <nav class="seo-nav" id="seo-nav">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" id="seo-tab-${k}">${l}</button>`).join('')}</nav>
        <div class="seo-panes">
          <section class="seo-pane form-pane" data-pane="general">
            ${card('Title templates', `
              <div class="field"><span>Separator</span>
                <div class="sep-row">${SEPS.map((c) => `<button type="button" class="sep-btn" data-sep="${esc(c)}">${esc(c)}</button>`).join('')}
                  <input id="seo-separator" data-k="separator" class="input sep-input" value="${esc(s.separator)}" maxlength="5" aria-label="Custom separator"></div></div>
              ${text('postTitle', 'Blog posts', 'used when a post has no custom SEO title')}<div class="tpl-preview" data-tpl="postTitle"></div>
              ${text('pageTitle', 'Pages', 'pages created in the admin')}<div class="tpl-preview" data-tpl="pageTitle"></div>
              ${text('archiveTitle', 'Category, tag &amp; author archives')}<div class="tpl-preview" data-tpl="archiveTitle"></div>
              ${text('pagedTitle', 'Paginated archives', 'page 2 and beyond')}<div class="tpl-preview" data-tpl="pagedTitle"></div>
              <p class="hint">Variables: <code>%title%</code> post title · <code>%term%</code> category / tag / author · <code>%page%</code> <code>%pages%</code> page numbers · <code>%sep%</code> separator · <code>%sitename%</code> ${esc(state.siteName)}</p>`)}
            ${card('Defaults', `
              ${image('defaultOgImage', 'Default share image', 'used when a post has no featured image · 1200×630')}
              ${select('articleSchema', 'Default article schema', [['BlogPosting', 'Blog Post'], ['Article', 'Article'], ['NewsArticle', 'News Article'], ['none', 'None']], 'posts can override this')}`)}
          </section>

          <section class="seo-pane form-pane" data-pane="social" hidden>
            ${card('Knowledge Graph &amp; Schema', `
              ${select('schemaType', 'This website represents', [['Organization', 'An organisation / business'], ['Person', 'A person']])}
              ${text('orgName', 'Name', 'shown in Google knowledge panel')}
              ${image('orgLogo', 'Logo', 'square, at least 112×112')}
              <label class="field">${lbl('Social profiles', 'one URL per line – Facebook, Instagram, YouTube, LinkedIn…')}<textarea id="seo-sameAs" rows="4" placeholder="https://facebook.com/yourpage">${esc((s.sameAs || []).join('\n'))}</textarea></label>`)}
            ${card('Social accounts', `
              ${text('facebookUrl', 'Facebook page URL', 'added as article:publisher', 'https://facebook.com/yourpage')}
              ${text('twitterSite', 'Twitter / X username', 'added as twitter:site', '@yourhandle')}`)}
          </section>

          <section class="seo-pane form-pane" data-pane="indexing" hidden>
            ${card('Search engine indexing', `
              ${toggle('index.categories', 'Index category archives', '/category/…')}
              ${toggle('index.tags', 'Index tag archives', '/tag/… – turn off if tags create thin pages')}
              ${toggle('index.authors', 'Index author archives', '/author/…')}
              ${toggle('index.paginated', 'Index paginated archive pages', '…/page/2/ and beyond')}
              <p class="hint">Single posts can be set to <b>No Index</b> in the post editor (SEO → Advanced). Single categories and tags can be set in <a href="#/seo/terms" data-tab="terms">Categories &amp; Tags</a>.</p>`)}
            ${card('XML sitemap', `
              ${toggle('sitemap.posts', 'Include blog posts')}
              ${toggle('sitemap.pages', 'Include static pages')}
              ${toggle('sitemap.categories', 'Include categories')}
              ${toggle('sitemap.tags', 'Include tags')}
              ${toggle('sitemap.authors', 'Include author archives')}
              <p class="hint">Anything set to noindex, or with a canonical pointing elsewhere, is left out automatically. Sitemap: <a href="/sitemap.xml" target="_blank" rel="noopener">${esc(data.siteUrl)}/sitemap.xml</a> – submit it in Google Search Console.</p>`)}
            ${card('RSS feed', `${toggle('rss', 'Enable RSS feed', 'latest 20 posts at /feed/')}<p class="hint"><a href="/feed/" target="_blank" rel="noopener">View feed ↗</a></p>`)}
          </section>

          <section class="seo-pane form-pane" data-pane="webmaster" hidden>
            ${card('Site verification', `
              <p class="hint" style="margin-top:0">Paste the verification code – or the whole <code>&lt;meta&gt;</code> tag, the code is extracted automatically.</p>
              ${text('verification.google', 'Google Search Console', '<a href="https://search.google.com/search-console" target="_blank" rel="noopener">open ↗</a>')}
              ${text('verification.bing', 'Bing Webmaster Tools', '<a href="https://www.bing.com/webmasters" target="_blank" rel="noopener">open ↗</a>')}
              ${text('verification.yandex', 'Yandex Webmaster')}
              ${text('verification.pinterest', 'Pinterest')}
              ${text('verification.baidu', 'Baidu Webmaster')}`)}
            ${card('Custom &lt;head&gt; code', area('headCode', 'Added to the &lt;head&gt; of every page', 'analytics, pixels, extra meta tags', '<!-- e.g. Google Analytics, Meta Pixel -->', 8, 'mono'))}
          </section>

          <section class="seo-pane form-pane" data-pane="robots" hidden>
            ${card('robots.txt', `
              ${area('robotsTxt', 'Content', 'leave empty to use the default shown in grey', data.defaultRobotsTxt, 12, 'mono')}
              <div class="form-actions" style="justify-content:flex-start">
                <button type="button" class="btn btn-sm" id="robots-load-default">Start from default</button>
                <button type="button" class="btn btn-sm" id="robots-clear">Use default</button>
              </div>
              <p class="hint">A <code>Sitemap:</code> line is added automatically if you don't include one.</p>`)}
          </section>

          <section class="seo-pane form-pane" data-pane="redirects" hidden>
            ${card('Redirects', `
              <div class="redir-add">
                <input class="input" id="redir-from" placeholder="/old-url/">
                <span class="muted">→</span>
                <input class="input" id="redir-to" placeholder="/new-url/ or https://…">
                <select class="input" id="redir-type"><option value="301">301 Permanent</option><option value="302">302 Temporary</option></select>
                <button type="button" class="btn btn-sm btn-primary" id="redir-add">Add</button>
              </div>
              <input class="input" id="redir-search" placeholder="Filter redirects…" style="margin:12px 0">
              <div class="table-wrap"><table class="posts compact"><thead><tr><th>From</th><th>To</th><th>Type</th><th></th></tr></thead><tbody id="redir-body"></tbody></table></div>
              <p class="hint">Redirects are created automatically when you change the URL of a published post. Remember to <b>Save changes</b> after editing.</p>`,
              ' <span class="pill" id="redir-count"></span>')}
          </section>

          <section class="seo-pane" data-pane="pages" hidden>
            ${card('Static pages', `
              <p class="hint" style="margin-top:0">Edit the SEO title, description, social tags and indexing of pages that aren't blog posts (home page, landing pages…). Empty fields keep the original value.</p>
              <input class="input" id="pages-search" placeholder="Search pages by URL or title…" style="margin-bottom:12px">
              <div class="table-wrap"><table class="posts compact"><thead><tr><th>Page</th><th>Meta description</th><th></th><th></th></tr></thead><tbody id="pages-body"><tr><td colspan="4"><div class="empty">Loading…</div></td></tr></tbody></table></div>`,
              ' <span class="pill" id="pages-count"></span>')}
          </section>

          <section class="seo-pane" data-pane="terms" hidden>
            ${card('Categories &amp; tags', `
              <div class="toolbar"><div class="tabs" id="term-tabs"></div><label class="search"><input class="input" id="terms-search" type="search" placeholder="Search…"></label></div>
              <div class="table-wrap"><table class="posts compact"><thead><tr><th>Name</th><th>SEO</th><th>Posts</th><th></th></tr></thead><tbody id="terms-body"></tbody></table></div>`)}
          </section>

          <div class="save-bar" id="seo-save-bar">
            <span class="muted">Settings apply to every page of the site when saved.</span>
            <button type="button" class="btn btn-primary" id="seo-save">Save changes</button>
          </div>
        </div>
      </div>`;

    /* --- tabs --- */
    function showTab(t) {
      tab = t;
      $$('#seo-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
      $$('.seo-pane', view).forEach((p) => { p.hidden = p.dataset.pane !== t; });
      $('#seo-save-bar').hidden = !FORM_TABS.includes(t);
      history.replaceState(null, '', `#/seo/${t}`);
      state.lastHash = location.hash;
      if (t === 'pages' && !pages) loadPages();
      if (t === 'terms') drawTerms();
    }

    /* --- title template previews --- */
    function drawPreviews() {
      const sep = $('#seo-separator').value || '-';
      $$('[data-tpl]', view).forEach((el) => {
        el.innerHTML = `Preview: <strong>${esc(applyTpl($(`#${fid(el.dataset.tpl)}`).value, { separator: sep }, { title: 'Example Post Title', term: 'Blog', page: 2, pages: 5 }))}</strong>`;
      });
      $$('.sep-btn', view).forEach((b) => b.classList.toggle('active', b.dataset.sep === sep));
    }

    /* --- redirects --- */
    let redirQ = '';
    function drawRedirects() {
      $('#redir-count').textContent = redirects.length;
      const q = redirQ.toLowerCase();
      const rows = redirects.map((r, i) => [r, i]).filter(([r]) => !q || `${r.from} ${r.to}`.toLowerCase().includes(q));
      $('#redir-body').innerHTML = rows.length ? rows.map(([r, i]) => `<tr>
          <td><input class="input" data-ri="${i}" data-rf="from" value="${esc(r.from)}" aria-label="From"></td>
          <td><input class="input" data-ri="${i}" data-rf="to" value="${esc(r.to)}" aria-label="To"></td>
          <td><select class="input" data-ri="${i}" data-rf="type" aria-label="Type"><option value="301" ${+r.type !== 302 ? 'selected' : ''}>301</option><option value="302" ${+r.type === 302 ? 'selected' : ''}>302</option></select></td>
          <td class="nowrap"><a href="${esc(r.from)}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost">Test</a><button type="button" class="btn btn-sm btn-ghost btn-danger" data-rdel="${i}">Delete</button></td>
        </tr>`).join('') : `<tr><td colspan="4"><div class="empty" style="padding:30px">${redirects.length ? 'No matches.' : 'No redirects yet.'}</div></td></tr>`;
    }
    function addRedirect() {
      const from = $('#redir-from').value.trim(), to = $('#redir-to').value.trim();
      if (!from || !to) return toast('Enter both the old and the new URL.', 'err');
      if (redirects.some((r) => r.from === from)) return toast('A redirect from that URL already exists.', 'err');
      redirects.unshift({ from, to, type: +$('#redir-type').value });
      $('#redir-from').value = ''; $('#redir-to').value = '';
      drawRedirects(); setDirty(true);
    }

    /* --- gather + save --- */
    function gather() {
      const out = JSON.parse(JSON.stringify(s));
      $$('[data-k]', view).forEach((el) => {
        const keys = el.dataset.k.split('.');
        let o = out;
        while (keys.length > 1) { const k = keys.shift(); o = o[k] = o[k] || {}; }
        o[keys[0]] = el.type === 'checkbox' ? el.checked : el.value;
      });
      out.sameAs = $('#seo-sameAs').value.split('\n').map((x) => x.trim()).filter(Boolean);
      Object.keys(out.verification).forEach((k) => { out.verification[k] = verifyValue(out.verification[k]); });
      out.redirects = redirects;
      return out;
    }
    async function saveAll(btn) {
      const body = gather();
      const bad = body.sameAs.find((u) => !/^https?:\/\//i.test(u));
      if (bad) return toast(`Social profile must be a full URL: ${esc(bad)}`, 'err');
      busy(btn, true, ' Saving…');
      try {
        const r = await api('/seo', { method: 'PUT', body });
        s = r.settings;
        redirects = s.redirects.map((x) => ({ ...x }));
        Object.entries(s.verification).forEach(([k, v]) => { $(`#${fid(`verification.${k}`)}`).value = v; });
        drawRedirects();
        setDirty(false);
        toast(`SEO settings saved.${buildNote(r.build)}${r.staticUpdated ? ` ${r.staticUpdated} static pages updated.` : ''}`);
      } catch (ex) { toast(esc(ex.message), 'err'); }
      busy(btn, false);
    }

    /* --- static pages --- */
    let pages = null, pageQ = '', editingPage = null;
    const PAGE_FIELDS = ['title', 'description', 'canonical', 'ogTitle', 'ogDescription', 'ogImage'];
    async function loadPages() {
      try { pages = await api('/seo/pages'); drawPages(); }
      catch (ex) { $('#pages-body').innerHTML = `<tr><td colspan="4"><div class="empty">${esc(ex.message)}</div></td></tr>`; }
    }
    function pageForm(p) {
      const o = p.override || {}, base = o.orig || p;
      const f = (k, label, isArea) => isArea
        ? `<label class="field"><span>${label}</span><textarea id="pg-${k}" rows="2" placeholder="${esc(base[k] || '')}">${esc(o[k] || '')}</textarea></label>`
        : `<label class="field"><span>${label}</span><input id="pg-${k}" value="${esc(o[k] || '')}" placeholder="${esc(base[k] || '')}"></label>`;
      const noindex = 'noindex' in o ? o.noindex : /noindex/i.test(p.robots || '');
      return `<div class="inline-form">
        <div class="form-grid">
          ${f('title', 'SEO title')}${f('canonical', 'Canonical URL')}
          ${f('description', 'Meta description', true)}${f('ogDescription', 'Social description', true)}
          ${f('ogTitle', 'Social title')}<div class="field"><span>Social image</span>${imgField('pg-ogImage', o.ogImage || '', base.ogImage || '')}</div>
        </div>
        <div class="check-row"><label class="check"><input type="checkbox" id="pg-noindex" ${noindex ? 'checked' : ''}> No Index</label><label class="check"><input type="checkbox" id="pg-nofollow" ${o.nofollow ? 'checked' : ''}> No Follow</label></div>
        <div class="form-actions"><button type="button" class="btn btn-sm" data-pcancel>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-psave="${esc(p.path)}">Save page SEO</button></div>
      </div>`;
    }
    function drawPages() {
      if (!pages) return;
      const q = pageQ.toLowerCase();
      const list = pages.filter((p) => !q || p.path.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
      const shown = list.slice(0, 100);
      $('#pages-count').textContent = `${list.length}`;
      $('#pages-body').innerHTML = shown.length ? shown.map((p) => {
        const o = p.override || {};
        const custom = PAGE_FIELDS.some((f) => o[f]) || o.noindex || o.nofollow;
        const noidx = /noindex/i.test(p.robots || '');
        const dl = (p.description || '').length;
        const open = editingPage === p.path;
        return `<tr class="${open ? 'open' : ''}">
          <td><a href="${esc(p.path)}" target="_blank" rel="noopener" class="mono">${esc(decodeURI(p.path))}</a><div class="row-sub">${esc(p.title) || '<span class="muted">No title</span>'}</div></td>
          <td class="desc-cell">${p.description ? `${esc(p.description)} <small class="${dl > 160 || dl < 70 ? 'warn-t' : 'muted'}">(${dl})</small>` : '<span class="pill warn">missing</span>'}</td>
          <td class="nowrap">${custom ? '<span class="pill accent">Edited</span>' : ''}${noidx ? '<span class="pill warn">noindex</span>' : ''}</td>
          <td class="nowrap"><button type="button" class="btn btn-sm" data-pedit="${esc(p.path)}">${open ? 'Close' : 'Edit'}</button></td>
        </tr>${open ? `<tr class="edit-row"><td colspan="4">${pageForm(p)}</td></tr>` : ''}`;
      }).join('') + (list.length > 100 ? `<tr><td colspan="4" class="muted">Showing 100 of ${list.length} – use search to narrow down.</td></tr>` : '')
        : '<tr><td colspan="4"><div class="empty">No pages found.</div></td></tr>';
    }
    async function savePage(path, btn) {
      const body = { path, noindex: $('#pg-noindex').checked, nofollow: $('#pg-nofollow').checked };
      PAGE_FIELDS.forEach((f) => { body[f] = $(`#pg-${f}`).value.trim(); });
      busy(btn, true);
      try {
        const r = await api('/seo/pages', { method: 'PUT', body });
        editingPage = null;
        toast(`Page SEO saved.${buildNote(r.build)}`);
        await loadPages();
      } catch (ex) { toast(esc(ex.message), 'err'); busy(btn, false); }
    }

    /* --- categories / tags / authors --- */
    let termType = 'categories', termQ = '', editingTerm = null;
    const TERM_LABEL = { categories: 'Categories', tags: 'Tags', authors: 'Authors' };
    const TERM_BASE = { categories: 'category', tags: 'tag', authors: 'author' };
    const counts = { categories: {}, tags: {}, authors: {} };
    posts.filter((p) => p.status === 'publish').forEach((p) => {
      (p.categories || []).forEach((c) => { counts.categories[c] = (counts.categories[c] || 0) + 1; });
      (p.tags || []).forEach((t) => { counts.tags[t] = (counts.tags[t] || 0) + 1; });
      if (p.author) counts.authors[p.author] = (counts.authors[p.author] || 0) + 1;
    });
    function drawTerms() {
      $('#term-tabs').innerHTML = Object.keys(TERM_LABEL).map((k) => `<button type="button" data-ttype="${k}" class="${termType === k ? 'active' : ''}" id="ttab-${k}">${TERM_LABEL[k]}<span class="count">${Object.keys(terms[k] || {}).length}</span></button>`).join('');
      const q = termQ.toLowerCase();
      const list = Object.entries(terms[termType] || {}).filter(([slug, name]) => !q || slug.includes(q) || name.toLowerCase().includes(q))
        .sort((a, b) => (counts[termType][b[0]] || 0) - (counts[termType][a[0]] || 0) || a[1].localeCompare(b[1]));
      const globalOff = s.index[termType] === false;
      $('#terms-body').innerHTML = (globalOff ? `<tr><td colspan="4"><div class="notice">All ${TERM_LABEL[termType].toLowerCase()} are set to <b>noindex</b> in <a href="#/seo/indexing" data-tab="indexing">Indexing &amp; Sitemap</a>.</div></td></tr>` : '')
        + (list.length ? list.map(([slug, name]) => {
          const key = `${termType}:${slug}`;
          const t = s.terms[key] || {};
          const n = counts[termType][slug] || 0;
          const open = editingTerm === key;
          const url = `/${TERM_BASE[termType]}/${slug}/`;
          return `<tr class="${open ? 'open' : ''}">
            <td><strong>${esc(name)}</strong><div class="row-sub">${n ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="mono">${esc(url)}</a>` : `<span class="mono muted">${esc(url)}</span>`}</div></td>
            <td class="nowrap">${t.title ? '<span class="pill accent">Title</span>' : ''}${t.description ? '<span class="pill accent">Description</span>' : ''}${t.noindex ? '<span class="pill warn">noindex</span>' : ''}${!t.title && !t.description && !t.noindex ? '<span class="muted">Default</span>' : ''}</td>
            <td>${n}</td>
            <td class="nowrap"><button type="button" class="btn btn-sm" data-tedit="${esc(key)}">${open ? 'Close' : 'Edit'}</button></td>
          </tr>${open ? `<tr class="edit-row"><td colspan="4"><div class="inline-form">
            <div class="form-grid">
              <label class="field"><span>Name</span><input id="tm-name" value="${esc(name)}"></label>
              <label class="field"><span>SEO title</span><input id="tm-title" value="${esc(t.title || '')}" placeholder="${esc(applyTpl(s.archiveTitle, s, { term: name }))}"></label>
            </div>
            <label class="field"><span>Meta description <small id="tm-desc-count"></small></span><textarea id="tm-desc" rows="2" placeholder="Posts in ${esc(name)}.">${esc(t.description || '')}</textarea></label>
            <div class="check-row"><label class="check"><input type="checkbox" id="tm-noindex" ${t.noindex ? 'checked' : ''}> No Index – keep this archive out of Google and the sitemap</label></div>
            <div class="form-actions"><button type="button" class="btn btn-sm" data-tcancel>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-tsave="${esc(key)}">Save</button></div>
          </div></td></tr>` : ''}`;
        }).join('') : '<tr><td colspan="4"><div class="empty">Nothing found.</div></td></tr>');
    }
    async function saveTerm(key, btn) {
      const [type, ...rest] = key.split(':');
      const slug = rest.join(':');
      const body = { name: $('#tm-name').value.trim(), title: $('#tm-title').value.trim(), description: $('#tm-desc').value.trim(), noindex: $('#tm-noindex').checked };
      busy(btn, true);
      try {
        const r = await api(`/terms/${type}/${encodeURIComponent(slug)}`, { method: 'PUT', body });
        if (body.name) terms[type][slug] = body.name;
        s.terms[key] = { title: body.title, description: body.description, noindex: body.noindex };
        editingTerm = null;
        drawTerms();
        toast(`Saved.${buildNote(r.build)}`);
      } catch (ex) { toast(esc(ex.message), 'err'); busy(btn, false); }
    }

    /* --- events --- */
    wirePickers(view);
    view.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { e.preventDefault(); return showTab(t.dataset.tab); }
      const sep = e.target.closest('[data-sep]');
      if (sep) { $('#seo-separator').value = sep.dataset.sep; drawPreviews(); setDirty(true); return; }
      if (e.target.closest('#seo-save')) return saveAll(e.target.closest('#seo-save'));
      if (e.target.closest('#redir-add')) return addRedirect();
      const rdel = e.target.closest('[data-rdel]');
      if (rdel) { redirects.splice(+rdel.dataset.rdel, 1); drawRedirects(); setDirty(true); return; }
      if (e.target.closest('#robots-load-default')) { $('#seo-robotsTxt').value = data.defaultRobotsTxt; setDirty(true); return; }
      if (e.target.closest('#robots-clear')) { $('#seo-robotsTxt').value = ''; setDirty(true); return; }
      const pe = e.target.closest('[data-pedit]');
      if (pe) { editingPage = editingPage === pe.dataset.pedit ? null : pe.dataset.pedit; drawPages(); return; }
      if (e.target.closest('[data-pcancel]')) { editingPage = null; drawPages(); return; }
      const ps = e.target.closest('[data-psave]');
      if (ps) return savePage(ps.dataset.psave, ps);
      const tt = e.target.closest('[data-ttype]');
      if (tt) { termType = tt.dataset.ttype; editingTerm = null; drawTerms(); return; }
      const te = e.target.closest('[data-tedit]');
      if (te) { editingTerm = editingTerm === te.dataset.tedit ? null : te.dataset.tedit; drawTerms(); return; }
      if (e.target.closest('[data-tcancel]')) { editingTerm = null; drawTerms(); return; }
      const ts = e.target.closest('[data-tsave]');
      if (ts) return saveTerm(ts.dataset.tsave, ts);
    });
    view.addEventListener('input', (e) => {
      const el = e.target;
      if (el.closest('.form-pane') && !['redir-search', 'redir-from', 'redir-to'].includes(el.id)) setDirty(true);
      if (el.id === 'seo-separator' || /^seo-(post|page|archive|paged)Title$/.test(el.id)) drawPreviews();
      if (el.dataset.ri !== undefined) { const r = redirects[+el.dataset.ri]; r[el.dataset.rf] = el.dataset.rf === 'type' ? +el.value : el.value; }
      if (el.id === 'redir-search') { redirQ = el.value; drawRedirects(); }
      if (el.id === 'pages-search') { pageQ = el.value; drawPages(); }
      if (el.id === 'terms-search') { termQ = el.value; editingTerm = null; drawTerms(); }
      if (el.id === 'tm-desc') { const n = el.value.trim().length; $('#tm-desc-count').textContent = `${n} / 160`; $('#tm-desc-count').classList.toggle('over', n > 160); }
    });
    view.addEventListener('change', (e) => { if (e.target.closest('.form-pane') && e.target.matches('select, input[type=checkbox]')) setDirty(true); });
    view.addEventListener('focusout', (e) => { if (e.target.id && e.target.id.startsWith('seo-verification-')) e.target.value = verifyValue(e.target.value); });
    $('#redir-from').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#redir-to').focus(); } });
    $('#redir-to').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRedirect(); } });
    document.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && FORM_TABS.includes(tab)) { e.preventDefault(); const b = $('#seo-save'); if (!b.disabled) saveAll(b); }
    };

    drawPreviews();
    drawRedirects();
    showTab(tab);
  }

  /* =========================================================
     SOCIAL BAR
     ========================================================= */
  async function renderSocial() {
    const { settings } = await api('/social');
    let s = JSON.parse(JSON.stringify(settings));
    const NETS = [
      ['telegram', 'Telegram', 'https://t.me/yourchannel', '@yourchannel or full link'],
      ['instagram', 'Instagram', 'https://www.instagram.com/yourpage', '@yourpage or full link'],
      ['x', 'X (Twitter)', 'https://x.com/yourhandle', '@yourhandle or full link'],
      ['facebook', 'Facebook', 'https://www.facebook.com/yourpage', 'page name or full link'],
    ];
    const tg = (id, on, label, hint) => `<label class="toggle" for="${id}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="tg" aria-hidden="true"></span><span class="tg-text"><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ''}</span></label>`;

    view.innerHTML = `
      <div class="page-head"><h1>Social bar<span id="dirty-dot" class="dirty-dot" title="Unsaved changes" hidden></span></h1>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="social-save">Save changes</button>
      </div>
      <p class="hint" style="margin:-8px 0 16px">A floating bar with your social links, shown on every page of the site. Only networks with a link are shown.</p>
      <div class="settings-grid" style="max-width:1150px;grid-template-columns:minmax(0,1fr) minmax(320px,1fr)">
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="card"><div class="card-head">Display</div><div class="card-body">
            ${tg('social-enabled', s.enabled, 'Show social bar on the website')}
            <div class="field" style="margin-top:14px"><span>Position</span>
              <div class="tabs" id="social-pos">
                <button type="button" data-pos="left" id="social-pos-left" class="${s.position !== 'right' ? 'active' : ''}">Left side</button>
                <button type="button" data-pos="right" id="social-pos-right" class="${s.position === 'right' ? 'active' : ''}">Right side</button>
              </div></div>
            ${tg('social-mobile', s.mobile, 'Show on mobile', 'small icons near the bottom of the screen')}
          </div></div>
          <div class="card"><div class="card-head">Links</div><div class="card-body">
            ${NETS.map(([k, label, ph, hint]) => `<label class="field"><span>${label} <small>${hint}</small></span><input id="social-${k}" data-net="${k}" value="${esc(s.links[k] || '')}" placeholder="${ph}"></label>`).join('')}
            <p class="hint" style="margin:0">Saving also adds these profiles to your site's schema (Organization → sameAs), which helps Google and AI search link them to your brand.</p>
          </div></div>
        </div>
        <div class="card" style="position:sticky;top:20px"><div class="card-head">Live preview <span class="muted" style="font-weight:500;font-size:12.5px">hover the icons</span></div>
          <div class="card-body" style="padding:0">
            <iframe id="social-preview" title="Social bar preview" style="width:100%;height:380px;border:0;display:block;border-radius:0 0 12px 12px"></iframe>
          </div>
        </div>
      </div>`;

    const collect = () => ({
      enabled: $('#social-enabled').checked,
      mobile: $('#social-mobile').checked,
      position: s.position,
      links: Object.fromEntries(NETS.map(([k]) => [k, $(`#social-${k}`).value.trim()])),
    });
    const mock = (bar) => `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0f1220;color:#cfd3e0;min-height:100vh}
      .hd{height:54px;background:#161a2b;display:flex;align-items:center;padding:0 22px;gap:18px;font-weight:700;color:#fff}
      .hd i{width:46px;height:10px;border-radius:5px;background:#2a3050}.hd b{color:#ff9a1f}
      .ct{max-width:440px;margin:28px auto;padding:0 70px}.ln{height:10px;border-radius:5px;background:#232842;margin:12px 0}
      .hero{height:110px;border-radius:12px;background:linear-gradient(135deg,#ff6a00,#ff9a1f);opacity:.85;margin-bottom:18px}
      .empty{position:absolute;inset:0;display:grid;place-items:center;color:#8a92a3}</style></head>
      <body><div class="hd"><b>STARS777</b><i></i><i></i><i></i></div><div class="ct"><div class="hero"></div>
      <div class="ln"></div><div class="ln" style="width:80%"></div><div class="ln" style="width:90%"></div><div class="ln" style="width:60%"></div></div>
      ${bar || '<div class="empty">Add at least one link to see the bar</div>'}</body></html>`;
    let t;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try { const { html } = await api('/social/preview', { method: 'POST', body: collect() }); $('#social-preview').srcdoc = mock(html); } catch {}
      }, 250);
    };

    view.addEventListener('input', () => { setDirty(true); refresh(); });
    view.addEventListener('change', () => { setDirty(true); refresh(); });
    $('#social-pos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pos]');
      if (!b) return;
      s.position = b.dataset.pos;
      $$('#social-pos button').forEach((x) => x.classList.toggle('active', x === b));
      setDirty(true); refresh();
    });
    $('#social-save').onclick = async () => {
      const b = $('#social-save');
      busy(b, true, ' Saving…');
      try {
        const r = await api('/social', { method: 'PUT', body: collect() });
        s = r.settings;
        NETS.forEach(([k]) => { $(`#social-${k}`).value = s.links[k] || ''; }); // show normalised links
        setDirty(false);
        const n = Object.values(s.links).filter(Boolean).length;
        toast(!s.enabled ? 'Saved. The social bar is <b>hidden</b> on the site.' : n ? `Saved. Social bar updated on ${r.updated} pages.${buildNote(r.build)}` : 'Saved, but no links are set so nothing is shown.');
      } catch (ex) { toast(esc(ex.message), 'err'); }
      busy(b, false);
    };
    refresh();
  }

  /* =========================================================
     USERS
     ========================================================= */
  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = new Uint32Array(14);
    crypto.getRandomValues(a);
    return [...a].map((n) => chars[n % chars.length]).join('');
  };

  async function renderUsers() {
    let { users, me } = await api('/users');
    let resetting = null;

    view.innerHTML = `
      <div class="page-head"><h1>Users</h1></div>
      <p class="hint" style="margin:-8px 0 16px">Every user has full access to the admin panel (posts, pages, SEO, settings and users).</p>
      <div class="settings-grid" style="max-width:1100px;grid-template-columns:minmax(0,1.4fr) minmax(300px,1fr)">
        <div class="card">
          <div class="card-head">All users <span class="pill" id="users-count"></span></div>
          <table class="posts">
            <thead><tr><th>Username</th><th>Added</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody id="users-body"></tbody>
          </table>
        </div>
        <form class="card" id="user-add-form" autocomplete="off">
          <div class="card-head">Add new user</div>
          <div class="card-body">
            <label class="field"><span>Username <small>3–32 characters, lowercase</small></span>
              <input id="user-new-name" required minlength="3" maxlength="32" placeholder="e.g. niyon" autocomplete="off"></label>
            <label class="field"><span>Password <small>min. 8 characters</small></span>
              <div class="img-field"><input id="user-new-pw" type="text" required minlength="8" autocomplete="new-password">
              <button type="button" class="btn btn-sm" id="user-gen-pw">Generate</button></div></label>
            <p class="hint" style="margin:0 0 14px">Share the username and password with the person privately. They can change their password under Settings after logging in.</p>
            <button class="btn btn-primary" id="user-add-btn" type="submit">Add user</button>
          </div>
        </form>
      </div>`;

    const fmt = (d) => (d ? fmtDate(d) : '<span class="muted">—</span>');
    function draw() {
      $('#users-count').textContent = users.length;
      $('#users-body').innerHTML = users.map((u) => `
        <tr>
          <td><strong>${esc(u.username)}</strong>${u.username === me ? ' <span class="pill accent">you</span>' : ''}</td>
          <td class="date-cell">${fmt(u.created)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" data-ureset="${esc(u.username)}" id="user-reset-${esc(u.username)}">Reset password</button>
            ${u.username === me || users.length <= 1 ? '' : `<button class="btn btn-sm btn-danger" data-udel="${esc(u.username)}" id="user-del-${esc(u.username)}">Remove</button>`}
          </td>
        </tr>
        ${resetting === u.username ? `
        <tr><td colspan="3" style="background:#fafbfc">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span>New password for <strong>${esc(u.username)}</strong>:</span>
            <input class="input" id="user-reset-pw" type="text" minlength="8" style="max-width:220px" value="${genPassword()}">
            <button class="btn btn-primary btn-sm" data-usave="${esc(u.username)}" id="user-reset-save">Save password</button>
            <button class="btn btn-ghost btn-sm" data-ucancel id="user-reset-cancel">Cancel</button>
          </div>
        </td></tr>` : ''}`).join('');
    }

    $('#user-gen-pw').onclick = () => { $('#user-new-pw').value = genPassword(); };
    $('#user-new-name').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s+/g, ''); });

    $('#user-add-form').onsubmit = async (e) => {
      e.preventDefault();
      const b = $('#user-add-btn');
      const username = $('#user-new-name').value.trim();
      const password = $('#user-new-pw').value;
      busy(b, true, ' Adding…');
      try {
        users = (await api('/users', { method: 'POST', body: { username, password } })).users;
        draw();
        e.target.reset();
        toast(`User <b>${esc(username)}</b> added. Password: <code>${esc(password)}</code> – copy it now, it won't be shown again.`, 'ok', 12000);
      } catch (ex) { toast(esc(ex.message), 'err'); }
      busy(b, false);
    };

    view.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-ureset]');
      if (r) { resetting = resetting === r.dataset.ureset ? null : r.dataset.ureset; draw(); const i = $('#user-reset-pw'); if (i) i.select(); return; }
      if (e.target.closest('[data-ucancel]')) { resetting = null; draw(); return; }
      const s = e.target.closest('[data-usave]');
      if (s) {
        const pw = $('#user-reset-pw').value;
        if (pw.length < 8) return toast('Password must be at least 8 characters.', 'err');
        busy(s, true);
        try {
          await api(`/users/${encodeURIComponent(s.dataset.usave)}/password`, { method: 'PUT', body: { password: pw } });
          toast(`Password for <b>${esc(s.dataset.usave)}</b> changed to <code>${esc(pw)}</code> – copy it now.`, 'ok', 12000);
          resetting = null; draw();
        } catch (ex) { toast(esc(ex.message), 'err'); busy(s, false); }
        return;
      }
      const d = e.target.closest('[data-udel]');
      if (d) {
        if (!confirm(`Remove user "${d.dataset.udel}"? They will be logged out immediately.`)) return;
        try {
          users = (await api(`/users/${encodeURIComponent(d.dataset.udel)}`, { method: 'DELETE' })).users;
          draw();
          toast(`User <b>${esc(d.dataset.udel)}</b> removed.`);
        } catch (ex) { toast(esc(ex.message), 'err'); }
      }
    });
    draw();
  }

  /* =========================================================
     SETTINGS
     ========================================================= */
  async function renderSettings() {
    const posts = await api('/posts');
    view.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <div class="settings-grid">
        <form class="card" id="pw-form">
          <div class="card-head">Change password</div>
          <div class="card-body">
            <label class="field"><span>Current password</span><input type="password" id="pw-current" autocomplete="current-password" required></label>
            <label class="field"><span>New password <small>min. 8 characters</small></span><input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
            <label class="field"><span>Confirm new password</span><input type="password" id="pw-confirm" autocomplete="new-password" minlength="8" required></label>
            <button class="btn btn-primary" id="pw-save" type="submit">Update password</button>
          </div>
        </form>
        <div class="card">
          <div class="card-head">Site</div>
          <div class="card-body">
            <dl class="kv">
              <dt>Site URL</dt><dd>${esc(state.siteUrl)}</dd>
              <dt>Logged in as</dt><dd>${esc(state.me)}</dd>
              <dt>Published posts</dt><dd>${posts.filter((p) => p.status === 'publish').length}</dd>
              <dt>Drafts</dt><dd>${posts.filter((p) => p.status === 'draft').length}</dd>
            </dl>
            <p class="muted">The site is rebuilt automatically whenever you publish, update or delete a post. Use this if you changed files by hand.</p>
            <button class="btn" id="rebuild-btn">Rebuild site now</button>
          </div>
        </div>
      </div>`;

    $('#pw-form').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#pw-new').value !== $('#pw-confirm').value) return toast('New passwords do not match.', 'err');
      const b = $('#pw-save');
      busy(b, true);
      try {
        await api('/password', { method: 'POST', body: { current: $('#pw-current').value, next: $('#pw-new').value } });
        e.target.reset();
        toast('Password updated.');
      } catch (ex) { toast(esc(ex.message), 'err'); }
      busy(b, false);
    };
    $('#rebuild-btn').onclick = async (e) => {
      const b = e.currentTarget;
      busy(b, true, ' Rebuilding…');
      try { const r = await api('/rebuild', { method: 'POST' }); toast(`Rebuilt ${r.posts} posts and ${r.archivePages} archive pages in ${(r.ms / 1000).toFixed(1)}s.`); }
      catch (ex) { toast(esc(ex.message), 'err'); }
      busy(b, false);
    };
  }

  boot();
})();
