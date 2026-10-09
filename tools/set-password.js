#!/usr/bin/env node
// Usage: node tools/set-password.js <username> <new-password>
const auth = require('../cms/auth');

const [user, pw] = process.argv.slice(2);
if (!user || !pw || pw.length < 8) {
  console.error('Usage: node tools/set-password.js <username> <new-password>   (min 8 chars)');
  process.exit(1);
}
auth.setPassword(user, pw);
console.log(`Password set for "${user}".`);
