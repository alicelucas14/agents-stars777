/**
 * Cloudflare Turnstile – the "are you a person?" check on the agent sign-up form.
 * Off (sign-ups work exactly as before) until it has a site key and a secret key:
 *
 *   content/turnstile.json   { "siteKey": "0x4AAA…", "secret": "0x4AAA…" }   (git-ignored, chmod 600)
 *   env  TURNSTILE_SITEKEY, TURNSTILE_SECRET                                   (override the file)
 *
 * Optional "hostnames": ["agents.stars777.org"] (env TURNSTILE_HOSTNAMES, comma separated):
 * the pages a check may come from. Defaults to the site's own host.
 *
 * The browser gets a one-time token from Cloudflare; the server asks Cloudflare whether that
 * token is genuine (siteverify) before saving the sign-up. See cms/signups.js for what happens
 * with each answer.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.CONTENT_DIR, 'turnstile.json');
const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACTION = 'signup'; // the page script asks for a token for this action; any other token is refused
const TIMEOUT_MS = 10000;

function readFile() {
  if (!fs.existsSync(FILE)) return { f: {} };
  try { return { f: JSON.parse(fs.readFileSync(FILE, 'utf8')) || {} }; } catch (e) { return { f: {}, error: e.message }; }
}

/** { siteKey, secret, hostnames:Set } when set up, else null. Re-read each time, so no restart is needed for the secret. */
function settings() {
  const { f } = readFile();
  const siteKey = String(process.env.TURNSTILE_SITEKEY || f.siteKey || '').trim();
  const secret = String(process.env.TURNSTILE_SECRET || f.secret || '').trim();
  // the site key is written into the pages' script, so it must be plain key characters
  if (!/^[\w-]{10,100}$/.test(siteKey) || !secret) return null;
  let hosts = process.env.TURNSTILE_HOSTNAMES ? process.env.TURNSTILE_HOSTNAMES.split(',') : f.hostnames;
  if (!Array.isArray(hosts) || !hosts.length) { try { hosts = [new URL(cfg.SITE_URL).hostname]; } catch { hosts = []; } }
  const hostnames = new Set(hosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean));
  if (!hostnames.size) return null;
  return { siteKey, secret, hostnames };
}

/** One line for the server log at start-up. Never shows the secret. */
function describe() {
  const s = settings();
  if (s) return `Turnstile bot check: on (site key ${s.siteKey.slice(0, 8)}…, pages: ${[...s.hostnames].join(', ')})`;
  const { f, error } = readFile();
  if (error) return `Turnstile bot check: OFF – content/turnstile.json could not be read (${error})`;
  if (f.siteKey || f.secret || process.env.TURNSTILE_SITEKEY || process.env.TURNSTILE_SECRET) return 'Turnstile bot check: OFF – it needs both a valid site key and a secret key';
  return 'Turnstile bot check: off (not set up)';
}

/**
 * Ask Cloudflare whether a token is genuine. Resolves to { result } – never rejects:
 *   'off'          Turnstile isn't set up
 *   'ok'           a real visitor on our page, token not used before
 *   'missing'      no token (no JavaScript, the check was blocked, or a script posting directly)
 *   'unavailable'  Cloudflare couldn't answer (or our secret is wrong) – not the visitor's fault
 *   'failed'       Cloudflare says no: forged, expired or already used, or from another page/action
 */
async function verify(token, ip) {
  const s = settings();
  if (!s) return { result: 'off' };
  if (token === undefined || token === null || token === '') return { result: 'missing' };
  if (typeof token !== 'string' || token.length > 2048) return { result: 'failed', codes: ['malformed-token'] };
  let j, httpOk;
  try {
    const body = new URLSearchParams({ secret: s.secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    httpOk = r.ok;
    // Cloudflare answers a wrong secret with HTTP 400 and the reason in the body, so read it either way
    j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') throw new Error(`HTTP ${r.status}, unexpected answer`);
  } catch (e) {
    console.warn('Turnstile check could not reach Cloudflare:', e.message);
    return { result: 'unavailable' };
  }
  const codes = Array.isArray(j['error-codes']) ? j['error-codes'] : [];
  if (codes.some((c) => /secret|internal-error/.test(c))) {
    console.error('Turnstile check failed on our side:', codes.join(', '), '(check the secret key in content/turnstile.json)');
    return { result: 'unavailable', codes };
  }
  if (!httpOk && !codes.length) {
    console.warn('Turnstile check: Cloudflare answered with an error and no reason');
    return { result: 'unavailable' };
  }
  if (httpOk && j.success === true && j.action === ACTION && s.hostnames.has(String(j.hostname || '').toLowerCase())) return { result: 'ok' };
  return { result: 'failed', codes, action: j.action, hostname: j.hostname };
}

module.exports = { settings, describe, verify, ACTION };
