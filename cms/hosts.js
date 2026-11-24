/**
 * Optional separate address for the admin panel (for example agents-admin.stars777.org).
 *
 * Why: the public pages load third-party scripts (Tag Manager, live chat). While the admin panel shares
 * their address, anything those scripts do runs "inside" the admin's own site. On its own address the
 * browser keeps the two apart: the login cookie belongs to the admin address only, and the public
 * pages cannot talk to the admin API.
 *
 * Off by default – nothing changes until an admin host is set, either with the environment variable
 * ADMIN_HOST or in content/hosts.json ({ "adminHost": "agents-admin.stars777.org" }, not committed).
 * It is read once at start-up.
 *
 * With it set:
 *   admin address   serves /admin and /api, plus pictures/styles/scripts/fonts (the editor needs them);
 *                   every page address is sent on to the public site; never indexed.
 *   public address  answers 404 for /admin and /api – except POST /api/signup, the registration form.
 *   any other Host  (localhost, a raw IP, an unexpected proxy setting) behaves exactly as before,
 *                   so a wrong proxy setting can never lock anyone out.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.CONTENT_DIR, 'hosts.json');
const SITE_HOST = new URL(cfg.SITE_URL).hostname.toLowerCase();

const bareHost = (v) => String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:?#].*$/, '');

/** The Host the visitor asked for, lower case, without port. (Not req.hostname: that trusts X-Forwarded-Host, which anyone can send.) */
const hostOf = (req) => bareHost(req.headers.host);

function load() {
  let raw = process.env.ADMIN_HOST;
  if (raw === undefined) {
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')).adminHost; } catch { raw = ''; }
  }
  const host = bareHost(raw);
  if (!host) return { host: '' };
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return { host: '', problem: `"${host}" is not a valid host name` };
  if (host === SITE_HOST) return { host: '', problem: 'it is the same as the public site address' };
  return { host };
}

const state = load();

const describe = () => (state.problem
  ? `Admin host: IGNORED (${state.problem}) – admin stays on the public address`
  : state.host
    ? `Admin host: ${state.host} (admin + API only there; the public site answers 404 for them)`
    : 'Admin host: not set – admin panel is on the public address');

module.exports = { adminHost: state.host, siteHost: SITE_HOST, hostOf, bareHost, describe };
