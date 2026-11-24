/**
 * Agent sign-ups from the registration forms on the static pages (home + /register/).
 *
 * The forms are Elementor forms from the old WordPress site. Their submit code
 * was a WordPress plugin script that no longer exists, so a small script is
 * injected right after each form (between <!--cms:signup--> markers) that sends
 * the fields to POST /api/signup. Without JavaScript the browser posts the form
 * to the page itself, which the server also accepts.
 *
 * Bot check (cms/turnstile.js, once it is set up): the script gets a Cloudflare Turnstile
 * token when someone starts filling in the form, and the server checks it before saving.
 *   - check passed            -> Sign-ups (content/signups.json)
 *   - Cloudflare says no      -> refused, the visitor is asked to try again
 *   - no check possible       -> Unverified (content/signups-unverified.json): no JavaScript, the
 *                                check was blocked, or Cloudflare didn't answer. Kept apart with its
 *                                own hourly ceiling, so a flood of bot sign-ups can neither push real
 *                                ones out of the list nor make the form refuse real visitors.
 * Without Turnstile everything goes to Sign-ups, as before.
 *
 * These files hold personal data – never commit them (signups.json, signups-unverified.json, signups-archive.jsonl).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const turnstile = require('./turnstile');
const { ipKey } = require('./net');

const FILE = path.join(cfg.CONTENT_DIR, 'signups.json');
const UNVERIFIED_FILE = path.join(cfg.CONTENT_DIR, 'signups-unverified.json');
const ARCHIVE_FILE = path.join(cfg.CONTENT_DIR, 'signups-archive.jsonl');
const MAX_KEPT = 10000;
const MAX_UNVERIFIED = 2000;
const THANKS = "Thank you! We've received your registration and will contact you shortly.";
const CHECK_FAILED = "The security check didn't pass – please try again. If it keeps happening, contact us on WhatsApp or Telegram.";
const BUSY = 'We are receiving a lot of registrations right now – please try again in a little while, or contact us on WhatsApp or Telegram.';

// Elementor field ids -> our names (both forms use the same ids)
const FIELDS = { name: 'name', email: 'email', field_db40f87: 'contactVia', field_d8582dc: 'contact', message: 'message', field_4e9e876: 'terms' };

/**
 * The live list is capped (every sign-up rewrites the whole file). The oldest ones past the cap move to
 * an archive file, one JSON object per line, instead of being deleted. If the archive can't be written
 * the list is left as it is – nothing is dropped.
 */
function capped(items) {
  if (items.length <= MAX_KEPT) return items;
  try {
    fs.appendFileSync(ARCHIVE_FILE, items.slice(MAX_KEPT).map((e) => JSON.stringify(e) + '\n').join(''), { mode: 0o600 });
    return items.slice(0, MAX_KEPT);
  } catch (e) {
    console.warn('Sign-ups: could not archive old entries (%s) – keeping them in the list', e.message);
    return items;
  }
}

const byDate = (a, b) => new Date(b.date) - new Date(a.date);
const read = (file) => {
  const items = store.readJson(file, []);
  return Array.isArray(items) ? items : [];
};
const list = () => read(FILE).sort(byDate);
const listUnverified = () => read(UNVERIFIED_FILE).sort(byDate);

function remove(id) {
  const items = list().filter((s) => s.id !== id);
  store.writeJson(FILE, items);
  return items;
}

function removeUnverified(id) {
  const items = listUnverified().filter((s) => s.id !== id);
  store.writeJson(UNVERIFIED_FILE, items);
  return items;
}

/** Delete the given unverified sign-ups (the ones the admin was looking at – not any that arrived since). */
function clearUnverified(ids) {
  const gone = new Set(Array.isArray(ids) ? ids.map(String) : []);
  const items = listUnverified().filter((s) => !gone.has(s.id));
  store.writeJson(UNVERIFIED_FILE, items);
  return items;
}

/** Move an unverified sign-up into Sign-ups (the admin decided it is a real person). Null if it's gone. */
function approve(id) {
  const waiting = listUnverified();
  const s = waiting.find((x) => x.id === id);
  if (!s) return null;
  const { why, ...entry } = s;
  // add first, then take it out of Unverified: an interruption leaves a duplicate, never a loss
  store.writeJson(FILE, capped([{ ...entry, approved: new Date().toISOString() }, ...list().filter((x) => x.id !== id)]));
  store.writeJson(UNVERIFIED_FILE, waiting.filter((x) => x.id !== id));
  return { items: list(), unverified: listUnverified() };
}

// only plain text counts: form fields like "name[toString]=1" arrive as objects, and String() of those can throw
const clip = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

