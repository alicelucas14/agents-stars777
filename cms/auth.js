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

/**
 * content/admin.json, or null when it doesn't exist yet. Only a missing file means "first run":
 * a file that is there but can't be read must never be replaced by a fresh one – that would
 * delete every account – so that is an error instead.
 */
function readAuth() {
  const a = store.readJson(cfg.AUTH_FILE, null);
  if (!a && fs.existsSync(cfg.AUTH_FILE)) {
    throw new Error(`${cfg.AUTH_FILE} exists but could not be read – restore it from a backup (refusing to create a new admin account)`);
  }
  return a;
}

function load() {
  let a = readAuth();
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
  // There must always be a super admin. Accounts made before roles existed have none, so the oldest account
  // (the one with no "created" date, i.e. the first one ever made, else the earliest) becomes the super admin.
  // The Users screen shows who it is; tools/set-role.js changes it.
  if (a.users.length && !a.users.some((u) => u.role === 'super')) {
    const oldest = [...a.users].sort((x, y) => (x.created ? Date.parse(x.created) : 0) - (y.created ? Date.parse(y.created) : 0))[0];
    oldest.role = 'super';
    store.writeJson(cfg.AUTH_FILE, a);
    console.log(`Admin accounts: "${oldest.username}" is now the super admin (the first account made).`);
  }
  return a;
}

/* ---------- password rules ----------
 * At least 12 characters, and nothing that is on every attacker's list: common passwords (also with
 * digits or symbols added, "P@ssw0rd2024"), keyboard/number runs, the username, the site's own name.
 * No "must contain a capital and a symbol" rules – length and unpredictability matter more, and a
 * few random words make a good password. */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;
const COMMON = new Set(`password passw0rd pssw0rd psw0rd passwd pass welcome letmein admin administrator root test tester guest user login master
  qwerty qwertyuiop qwertyui asdfgh asdfghjkl zxcvbn zxcvbnm abc abcd abcdef abcdefgh iloveyou monkey dragon sunshine princess football baseball
  superman batman trustno shadow michael jennifer freedom whatever changeme default secret starwars cheese hello helloworld india delhi mumbai
  cricket bollywood teenpatti casino stars star agent agents bigagents jackpot lottery winner money lucky happy love family computer internet
  google facebook whatsapp telegram samsung welcome1 temp temporary newpassword mypassword yourpassword secretpassword`.split(/\s+/));
