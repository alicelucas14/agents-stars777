#!/usr/bin/env node
/**
 * Check the Turnstile bot-check set-up (content/turnstile.json) without showing the secret:
 *   sudo "$(command -v node)" tools/turnstile-check.js
 *
 * Sends Cloudflare a dummy token with our secret key. Cloudflare answers "invalid token" when
 * the secret is right and "invalid secret" when it isn't. (Whether the site key belongs to the
 * same widget only shows with a real sign-up on the site.)
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../cms/config');
const turnstile = require('../cms/turnstile');

(async () => {
  console.log(turnstile.describe());
  if (!turnstile.settings()) process.exit(1);

  const file = path.join(cfg.CONTENT_DIR, 'turnstile.json');
  if (process.platform !== 'win32' && fs.existsSync(file) && fs.statSync(file).mode & 0o077) {
    console.warn(`Warning: ${file} can be read by other users on this server – run: sudo chmod 600 ${file}`);
  }

  const r = await turnstile.verify('XXXX.DUMMY.TOKEN.XXXX');
  const codes = r.codes || [];
  if (r.result === 'failed' && codes.includes('invalid-input-response')) {
    console.log('OK: Cloudflare accepted the secret key.');
  } else if (r.result === 'failed' && !codes.length) {
    console.log('Cloudflare accepted the secret, but it looks like one of Cloudflare\'s TEST keys – use your widget\'s real keys.');
    process.exit(1);
  } else if (codes.some((c) => /secret/.test(c))) {
    console.log('PROBLEM: Cloudflare says the secret key is wrong – copy it again from the Turnstile widget.');
    process.exit(1);
  } else {
    console.log(`PROBLEM: no usable answer from Cloudflare (${r.result}${codes.length ? ': ' + codes.join(', ') : ''}).`);
    process.exit(1);
  }
})();