/** Validate the posted form fields. Returns { entry } or { error }; { spam: true } for honeypot hits. */
function clean(fields = {}) {
  if (!fields || typeof fields !== 'object') return { error: 'Please fill in the form.' };
  if (clip(fields.company_url, 200)) return { spam: true }; // hidden field only bots fill in
  const f = {};
  for (const [id, name] of Object.entries(FIELDS)) f[name] = fields[id];
  const entry = {
    name: clip(f.name, 100),
    email: clip(f.email, 200).toLowerCase(),
    contactVia: clip(f.contactVia, 30),
    contact: clip(f.contact, 100),
    message: clip(f.message, 2000),
  };
  if (!entry.name) return { error: 'Please enter your name.' };
  if (!/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(entry.email)) return { error: 'Please enter a valid email address.' };
  if (!entry.contactVia) return { error: 'Please choose WhatsApp or Telegram.' };
  if (entry.contact.length < 3) return { error: 'Please enter your WhatsApp number or Telegram username.' };
  if (!f.terms) return { error: 'Please accept the terms of service.' };
  return { entry };
}

/**
 * Save a sign-up. meta = { page, ip, token } (token = the Turnstile answer from the page script).
 * Returns { entry, unverified }, { error[, limited | failed] } or { spam }.
 */
async function add(fields, meta = {}) {
  const r = clean(fields);
  if (!r.entry) return r;
  if (rateLimited(ipKey(meta.ip || ''))) return { error: 'Too many sign-ups from your connection – please try again in an hour.', limited: true };

  const check = await turnstile.verify(meta.token, meta.ip);
  if (check.result === 'failed') return { error: CHECK_FAILED, failed: true };
  const unverified = check.result === 'missing' || check.result === 'unavailable';
  if (unverified ? hourly.unverified.full() : hourly.verified.full()) return { error: BUSY, limited: true };

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    date: new Date().toISOString(),
    ...r.entry,
    page: clip(meta.page, 300),
    ip: clip(meta.ip, 64),
    ...(unverified ? { why: check.result } : {}),
  };
  // read + write without an await in between, so two sign-ups at once can't overwrite each other
  if (unverified) store.writeJson(UNVERIFIED_FILE, [entry, ...listUnverified()].slice(0, MAX_UNVERIFIED));
  else store.writeJson(FILE, capped([entry, ...list()]));
  return { entry, unverified };
}

/* ---------- site-wide ceilings: stop a flood from pushing real sign-ups out of the list ----------
 * Checked sign-ups (or all of them while Turnstile is off) and unverified ones are counted
 * separately, so bots that skip the check only ever fill up the Unverified list. */
function ceiling(max, label) {
  let times = [];
  let lastWarning = 0;
  return {
    full() {
      const now = Date.now();
      times = times.filter((t) => now - t < 3600e3);
      if (times.length >= max) {
        if (now - lastWarning > 600e3) {
          lastWarning = now;
          console.warn('Sign-ups: %d %s in the last hour – new ones are refused until it drops (spam flood?)', max, label);
        }
        return true;
      }
      times.push(now);
      return false;
    },
  };
}
const hourly = { verified: ceiling(100, 'sign-ups'), unverified: ceiling(30, 'unverified sign-ups') };

/* ---------- simple per-visitor limit: 5 sign-ups an hour (IPv6: per /64 network) ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 5) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
  return false;
}

/* ---------- script injected after the forms ----------
 * With a Turnstile site key it also adds the bot check. Cloudflare's script is only loaded when
 * someone starts filling in a form (most visitors never do, so the page stays as light as before);
 * the check usually finishes while they type and only shows a box if Cloudflare wants a click.
 * Tokens work once: after every send the check is reset for the next try. If no token arrives
 * within 15 s (blocked script, network trouble) the form is sent anyway and lands in Unverified. */
