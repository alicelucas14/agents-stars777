#!/usr/bin/env node
// Usage: node tools/set-password.js <username> <new-password>
// The password has to meet the same rules as in the admin panel (12+ characters, nothing common or guessable).
const auth = require('../cms/auth');

const [user, pw] = process.argv.slice(2);
if (!user || !pw) {
  console.error(`Usage: node tools/set-password.js <username> <new-password>   (min ${auth.MIN_PASSWORD} characters)`);
  process.exit(1);
}
const problem = auth.passwordProblem(pw, user);
if (problem) {
  console.error(problem);
  process.exit(1);
}
auth.setPassword(user, pw);
console.log(`Password set for "${user}".`);
