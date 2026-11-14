/**
 * Network helpers for rate limiting.
 */
const net = require('net');

/**
 * The key a visitor is rate-limited under. IPv4: the address itself. IPv6: its /64 network –
 * one home or phone connection gets a whole /64, so limiting single IPv6 addresses would let
 * anyone with one connection try again from millions of addresses.
 */
function ipKey(ip) {
  let s = String(ip || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s); // IPv4 written as IPv6
  if (mapped) s = mapped[1];
  if (net.isIPv4(s) || !net.isIPv6(s)) return s;
  const [head, tail = ''] = s.split('%')[0].toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = s.includes('::') && tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

module.exports = { ipKey };