const RUNS = ['1234567890', '0987654321', 'qwertyuiop', 'poiuytrewq', 'asdfghjkl', 'lkjhgfdsa', 'zxcvbnm', 'mnbvcxz', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', '1qaz2wsx3edc', '1q2w3e4r5t6y'];
const alnum = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const unleet = (s) => String(s).toLowerCase().replace(/@/g, 'a').replace(/\$/g, 's').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/5/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');

/** '' if the password is acceptable, otherwise a sentence telling the person what to change. */
function passwordProblem(password, username = '') {
  if (typeof password !== 'string') return 'Please enter a password.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters. Three or four random words in a row work well.`;
  if (password.length > MAX_PASSWORD) return `Password must be ${MAX_PASSWORD} characters or fewer.`;
  const plain = alnum(password);
  if (new Set(password.toLowerCase()).size < 6) return 'That password is too repetitive – please use more different characters.';
  for (const run of RUNS) {
    for (let i = 0; i + 8 <= run.length; i++) if (plain.includes(run.slice(i, i + 8))) return 'That password contains a keyboard or number sequence (like 12345678 or qwertyui) – please choose something less predictable.';
  }
  for (const v of [plain, unleet(password)]) {
    const base = v.replace(/\d+$/, '');
    if (COMMON.has(base)) return 'That password is far too common (even with numbers or symbols added) – please choose something less predictable.';
    for (const w of COMMON) if (w.length >= 4 && base.length > w.length && base === w.repeat(base.length / w.length)) return 'That password is far too common – please choose something less predictable.';
  }
  const name = alnum(username);
  if (name.length >= 3 && plain.includes(name)) return 'The password must not contain the username.';
  if (/stars777|bigagents|agentsstars/.test(plain)) return "The password must not contain the site's name.";
  return '';
}

function setPassword(username, password) {
  const a = readAuth() || { secret: crypto.randomBytes(32).toString('hex'), users: [] };
  const salt = crypto.randomBytes(16).toString('hex');
  // sessions issued before this moment stop working (see userFrom)
  const pwChanged = Math.floor(Date.now() / 1000);
  const user = a.users.find((u) => u.username === username);
  if (user) { Object.assign(user, { salt, hash: hash(password, salt), pwChanged }); delete user.mustChange; }
  else a.users.push({ username, salt, hash: hash(password, salt), pwChanged });
  store.writeJson(cfg.AUTH_FILE, a);
}

/* ---------- roles, last login ---------- */
const ROLES = ['super', 'staff'];
const roleOf = (u) => (u && u.role === 'super' ? 'super' : 'staff');
const isSuper = (username) => roleOf(load().users.find((u) => u.username === username)) === 'super';
const superCount = () => load().users.filter((u) => u.role === 'super').length;

/**
 * Called after a successful login: remembers when, and whether this password meets today's rules.
 * The password itself is only checked here, never stored. A password that no longer meets the rules
 * makes the person choose a new one before they can use the panel (see mustChange).
 */
function recordLogin(username, password) {
  const a = load();
  const user = a.users.find((u) => u.username === username);
  if (!user) return;
  user.lastLogin = new Date().toISOString();
  if (passwordProblem(password, username)) user.mustChange = true; else delete user.mustChange;
  store.writeJson(cfg.AUTH_FILE, a);
}
const mustChange = (username) => !!(load().users.find((u) => u.username === username) || {}).mustChange;

function setRole(username, role) {
  if (!ROLES.includes(role)) throw new Error('Unknown role');
  const a = load();
  const user = a.users.find((u) => u.username === username);
  if (!user) throw new Error('User not found');
  user.role = role;
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

/** The request's session cookie if it is genuine and not expired: { u, exp, sig }, else null. */
function tokenFrom(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [u, exp, sig] = m[1].split('.');
  if (!u || !exp || !sig) return null;
  const expected = sign(`${u}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (+exp < Date.now() / 1000) return null;
  return { u, exp: +exp, sig };
}

/**
 * Log out: delete the cookie in this browser AND remember on the server that this session is
 * over, so a copy of the cookie (another device, a stolen copy) stops working too. Other
 * sessions of the same user stay logged in. Remembered until the session would have expired.
 */
function clear(res, req) {
  const t = req && tokenFrom(req);
  if (t) {
    const a = load();
    const now = Date.now() / 1000;
    a.revoked = (a.revoked || []).filter((r) => r.exp > now).slice(-999);
    if (!a.revoked.some((r) => r.sig === t.sig)) a.revoked.push({ sig: t.sig, exp: t.exp });
    store.writeJson(cfg.AUTH_FILE, a);
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function userFrom(req) {
  const t = tokenFrom(req);
  if (!t) return null;
  const a = load();
  if ((a.revoked || []).some((r) => r.sig === t.sig)) return null; // logged out
  const username = Buffer.from(t.u, 'base64url').toString();
  const user = a.users.find((x) => x.username === username);
  if (!user) return null;
  // a password change logs out sessions issued before it (issued = expiry - MAX_AGE)
  if (user.pwChanged && t.exp - MAX_AGE < user.pwChanged) return null;
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
const listUsers = () => load().users.map((u) => ({
  username: u.username, created: u.created || null, role: roleOf(u), lastLogin: u.lastLogin || null, mustChange: !!u.mustChange,
}));
const userExists = (username) => load().users.some((u) => u.username === username);

function addUser(username, password, role = 'staff') {
  setPassword(username, password);
  const a = store.readJson(cfg.AUTH_FILE);
  const u = a.users.find((x) => x.username === username);
  if (u) {
    if (!u.created) u.created = new Date().toISOString();
    u.role = ROLES.includes(role) ? role : 'staff';
    store.writeJson(cfg.AUTH_FILE, a);
  }
}

function deleteUser(username) {
  const a = store.readJson(cfg.AUTH_FILE);
  a.users = a.users.filter((u) => u.username !== username);
  store.writeJson(cfg.AUTH_FILE, a); // their session cookie stops working immediately (userFrom checks the list)
}

/** Only the super admin may continue (user list, accounts, roles). Use after requireAuth. */
function requireSuper(req, res, next) {
  if (!isSuper(req.user)) return res.status(403).json({ error: 'Only the super admin can do that.' });
  next();
}

/** A password that no longer meets the rules has to be replaced before anything else is allowed. Use after requireAuth. */
function requirePasswordOk(req, res, next) {
  if (!mustChange(req.user) || (req.method === 'POST' && req.path === '/password')) return next();
  res.status(403).json({ error: 'Your password does not meet the new password rules – please choose a new one to continue.', code: 'password-change' });
}

module.exports = {
  load, setPassword, verify, verifyAsync, issue, clear, userFrom, requireAuth, rateLimited, recordFailure,
  validUsername, listUsers, userExists, addUser, deleteUser,
  MIN_PASSWORD, passwordProblem, recordLogin, mustChange, isSuper, superCount, setRole, ROLES, requireSuper, requirePasswordOk,
};
