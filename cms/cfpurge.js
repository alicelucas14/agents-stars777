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
 * lifetime (Cloudflare-CDN-Cache-Control in server.js) runs out.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.CONTENT_DIR, 'cloudflare.json');
const API = (process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
const DEBOUNCE_MS = +(process.env.CF_PURGE_DEBOUNCE_MS || 3000);
const MIN_GAP_MS = +(process.env.CF_PURGE_MIN_GAP_MS || 15000);
// Cloudflare checks the token's IP filter against the address the call comes from. The server has
// both an IPv4 and an IPv6 address and Node prefers IPv6, so call over IPv4 – the address a token is
// normally limited to. CF_IP_FAMILY=0 lets the system choose, 6 forces IPv6.
const FAMILY = process.env.CF_IP_FAMILY === undefined ? 4 : +process.env.CF_IP_FAMILY;
const TIMEOUT_MS = 10000;

/** POST a JSON body. Resolves { status, json } (json is {} when the reply isn't JSON); rejects on network errors. */
function postJson(url, headers, body, family) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = (u.protocol === 'http:' ? http : https).request(u, {
      method: 'POST',
      ...(family ? { family } : {}),
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(text) || {}; } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json });
      });
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000} s`)));
    req.on('error', reject);
    req.end(data);
  });
}

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
  const url = `${API}/zones/${s.zoneId}/purge_cache`;
  const headers = { Authorization: `Bearer ${s.token}` };
  try {
    let res;
    try {
      res = await postJson(url, headers, body, FAMILY);
    } catch (e) {
      if (!FAMILY || !e.code) throw e; // a timeout isn't a routing problem – don't wait twice
      res = await postJson(url, headers, body, 0); // no route on that family (e.g. no IPv4): let the system pick
    }
    const j = res.json;
    if (res.status >= 200 && res.status < 300 && j.success !== false) {
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
