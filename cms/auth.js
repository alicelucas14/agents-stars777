/**
 * Minimal, dependency-free admin authentication.
 * Users are stored in content/admin.json with scrypt-hashed passwords.
 * Sessions are stateless HMAC-signed cookies.
 */
const crypto = require('crypto');
const fs = require('fs');
const cfg = require('./config');
const store = require('./store');

const COOKIE = 'cms_session';
const MAX_AGE = 7 * 24 * 3600; // seconds

const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');

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
  const user = a.users.find((u) => u.username === username);
  if (user) Object.assign(user, { salt, hash: hash(password, salt) });
  else a.users.push({ username, salt, hash: hash(password, salt) });
  store.writeJson(cfg.AUTH_FILE, a);
}

function verify(username, password) {
  const user = load().users.find((u) => u.username === username);
  if (!user) { hash(password, 'dummy-salt'); return false; } // constant-ish time
  const a = Buffer.from(hash(password, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  return load().users.some((x) => x.username === username) ? username : null;
}

function requireAuth(req, res, next) {
  const user = userFrom(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

/* simple brute-force protection */
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}
const recordFailure = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);

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
  load, setPassword, verify, issue, clear, userFrom, requireAuth, rateLimited, recordFailure,
  validUsername, listUsers, userExists, addUser, deleteUser,
};
