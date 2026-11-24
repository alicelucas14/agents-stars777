#!/usr/bin/env node
// Usage: node tools/set-role.js <username> <super|staff>
// Only the super admin can see the Users screen and manage accounts. The first account made becomes the
// super admin automatically; use this to move that to someone else (make the new one super first, then the old one staff),
// or to get back in if no one can reach the Users screen.
const auth = require('../cms/auth');

const [user, role] = process.argv.slice(2);
if (!user || !auth.ROLES.includes(role)) {
  console.error('Usage: node tools/set-role.js <username> <super|staff>');
  process.exit(1);
}
if (!auth.userExists(user)) {
  console.error(`No user called "${user}". Existing users: ${auth.listUsers().map((u) => `${u.username} (${u.role})`).join(', ')}`);
  process.exit(1);
}
if (role === 'staff' && auth.isSuper(user) && auth.superCount() <= 1) {
  console.error('There must always be at least one super admin – make someone else super first.');
  process.exit(1);
}
auth.setRole(user, role);
console.log(`"${user}" is now ${role === 'super' ? 'a super admin' : 'staff'}.`);
console.log('Users now:', auth.listUsers().map((u) => `${u.username} (${u.role})`).join(', '));
