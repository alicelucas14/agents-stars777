/**
 * Clear Cloudflare's copy of this site after something changes, so visitors never wait for
 * a cached page to expire. Does nothing until it is given a zone id and an API token.
 *
 * Settings (either way works; the file is git-ignored and should be chmod 600):
 *   content/cloudflare.json   { "zoneId": "<32 hex>", "token": "<Cache Purge token>", "host": "agents.stars777.org" }
 *   env  CF_ZONE_ID, CF_PURGE_TOKEN      (override the file)
 *
 * "host" defaults to the site's own host and only that host's cache is cleared (other sites
 * in the same Cloudflare zone are untouched). Set "mode": "everything" in the file only if
 * Cloudflare refuses host purges on your plan – that clears the whole zone.
 *
 * Calls are batched: a burst of edits becomes one purge a few seconds later, and purges are
 * spaced out to stay under Cloudflare's rate limit. Failures are logged and never thrown, so
 * publishing is never blocked; a missed purge only means pages refresh when their cache
 * lifetime (s-maxage in server.js) runs out.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.CONTENT_DIR, 'cloudflare.json');
const API = (process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
const DEBOUNCE_MS = +(process.env.CF_PURGE_DEBOUNCE_MS || 3000);
const MIN_GAP_MS = +(process.env.CF_PURGE_MIN_GAP_MS || 15000);

/** Current settings, or null when not configured / invalid. Re-read each time so no restart is needed. */
function settings() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { /* no file yet */ }
  const zoneId = String(process.env.CF_ZONE_ID || f.zoneId || '').trim();
  const token = String(process.env.CF_PURGE_TOKEN || f.token || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(zoneId) || !token) return null;
  let host = String(f.host || '').trim();
  if (!host) { try { host = new URL(cfg.SITE_URL).host; } catch { return null; } }
  return { zoneId, token, host, mode: f.mode === 'everything' ? 'everything' : 'host' };
}

/** Purge right now. Resolves to { ok } / { skipped } / { ok:false, error } – never rejects. */
async function purgeNow(reason = 'manual') {
  const s = settings();
  if (!s) return { skipped: true };
  const body = s.mode === 'everything' ? { purge_everything: true } : { hosts: [s.host] };
  try {
    const res = await fetch(`${API}/zones/${s.zoneId}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.success !== false) {
      console.log(`Cloudflare cache cleared (${reason})`);
      return { ok: true };
    }
    const error = (j.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    console.warn(`Cloudflare cache clear failed (${reason}): ${error}`);
    return { ok: false, error };
  } catch (e) {
    console.warn(`Cloudflare cache clear failed (${reason}): ${e.message}`);
    return { ok: false, error: e.message };
  }
}

let timer = null;
let lastRun = 0;
const reasons = new Set();

/** Ask for a purge soon. Returns false (and does nothing) when Cloudflare isn't configured. */
function schedule(reason = 'change') {
  if (!settings()) return false;
  reasons.add(reason);
  if (timer) return true; // one is already queued – it will cover this change too
  const wait = Math.max(DEBOUNCE_MS, lastRun + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => {
    timer = null;
    const why = [...reasons].join(', ');
    reasons.clear();
    lastRun = Date.now();
    purgeNow(why);
  }, wait);
  timer.unref(); // never keeps the process alive
  return true;
}

module.exports = { schedule, purgeNow, settings };
