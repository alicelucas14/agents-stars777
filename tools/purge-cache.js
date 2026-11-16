#!/usr/bin/env node
/**
 * Clear Cloudflare's cached copy of the site right now (same settings as the admin uses:
 * content/cloudflare.json or CF_ZONE_ID / CF_PURGE_TOKEN). Handy after changing files on the
 * server by hand.
 *
 *   node tools/purge-cache.js
 */
const cfpurge = require('../cms/cfpurge');

cfpurge.purgeNow('manual').then((r) => {
  if (r.skipped) { console.error('Cloudflare is not configured (content/cloudflare.json or CF_ZONE_ID + CF_PURGE_TOKEN).'); process.exit(2); }
  process.exit(r.ok ? 0 : 1);
});
