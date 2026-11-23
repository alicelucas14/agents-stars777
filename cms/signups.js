/**
 * Agent sign-ups from the registration forms on the static pages (home + /register/).
 *
 * The forms are Elementor forms from the old WordPress site. Their submit code
 * was a WordPress plugin script that no longer exists, so a small script is
 * injected right after each form (between <!--cms:signup--> markers) that sends
 * the fields to POST /api/signup. Without JavaScript the browser posts the form
 * to the page itself, which the server also accepts.
 *
 * Sign-ups are stored in content/signups.json (personal data – never commit it).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const { ipKey } = require('./net');

const FILE = path.join(cfg.CONTENT_DIR, 'signups.json');
const MAX_KEPT = 10000;
const THANKS = "Thank you! We've received your registration and will contact you shortly.";

// Elementor field ids -> our names (both forms use the same ids)
const FIELDS = { name: 'name', email: 'email', field_db40f87: 'contactVia', field_d8582dc: 'contact', message: 'message', field_4e9e876: 'terms' };

const list = () => (store.readJson(FILE, []) || []).sort((a, b) => new Date(b.date) - new Date(a.date));

function remove(id) {
  const items = list().filter((s) => s.id !== id);
  store.writeJson(FILE, items);
  return items;
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

/** Save a sign-up. meta = { page, ip }. Returns { entry }, { error[, limited] } or { spam }. */
function add(fields, meta = {}) {
  const r = clean(fields);
  if (!r.entry) return r;
  if (rateLimited(ipKey(meta.ip || ''))) return { error: 'Too many sign-ups from your connection – please try again in an hour.', limited: true };
  if (siteBusy()) {
    if (Date.now() - lastBusyWarning > 600e3) {
      lastBusyWarning = Date.now();
      console.warn('Sign-ups: %d in the last hour – new ones are refused until it drops (spam flood?)', SITE_MAX_PER_HOUR);
    }
    return { error: 'We are receiving a lot of registrations right now – please try again in a little while, or contact us on WhatsApp or Telegram.', limited: true };
  }
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    date: new Date().toISOString(),
    ...r.entry,
    page: clip(meta.page, 300),
    ip: clip(meta.ip, 64),
  };
  store.writeJson(FILE, [entry, ...list()].slice(0, MAX_KEPT));
  return { entry };
}

/* ---------- site-wide ceiling: stops a flood from pushing real sign-ups out of the list ---------- */
const SITE_MAX_PER_HOUR = 100;
let siteHits = [];
let lastBusyWarning = 0;
function siteBusy() {
  const now = Date.now();
  siteHits = siteHits.filter((t) => now - t < 3600e3);
  if (siteHits.length >= SITE_MAX_PER_HOUR) return true;
  siteHits.push(now);
  return false;
}

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

/* ---------- script injected after the forms ---------- */
const JS = `(function(){
var OK=${JSON.stringify(THANKS)},ERR="Sorry, something went wrong. Please try again, or contact us on WhatsApp or Telegram.";
function note(f,ok,t){var o=f.querySelector(".elementor-message");if(o)o.parentNode.removeChild(o);var d=document.createElement("div");d.className="elementor-message elementor-message-"+(ok?"success":"danger");d.setAttribute("role","alert");d.textContent=t;f.appendChild(d);}
document.querySelectorAll("form.elementor-form").forEach(function(f){if(f.querySelector("[name='form_fields[company_url]']"))return;var h=document.createElement("input");h.type="text";h.name="form_fields[company_url]";h.tabIndex=-1;h.autocomplete="off";h.setAttribute("aria-hidden","true");h.style.cssText="position:absolute;left:-9999px;width:1px;height:1px;opacity:0";f.appendChild(h);});
document.addEventListener("submit",function(e){
var f=e.target;if(!f||!f.matches||!f.matches("form.elementor-form"))return;
e.preventDefault();e.stopImmediatePropagation();if(f.getAttribute("data-sending"))return;
var data={};new FormData(f).forEach(function(v,k){var m=/^form_fields\\[(.+)\\]$/.exec(k);if(m)data[m[1]]=String(v);});
var b=f.querySelector("[type=submit]");f.setAttribute("data-sending","1");if(b)b.disabled=true;
fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:data,page:location.pathname})})
.then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});})
.then(function(x){if(x.ok){f.reset();note(f,true,x.j.message||OK);}else note(f,false,x.j.error||ERR);})
.catch(function(){note(f,false,ERR);})
.then(function(){f.removeAttribute("data-sending");if(b)b.disabled=false;});
},true);
var q=/[?&]registered=([01])/.exec(location.search),f0=document.querySelector("form.elementor-form");
if(q&&f0)note(f0,q[1]==="1",q[1]==="1"?OK:"Please fill in all the required fields and try again.");
})();`;

const BLOCK = `<!--cms:signup--><script>${JS}</script><!--/cms:signup-->`;
const RE = /<!--cms:signup-->[\s\S]*?<!--\/cms:signup-->/g;

/** Remove any old copy and insert the script right after the first Elementor form. */
function inject(html) {
  const out = String(html).replace(RE, '');
  const start = out.indexOf('class="elementor-form"');
  const end = start === -1 ? -1 : out.indexOf('</form>', start);
  if (end === -1) return out;
  const at = end + '</form>'.length;
  return `${out.slice(0, at)}${BLOCK}${out.slice(at)}`;
}

/** Apply to every static page (the forms only exist there). Returns number of files changed. */
function applyAll() {
  let changed = 0;
  for (const { file } of seo.staticPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('elementor-form') && !html.includes('<!--cms:signup-->')) continue;
    const out = inject(html);
    if (out !== html) { fs.writeFileSync(file, out); changed++; }
  }
  return changed;
}

module.exports = { THANKS, list, add, remove, inject, applyAll };
