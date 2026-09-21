#!/bin/bash
# Backup all critical data from the Raspberry Pi to local Mac.
#
# Usage:
#   PI_HOST=<local-pi-host> PI_USER=<local-pi-user> PI_PASS=... bash scripts/backup-pi.sh
#   bash scripts/backup-pi.sh 192.168.0.80       # uses specific IP
#   PI_PASS=mypass bash scripts/backup-pi.sh     # custom password

set -euo pipefail

PI_HOST="${1:-${PI_HOST:-}}"
PI_USER="${PI_USER:-}"
PI_PASS="${PI_PASS:-}"
BACKUP_BASE="${BACKUP_BASE:-$HOME/goko-pi-backups}"
DATE=$(date +%Y-%m-%d)
BACKUP_DIR="$BACKUP_BASE/$DATE"
: "${PI_HOST:?Set PI_HOST from local-only access notes}"
: "${PI_USER:?Set PI_USER from local-only access notes}"
: "${PI_PASS:?Set PI_PASS from local-only access notes}"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o LogLevel=ERROR"

run_ssh() {
  sshpass -p "$PI_PASS" ssh $SSH_OPTS "$PI_USER@$PI_HOST" "$@"
}

run_scp() {
  sshpass -p "$PI_PASS" scp $SSH_OPTS "$@"
}

echo "=== GokoWeb Pi Backup ==="
echo "Host: $PI_HOST"
echo "Backup: $BACKUP_DIR"
echo ""

if ! command -v sshpass &>/dev/null; then
  echo "ERROR: sshpass is required. Install with: brew install sshpass" >&2
  echo "  or: brew install esolitos/ipa/sshpass" >&2
  exit 1
fi

echo "[1/8] Testing SSH connection..."
if ! run_ssh "echo ok" &>/dev/null; then
  echo "ERROR: Cannot SSH to $PI_HOST" >&2
  exit 1
fi
echo "  Connected."

mkdir -p "$BACKUP_DIR"/{database,cloudflare,env,scripts,nginx,systemd,cron,system,wifi-connections}

echo "[2/8] Backing up SQLite database..."
run_ssh "
  if [ -f /home/goko/goko-data/goko.db ]; then
    sqlite3 /home/goko/goko-data/goko.db '.backup /tmp/goko-backup.db' 2>/dev/null || \
      cp /home/goko/goko-data/goko.db /tmp/goko-backup.db
    echo 'DB_FOUND'
  else
    echo 'DB_NOT_FOUND'
  fi
" | grep -q "DB_FOUND" && {
  run_scp "$PI_USER@$PI_HOST:/tmp/goko-backup.db" "$BACKUP_DIR/database/goko.db"
  run_ssh "rm -f /tmp/goko-backup.db"
  echo "  Database backed up."
} || echo "  No database found (fresh install)."

echo "[3/8] Backing up Cloudflare Tunnel credentials..."
run_ssh "sudo tar czf /tmp/cloudflare-backup.tar.gz -C / root/.cloudflared/ 2>/dev/null && echo CF_FOUND || echo CF_NOT_FOUND" | grep -q "CF_FOUND" && {
  run_scp "$PI_USER@$PI_HOST:/tmp/cloudflare-backup.tar.gz" "$BACKUP_DIR/cloudflare/"
  run_ssh "sudo rm -f /tmp/cloudflare-backup.tar.gz"
  tar xzf "$BACKUP_DIR/cloudflare/cloudflare-backup.tar.gz" -C "$BACKUP_DIR/cloudflare/" 2>/dev/null || true
  rm -f "$BACKUP_DIR/cloudflare/cloudflare-backup.tar.gz"
  echo "  Cloudflare credentials backed up."
} || echo "  No Cloudflare credentials found."

echo "[4/8] Backing up environment file..."
run_scp "$PI_USER@$PI_HOST:/home/goko/goko-web/.env.local" "$BACKUP_DIR/env/" 2>/dev/null && \
  echo "  .env.local backed up." || echo "  No .env.local found."