const script = (siteKey) => `(function(){
var OK=${JSON.stringify(THANKS)},ERR="Sorry, something went wrong. Please try again, or contact us on WhatsApp or Telegram.",TS=${JSON.stringify(siteKey || '')},tsLoad=null;
function note(f,ok,t){var o=f.querySelector(".elementor-message");if(o)o.parentNode.removeChild(o);var d=document.createElement("div");d.className="elementor-message elementor-message-"+(ok?"success":"danger");d.setAttribute("role","alert");d.textContent=t;f.appendChild(d);}
document.querySelectorAll("form.elementor-form").forEach(function(f){if(f.querySelector("[name='form_fields[company_url]']"))return;var h=document.createElement("input");h.type="text";h.name="form_fields[company_url]";h.tabIndex=-1;h.autocomplete="off";h.setAttribute("aria-hidden","true");h.style.cssText="position:absolute;left:-9999px;width:1px;height:1px;opacity:0";f.appendChild(h);});
function loadTs(){if(!tsLoad)tsLoad=new Promise(function(res){window.s7TsReady=function(){res(true);};var s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=s7TsReady";s.async=true;s.onerror=function(){res(false);};document.head.appendChild(s);});return tsLoad;}
function flush(st){var w=st.wait;st.wait=[];w.forEach(function(fn){fn(st.token);});}
function ts(f){if(f.s7ts)return f.s7ts;var st=f.s7ts={token:"",wait:[]};
loadTs().then(function(ok){if(!ok||!window.turnstile){st.dead=true;flush(st);return;}
var box=document.createElement("div");box.className="elementor-field-group elementor-column elementor-col-100 s7-turnstile";box.style.marginBottom="0";
var sub=f.querySelector(".e-form__buttons,.elementor-field-type-submit");if(sub)sub.parentNode.insertBefore(box,sub);else f.appendChild(box);
try{st.id=turnstile.render(box,{sitekey:TS,action:"signup",size:"flexible",appearance:"interaction-only",callback:function(t){st.token=t;flush(st);},"expired-callback":function(){st.token="";},"timeout-callback":function(){st.token="";}});}catch(x){st.dead=true;flush(st);}});
return st;}
function token(f){if(!TS)return Promise.resolve("");var st=ts(f);if(st.token||st.dead)return Promise.resolve(st.token);
return new Promise(function(res){st.wait.push(res);setTimeout(function(){var i=st.wait.indexOf(res);if(i>-1){st.wait.splice(i,1);res(st.token);}},15000);});}
function fresh(f){var st=f.s7ts;if(!st)return;st.token="";if(st.id!==undefined&&window.turnstile)try{turnstile.reset(st.id);}catch(x){}}
if(TS)["focusin","pointerdown"].forEach(function(n){document.addEventListener(n,function(e){var f=e.target&&e.target.closest&&e.target.closest("form.elementor-form");if(f)ts(f);},true);});
document.addEventListener("submit",function(e){
var f=e.target;if(!f||!f.matches||!f.matches("form.elementor-form"))return;
e.preventDefault();e.stopImmediatePropagation();if(f.getAttribute("data-sending"))return;
var data={};new FormData(f).forEach(function(v,k){var m=/^form_fields\\[(.+)\\]$/.exec(k);if(m)data[m[1]]=String(v);});
var b=f.querySelector("[type=submit]");f.setAttribute("data-sending","1");if(b)b.disabled=true;
token(f).then(function(t){return fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:data,page:location.pathname,token:t})});})
.then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});})
.then(function(x){if(x.ok){f.reset();note(f,true,x.j.message||OK);}else note(f,false,x.j.error||ERR);})
.catch(function(){note(f,false,ERR);})
.then(function(){fresh(f);f.removeAttribute("data-sending");if(b)b.disabled=false;});
},true);
var q=/[?&]registered=([01])/.exec(location.search),f0=document.querySelector("form.elementor-form");
if(q&&f0)note(f0,q[1]==="1",q[1]==="1"?OK:"Please fill in all the required fields and try again.");
})();`;

const block = (siteKey) => `<!--cms:signup--><script>${script(siteKey)}</script><!--/cms:signup-->`;
const RE = /<!--cms:signup-->[\s\S]*?<!--\/cms:signup-->/g;
const currentSiteKey = () => (turnstile.settings() || {}).siteKey || '';

/** Remove any old copy and insert the script right after the first Elementor form. */
function inject(html, siteKey = currentSiteKey()) {
  const out = String(html).replace(RE, '');
  const start = out.indexOf('class="elementor-form"');
  const end = start === -1 ? -1 : out.indexOf('</form>', start);
  if (end === -1) return out;
  const at = end + '</form>'.length;
  return `${out.slice(0, at)}${block(siteKey)}${out.slice(at)}`;
}

/** Apply to every static page (the forms only exist there). Returns number of files changed. */
function applyAll() {
  const siteKey = currentSiteKey();
  let changed = 0;
  for (const { file } of seo.staticPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('elementor-form') && !html.includes('<!--cms:signup-->')) continue;
    const out = inject(html, siteKey);
    if (out !== html) { store.writeText(file, out); changed++; }
  }
  return changed;
}

module.exports = { THANKS, list, listUnverified, add, remove, removeUnverified, clearUnverified, approve, inject, applyAll };
