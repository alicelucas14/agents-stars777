#!/usr/bin/env bash
# Make one site's origin answer only Cloudflare (and this machine itself).
#
# Why: agents.stars777.org is meant to be reached through Cloudflare, but the server also answers
# anyone who goes straight to its IP address. That skips Cloudflare's protection and makes the app's
# per-visitor limits (login, sign-up) easy to dodge. After this, a request that does not come from a
# Cloudflare address gets "403 Forbidden" from nginx.
#
# Only THIS site's proxy config is touched. Other sites on the same server are not affected.
# Safe to run again any time: it refreshes Cloudflare's address list. If the site stops answering
# through Cloudflare after the change, the script puts the old config back by itself.
#
#   sudo bash tools/server/cf-only.sh [domain]            turn on / refresh   (default agents.stars777.org)
#   sudo bash tools/server/cf-only.sh [domain] --remove   turn off
#
# Run it once for each address, e.g. also for the admin address once that exists.
set -u

DOMAIN="${1:-agents.stars777.org}"
ACTION="on"; [ "${2:-}" = "--remove" ] && ACTION="off"
NGINX=/www/server/nginx/sbin/nginx
PROXY_DIR="/www/server/panel/vhost/nginx/proxy/$DOMAIN"
IPS_FILE="/www/server/nginx/conf/cloudflare-only-$DOMAIN.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
die() { say "STOP: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
[ -x "$NGINX" ] || die "nginx not found at $NGINX"
[ -d "$PROXY_DIR" ] || die "no proxy folder for $DOMAIN ($PROXY_DIR)"

# the one proxy config of this site (the file that holds proxy_pass)
mapfile -t CONFS < <(grep -l 'proxy_pass' "$PROXY_DIR"/*.conf 2>/dev/null)
[ "${#CONFS[@]}" -eq 1 ] || die "expected exactly one proxy config with proxy_pass in $PROXY_DIR, found ${#CONFS[@]}"
CONF="${CONFS[0]}"
[ "$(grep -c 'proxy_pass' "$CONF")" -eq 1 ] || die "$CONF has more than one proxy_pass - not touching it, send it to Claude"
INCLUDE="include $IPS_FILE;"

restore() {
  if [ -f "${BACKUP:-/nonexistent}" ]; then cp -p "$BACKUP" "$CONF"; fi
  "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload
}

if [ "$ACTION" = "off" ]; then
  grep -qF "$INCLUDE" "$CONF" || { say "Already off for $DOMAIN."; exit 0; }
  BACKUP="$CONF.bak-cfonly-off-$STAMP"; cp -p "$CONF" "$BACKUP"
  grep -vF "$INCLUDE" "$BACKUP" > "$CONF"
  "$NGINX" -t || { restore; die "nginx rejected the change - old config put back"; }
  "$NGINX" -s reload && say "Off: $DOMAIN answers direct visits to the server IP again. (backup: $BACKUP)"
  exit 0
fi

# Behind a real-IP setting the addresses nginx sees are the visitors', not Cloudflare's - this would lock everyone out.
if "$NGINX" -T 2>/dev/null | grep -qE '^\s*(real_ip_header|set_real_ip_from)\b'; then
  die "nginx has a real_ip setting, so it sees visitor addresses instead of Cloudflare's. Not changing anything - send 'sudo $NGINX -T | grep -n real_ip' to Claude."
fi

# 1) Cloudflare's current address list, checked before use
V4="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)" || die "could not download Cloudflare's IPv4 list"
V6="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)" || die "could not download Cloudflare's IPv6 list"
echo "$V4" | grep -Eqv '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' && die "unexpected text in Cloudflare's IPv4 list"
echo "$V6" | grep -Eqv '^[0-9a-fA-F:]+/[0-9]{1,3}$' && die "unexpected text in Cloudflare's IPv6 list"
[ "$(echo "$V4" | wc -l)" -ge 10 ] || die "Cloudflare's IPv4 list looks too short"
[ "$(echo "$V6" | wc -l)" -ge 5 ] || die "Cloudflare's IPv6 list looks too short"

NEW="$(mktemp)"
{
  echo "# Cloudflare addresses for $DOMAIN - written by tools/server/cf-only.sh on $(date -u +%F)"
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  echo "$V4" | sed 's/^/allow /; s/$/;/'
  echo "$V6" | sed 's/^/allow /; s/$/;/'
  echo "deny all;"
} > "$NEW"

BACKUP="$CONF.bak-cfonly-$STAMP"
IPS_BACKUP=""
if [ -f "$IPS_FILE" ]; then
  if cmp -s "$NEW" "$IPS_FILE" && grep -qF "$INCLUDE" "$CONF"; then rm -f "$NEW"; say "Already on, and Cloudflare's list has not changed."; exit 0; fi
  IPS_BACKUP="$IPS_FILE.bak-$STAMP"; cp -p "$IPS_FILE" "$IPS_BACKUP"
fi
cp -p "$CONF" "$BACKUP"
install -m 644 "$NEW" "$IPS_FILE"; rm -f "$NEW"
if ! grep -qF "$INCLUDE" "$CONF"; then
  # insert the include right after the proxy_pass line (inside the same location block)
  awk -v inc="    $INCLUDE" '{print} /proxy_pass/ && !done {print inc; done=1}' "$BACKUP" > "$CONF"
fi

rollback() {
  say "$1"
  restore
  if [ -n "$IPS_BACKUP" ]; then cp -p "$IPS_BACKUP" "$IPS_FILE"; else rm -f "$IPS_FILE"; fi
  "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload
  die "rolled back - nothing changed for $DOMAIN"
}

"$NGINX" -t || rollback "nginx rejected the new config."
"$NGINX" -s reload || rollback "nginx would not reload."
sleep 1

# 2) checks
# a) through Cloudflare: must still work
VIA="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/robots.txt?cfonly=$STAMP")"
[ "$VIA" = "200" ] || rollback "Through Cloudflare the site answered $VIA instead of 200."
# b) straight to this machine's own address: must now be refused (curl from here arrives from the server's own non-loopback IP)
SELF="$(hostname -I | awk '{print $1}')"
if [ -n "$SELF" ]; then
  DIRECT="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$DOMAIN:443:$SELF" "https://$DOMAIN/robots.txt")"
else
  DIRECT="?"
fi

say ""
say "On for $DOMAIN."
say "  Through Cloudflare:           $VIA  (expect 200)"
say "  Straight to the server IP:    $DIRECT  (expect 403)"
[ "$DIRECT" = "403" ] || say "  Note: the direct check did not give 403. From outside, test:  curl -ski https://$DOMAIN/ --resolve $DOMAIN:443:<server public IP> | head -1"
say "  Backup of the old config:     $BACKUP"
say "  To undo:                      sudo bash tools/server/cf-only.sh $DOMAIN --remove"