echo "[5/8] Backing up custom scripts..."
SCRIPT_COUNT=$(run_ssh "ls /usr/local/bin/*.sh 2>/dev/null | wc -l" || echo "0")
if [ "$SCRIPT_COUNT" = "0" ] || [ -z "$SCRIPT_COUNT" ]; then
  echo "  No custom scripts found."
else
  run_ssh "sudo tar czf /tmp/scripts-backup.tar.gz -C /usr/local/bin/ \$(ls /usr/local/bin/*.sh 2>/dev/null | xargs -n1 basename) 2>/dev/null" || true
  run_scp "$PI_USER@$PI_HOST:/tmp/scripts-backup.tar.gz" "$BACKUP_DIR/scripts/" 2>/dev/null || true
  run_ssh "sudo rm -f /tmp/scripts-backup.tar.gz"
  if [ -f "$BACKUP_DIR/scripts/scripts-backup.tar.gz" ]; then
    tar xzf "$BACKUP_DIR/scripts/scripts-backup.tar.gz" -C "$BACKUP_DIR/scripts/" 2>/dev/null || true
    rm -f "$BACKUP_DIR/scripts/scripts-backup.tar.gz"
  fi
  echo "  Custom scripts backed up."
fi

echo "[6/8] Backing up nginx config..."
run_scp "$PI_USER@$PI_HOST:/etc/nginx/sites-available/goko" "$BACKUP_DIR/nginx/" 2>/dev/null && \
  echo "  Nginx config backed up." || echo "  No nginx config found."

echo "[7/8] Backing up systemd services & cron..."
run_ssh "sudo crontab -l 2>/dev/null || echo 'no crontab'" > "$BACKUP_DIR/cron/crontab-backup.txt"
SERVICES=$(run_ssh "ls /etc/systemd/system/goko-*.service 2>/dev/null || true")
if [ -n "$SERVICES" ]; then
  echo "$SERVICES" | while read f; do
    [ -n "$f" ] && run_scp "$PI_USER@$PI_HOST:$f" "$BACKUP_DIR/systemd/" 2>/dev/null || true
  done
fi
echo "  Cron and systemd backed up."

echo "[8/8] Backing up system info..."
run_ssh "
  echo '=== OS ===' && cat /etc/os-release
  echo '=== KERNEL ===' && uname -a
  echo '=== NODE ===' && (node -v 2>/dev/null || echo 'not installed')
  echo '=== NPM ===' && (npm -v 2>/dev/null || echo 'not installed')
  echo '=== PM2 ===' && (pm2 list 2>/dev/null || echo 'not installed')
  echo '=== DISK ===' && df -h
  echo '=== MEMORY ===' && free -h
  echo '=== NETWORK ===' && nmcli connection show
  echo '=== HOSTNAME ===' && hostname
  echo '=== IP ===' && hostname -I
" > "$BACKUP_DIR/system/system-info.txt"

run_ssh "dpkg --get-selections 2>/dev/null" > "$BACKUP_DIR/system/dpkg-selections.txt"

WIFI_CONNS=$(run_ssh "sudo ls /etc/NetworkManager/system-connections/ 2>/dev/null || true")
if [ -n "$WIFI_CONNS" ]; then
  echo "$WIFI_CONNS" | while read f; do
    [ -n "$f" ] && run_ssh "sudo cat '/etc/NetworkManager/system-connections/$f'" > "$BACKUP_DIR/wifi-connections/$f" 2>/dev/null || true
  done
fi
echo "  System info backed up."

echo ""
echo "=== Backup Complete ==="
echo "Location: $BACKUP_DIR"
echo ""
echo "Contents:"
find "$BACKUP_DIR" -type f | while read f; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "?")
  echo "  $(echo "$f" | sed "s|$BACKUP_DIR/||")  ($size bytes)"
done
