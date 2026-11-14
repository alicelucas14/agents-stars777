/**
 * Minimal, dependency-free admin authentication.
 * Users are stored in content/admin.json with scrypt-hashed passwords.
 * Sessions are stateless HMAC-signed cookies.
 */
const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const cfg = require('./config');
const store = require('./store');
const { ipKey } = require('./net');

const COOKIE = 'cms_session';
const MAX_AGE = 7 * 24 * 3600; // seconds

const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const scryptAsync = promisify(crypto.scrypt);
// same result as hash(), but computed off the main thread so a login doesn't pause the whole site
const hashAsync = async (pw, salt) => (await scryptAsync(String(pw), salt, 64)).toString('hex');

function load() {
  let a = store.readJson(cfg.AUTH_FILE, null);
  if (!a) {
    const password = crypto.randomBytes(9).toString('base64url');
    a = { secret: crypto.randomBytes(32).toString('hex'), users: [] };
    store.writeJson(cfg.AUTH_FILE, a);
    setPassword('admin', password);
    console.log('\n================================================');
    console.log(' Admin account created');
    console.log('   username: admin');
    console.log(`   password: ${password}`);
    console.log(' Change it in the admin panel (Settings) or with:');
    console.log('   node tools/set-password.js admin <new-password>');
    console.log('================================================\n');
    a = store.readJson(cfg.AUTH_FILE);
  }
  return a;
}

function setPassword(username, password) {
  const a = store.readJson(cfg.AUTH_FILE, null) || { secret: crypto.randomBytes(32).toString('hex'), users: [] };
  const salt = crypto.randomBytes(16).toString('hex');
  // sessions issued before this moment stop working (see userFrom)
  const pwChanged = Math.floor(Date.now() / 1000);
  const user = a.users.find((u) => u.username === username);
  if (user) Object.assign(user, { salt, hash: hash(password, salt), pwChanged });
  else a.users.push({ username, salt, hash: hash(password, salt), pwChanged });
  store.writeJson(cfg.AUTH_FILE, a);
}

const same = (hex, stored) => {
  const a = Buffer.from(hex, 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function verify(username, password) {
  const user = load().users.find((u) => u.username === username);
  if (!user) { hash(password, 'dummy-salt'); return false; } // constant-ish time
  return same(hash(password, user.salt), user.hash);
}

/** verify() without blocking the server while the password hash is computed (used by the login form). */
async function verifyAsync(username, password) {
  const user = load().users.find((u) => u.username === username);
  if (!user) { await hashAsync(password, 'dummy-salt'); return false; } // constant-ish time
  return same(await hashAsync(password, user.salt), user.hash);
}

const sign = (data) => crypto.createHmac('sha256', load().secret).update(data).digest('base64url');

function issue(res, username, secure) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const data = `${Buffer.from(username).toString('base64url')}.${exp}`;
  res.setHeader('Set-Cookie',
    `${COOKIE}=${data}.${sign(data)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`);
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function userFrom(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [u, exp, sig] = m[1].split('.');
  if (!u || !exp || !sig) return null;
  const expected = sign(`${u}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (+exp < Date.now() / 1000) return null;
  const username = Buffer.from(u, 'base64url').toString();
  const user = load().users.find((x) => x.username === username);
  if (!user) return null;
  // a password change logs out sessions issued before it (issued = expiry - MAX_AGE)
  if (user.pwChanged && +exp - MAX_AGE < user.pwChanged) return null;
  return username;
}

function requireAuth(req, res, next) {
  const user = userFrom(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

/* simple brute-force protection: 10 failed logins per 15 minutes per visitor (IPv6: per /64) */
const WINDOW = 15 * 60 * 1000;
const attempts = new Map();
function rateLimited(ip) {
  const key = ipKey(ip);
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  if (list.length) attempts.set(key, list); else attempts.delete(key);
  return list.length >= 10;
}
function recordFailure(ip) {
  const key = ipKey(ip);
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
  if (attempts.size > 5000) { // forget visitors whose failures are all old
    const now = Date.now();
    for (const [k, v] of attempts) if (!v.some((t) => now - t < WINDOW)) attempts.delete(k);
  }
}

/* ---------- user management ---------- */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/; // 3–32 chars, lowercase
const validUsername = (u) => USERNAME_RE.test(String(u || ''));
const listUsers = () => load().users.map((u) => ({ username: u.username, created: u.created || null }));
const userExists = (username) => load().users.some((u) => u.username === username);

function addUser(username, password) {
  setPassword(username, password);
  const a = store.readJson(cfg.AUTH_FILE);
  const u = a.users.find((x) => x.username === username);
  if (u && !u.created) { u.created = new Date().toISOString(); store.writeJson(cfg.AUTH_FILE, a); }
}

function deleteUser(username) {
  const a = store.readJson(cfg.AUTH_FILE);
  a.users = a.users.filter((u) => u.username !== username);
  store.writeJson(cfg.AUTH_FILE, a); // their session cookie stops working immediately (userFrom checks the list)
}

module.exports = {
  load, setPassword, verify, verifyAsync, issue, clear, userFrom, requireAuth, rateLimited, recordFailure,
  validUsername, listUsers, userExists, addUser, deleteUser,
};
