# Goko Hostel - Raspberry Pi Server Documentation

> **Last Updated:** June 14, 2026  
> **Server Hostname:** `<pi-host>`
> **OS:** Raspberry Pi OS Lite 64-bit (Bookworm, kernel 6.12.75)  
> **Hardware:** Raspberry Pi 4 (8GB RAM), 512GB SD card

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Access & Credentials](#access--credentials)
3. [Fallback Access Methods](#fallback-access-methods)
4. [Installed Software](#installed-software)
5. [Active Services](#active-services)
6. [Scripts & Their Locations](#scripts--their-locations)
7. [Cron Jobs](#cron-jobs)
8. [Important Paths](#important-paths)
9. [Network Configuration](#network-configuration)
10. [Backup Infrastructure](#backup-infrastructure)
11. [Troubleshooting Commands](#troubleshooting-commands)
12. [Not Yet Set Up](#not-yet-set-up)
13. [Change Log](#change-log)

---

## Quick Reference

| Item | Value |
|------|-------|
| **Primary URL** | **`https://<pi-tunnel-hostname>`** (Cloudflare Tunnel — works from anywhere) |
| Admin Panel | `https://<pi-tunnel-hostname>/admin` |
| SSH Command | `ssh <configured-user>@<configured-pi-host>` or `ssh <configured-user>@<configured-pi-host>` (local WiFi only) |
| Password | `<configured-locally>` |
| Local URL | `http://<pi-host>` or `http://<local-ip>` (local WiFi only) |
| WiFi Network | Navjoy02 (2.4GHz only) |
| Web App Path | `/home/<pi-user>/goko-web/` |
| Database Path | `/home/<pi-user>/goko-data/goko.db` |
| Tunnel Config | `/etc/cloudflared/config.yml` |
| Disk Free | ~439GB of 470GB |

---

## Access & Credentials

| Service | Username | Password | Notes |
|---------|----------|----------|-------|
| SSH | `goko` | `<configured-user>@<configured-pi-host>` | Main user account |
| Root | - | - | Use `sudo -i` from goko user |

```bash
ssh <configured-user>@<configured-pi-host>
# or by IP
ssh <configured-user>@<configured-pi-host>
```

---

## Fallback Access Methods

Six ways to reach the Pi, in order of preference:

### 1. Cloudflare Tunnel (<pi-tunnel-hostname>) - PRIMARY

Works from **any device, any network, anywhere in the world**. No local WiFi needed. This is the main way to reach the Pi.

| Property | Value |
|----------|-------|
| Admin Panel | `https://<pi-tunnel-hostname>/admin` |
| Heartbeat API | `https://<pi-tunnel-hostname>/api/sync` |
| Tunnel ID | `70dd8761-4dfa-4b30-ab64-ba430c823d5d` |
| Config | `/etc/cloudflared/config.yml` |
| Service | `cloudflared.service` (enabled, auto-starts on boot) |
| Protocol | QUIC to Cloudflare edge, proxies to `localhost:3000` |

```bash
# Test from anywhere
curl https://<pi-tunnel-hostname>/api/sync

# Sync, deploy, shutdown — all via tunnel
curl -X POST https://<pi-tunnel-hostname>/api/sync \
  -H "Content-Type: application/json" \
  -d '{"password":"<configured-locally>","action":"status"}'

# Restart tunnel (from Pi SSH or admin panel Server Sync tab)
sudo systemctl restart cloudflared
```

The Cloudflare Worker has `PI_PUBLIC_URL=https://<pi-tunnel-hostname>` set as a secret, so the Server Sync tab on `www.gokohostel.com` uses the tunnel to reach the Pi — not local WiFi.

**If `<pi-tunnel-hostname>` stops working:** The tunnel process may have crashed. The health check script (`/usr/local/bin/health-check.sh`) runs every 10 min and auto-restarts it. You can also restart from the admin panel: Management > Server Sync > "Restart tunnel".

---

### 2. WiFi (Navjoy02) - Local LAN fallback

Standard access over the local network. Works only when your device and the Pi are on the same WiFi with no client isolation.

```bash
ssh <configured-user>@<configured-pi-host>
# or by IP
ssh <configured-user>@<configured-pi-host>
# HTTP
http://<local-ip>
```

> **Warning:** The D-Link router may enable AP/client isolation, making WiFi devices unable to see each other. Use the Cloudflare Tunnel instead.
> **Note:** 5GHz networks (e.g. Navjoy05) are NOT visible to this Pi. Only 2.4GHz works.

---

### 3. mDNS/Avahi

`<pi-host>` resolves on any device on the same LAN. No IP needed. Depends on WiFi working (same limitations as method 2).

```bash
ping <pi-host>
ssh <configured-user>@<configured-pi-host>
```

---

### 4. Raspberry Pi Connect

Internet-based remote SSH access via Raspberry Pi's cloud service.

Access via: https://connect.raspberrypi.com

> **Status:** Needs re-registration after the June 2026 reflash. Install `rpi-connect` and sign in again if needed.

---

### 5. Fallback Hotspot

If no WiFi is found after 45 seconds on boot, the Pi creates its own hotspot:

| Property | Value |
|----------|-------|
| SSID | `GokoPi-Setup` |
| Password | `<configured-locally>` |
| Pi IP | `<local-ip>` |

**To use:**
1. Power on Pi at a location with no known WiFi
2. Wait ~1 minute
3. Connect your phone/laptop to `GokoPi-Setup`
4. SSH: `ssh <configured-user>@<configured-pi-host>`
5. Configure real WiFi:
   ```bash
   sudo nmcli device wifi connect "WIFI_NAME" password "WIFI_PASSWORD"
   ```
6. Reboot - Pi will use the real WiFi

---

### 5. USB Gadget Mode

Connect a USB-C cable from Pi to Mac. Creates a virtual ethernet interface.

> Requires a reboot to activate. Use as last resort when no WiFi or hotspot works.

---

### 6. Hardware Watchdog

Auto-reboots the Pi if the kernel freezes for more than 15 seconds. Not an "access method" per se, but ensures the Pi recovers from hard locks without manual intervention.

---

## Installed Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | v20.20.2 | JavaScript runtime for Next.js app |
| npm | 10.8.2 | Package manager |
| PM2 | v7.0.1 | Process manager (keep app running) |
| Nginx | latest | Reverse proxy (port 80 → 3000) |
| SQLite3 | v3.40.1 | Database engine |
| Avahi | latest | mDNS (<pi-host> resolution) |

**Memory:** 4GB swap file configured (+ 512MB existing = 4.5GB total swap)

```bash
# Verify versions
node --version     # v20.20.2
npm --version      # 10.8.2
pm2 --version      # 7.0.1
sqlite3 --version  # 3.40.1
nginx -v
```

---

## Active Services

### Nginx (Reverse Proxy)

| Property | Value |
|----------|-------|
| Status | Active |
| Config File | `/etc/nginx/sites-available/goko` |
| Proxies | Port 80 → Port 3000 (Next.js) |
| Service Name | `nginx.service` |

```bash
sudo systemctl status nginx
sudo systemctl restart nginx
sudo nginx -t                    # Test config syntax
```

---

### PM2 (Process Manager)

| Property | Value |
|----------|-------|
| Status | Installed (no app running yet) |
| Purpose | Keep Next.js app alive, auto-restart on crash |

```bash
pm2 list                         # Show running processes
pm2 logs                         # View app logs
pm2 restart all                  # Restart all apps
pm2 save                         # Save process list for boot
```

---

### Cron (Scheduled Tasks)

| Property | Value |
|----------|-------|
| Status | Active |
| Config | `sudo crontab -l` |

---

## Scripts & Their Locations

| Script | Location | Purpose | Triggered By |
|--------|----------|---------|--------------|
| WiFi Fallback | `/usr/local/bin/wifi-fallback.sh` | Creates hotspot if no WiFi after 45s | Cron (`@reboot`) |
| Health Check | `/usr/local/bin/health-check.sh` | Monitors nginx, PM2, cloudflared; auto-restarts | Cron (every 10 min) |
| DB Backup | `/usr/local/bin/backup-db.sh` | Daily SQLite backup with 7-day rotation | Cron (daily 3 AM) |

### Script Details

#### `/usr/local/bin/wifi-fallback.sh`

Waits 45 seconds after boot. If no internet connectivity, creates the `GokoPi-Setup` hotspot so you can SSH in and configure WiFi.

#### `/usr/local/bin/health-check.sh`

Checks if nginx, PM2 processes, and cloudflared are running. Restarts any that are down. Logs to `/var/log/goko-health.log`.

#### `/usr/local/bin/backup-db.sh`

Copies `/home/<pi-user>/goko-data/goko.db` to `/home/<pi-user>/backups/` with a dated filename. Deletes backups older than 7 days.

---

## Cron Jobs

**View:** `sudo crontab -l`  
**Edit:** `sudo crontab -e`

| Schedule | Command | Purpose |
|----------|---------|---------|
| `@reboot` | `/usr/local/bin/wifi-fallback.sh` | Fallback hotspot on boot |
| `0 3 * * *` | `/usr/local/bin/backup-db.sh` | Daily DB backup at 3 AM |
| `*/10 * * * *` | `/usr/local/bin/health-check.sh` | Health check every 10 min |

---

## Important Paths

| Path | Purpose |
|------|---------|
| `/home/<pi-user>/goko-web/` | Web application (Next.js) |
| `/home/<pi-user>/goko-web/.env.local` | Environment variables (passwords, secrets) |
| `/home/<pi-user>/goko-data/goko.db` | SQLite database |
| `/home/<pi-user>/backups/` | Daily database backups |
| `/etc/nginx/sites-available/goko` | Nginx config |
| `/usr/local/bin/` | All custom scripts |

---

## Network Configuration

| Property | Value |
|----------|-------|
| Hostname | `<pi-host>` |
| mDNS Address | `<pi-host>` |
| WiFi Network | Navjoy02 (2.4GHz) |
| IP Address | <local-ip> (DHCP) |
| 5GHz Support | NOT available on this Pi |

### WiFi Commands

```bash
nmcli connection show --active          # Show current connection
sudo nmcli device wifi list             # Scan for networks
sudo nmcli device wifi connect "SSID" password "PASS"  # Connect to network
nmcli connection show                   # Show all saved networks
sudo nmtui                              # Interactive network UI
```

### Changing WiFi at a New Location

1. **If you have access via another method** (ethernet, hotspot, Pi Connect):
   ```bash
   ssh <configured-user>@<configured-pi-host>
   sudo nmcli device wifi connect "NEW_WIFI" password "NEW_PASS"
   ```

2. **If no access at all**, power on the Pi and wait for the fallback hotspot (`GokoPi-Setup`), then SSH via `<local-ip>` and configure from there.

3. **Pre-configure multiple networks** before travel:
   ```bash
   sudo nmcli device wifi connect "HOME_WIFI" password "pass1"
   sudo nmcli device wifi connect "HOSTEL_WIFI" password "pass2"
   sudo nmcli connection modify "HOME_WIFI" connection.autoconnect-priority 100
   sudo nmcli connection modify "HOSTEL_WIFI" connection.autoconnect-priority 90
   ```

---

## Backup Infrastructure

### On-Pi: Automated Daily Backup

- **Script:** `/usr/local/bin/backup-db.sh`
- **Schedule:** Daily at 3 AM
- **Location:** `/home/<pi-user>/backups/`
- **Retention:** 7 days (older backups auto-deleted)

### Mac-side: Manual Full Backup

**Script:** `scripts/backup-pi.sh` (in the GokoWeb repo)

One command pulls all Pi data to your Mac:

```bash
./scripts/backup-pi.sh
# Saves to ~/goko-pi-backups/YYYY-MM-DD/
```

### Full SD Card Image (Disaster Recovery)

For a complete image backup of the entire SD card:

```bash
# On Mac, with SD card inserted:
sudo dd if=/dev/diskN of=~/goko-pi-full-backup.img bs=4m status=progress
```

This creates a byte-for-byte copy. Can be flashed back to restore everything.

---

## Troubleshooting Commands

### System Health

```bash
df -h                            # Disk space
free -h                          # Memory usage
vcgencmd measure_temp            # CPU temperature
uptime                           # System uptime
htop                             # Process viewer
```

### Service Issues

```bash
sudo systemctl status nginx      # Nginx status
sudo systemctl status cron       # Cron status
pm2 list                         # PM2 processes
pm2 logs --lines 50              # Recent app logs

sudo systemctl --failed          # All failed services
sudo journalctl -u nginx -f      # Nginx logs (live)
```

### Network Issues

```bash
hostname -I                      # Show IP address
ping -c 4 google.com             # Test internet
sudo nmcli device wifi list      # Scan WiFi
iwconfig wlan0                   # WiFi details
sudo netstat -tlnp               # Listening ports
```

### Website Issues

```bash
curl -I http://localhost          # Test nginx response
curl -I http://localhost:3000     # Test Next.js directly
sudo nginx -t                    # Validate nginx config
sudo tail -20 /var/log/nginx/error.log
```

---

## Deployment Status

All core infrastructure is deployed and running:

| Item | Status | Details |
|------|--------|---------|
| GokoWeb app | **Running** | PM2 managed, auto-restart on crash/boot |
| Cloudflare Tunnel | **Running** | `<pi-tunnel-hostname>` → `localhost:3000`, auto-starts on boot |
| `.env.local` | **Configured** | Admin passwords, sync secret, Cloudflare URL |
| Sync Engine | **Active** | Bi-directional sync with Cloudflare D1 |
| Health Check | **Active** | Every 10 min, auto-restarts nginx/PM2/cloudflared |
| DB Backup | **Active** | Daily at 3 AM, 7-day rotation |
| DNS Failover | **Configured** | dnsmasq + failover monitor |
| Auto-Deploy | **Active** | Cron polls GitHub every 5 min |

### Cloudflare Worker Secret (set once)

The Cloudflare Worker needs `PI_PUBLIC_URL` to reach the Pi via tunnel:

```bash
echo "https://<pi-tunnel-hostname>" | npx wrangler secret put PI_PUBLIC_URL --name goko-hostel-latest-webpage
```

This is already set. Only re-run if the tunnel domain changes.

---

## Nginx Configuration

**File:** `/etc/nginx/sites-available/goko`

The config proxies all traffic from port 80 to the Next.js app on port 3000:

```nginx
server {
    listen 80;
    server_name <pi-host> _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Test and reload after changes
sudo nginx -t && sudo systemctl reload nginx
```

---

## Local DNS Failover

When the hostel's internet goes down, the Pi automatically redirects `gokohostel.com` traffic to itself so staff and guests on the local WiFi experience no disruption.

### How It Works
- The Pi runs `dnsmasq` as a local DNS server
- A failover monitor checks internet every 30 seconds
- If internet is down for 60 seconds, DNS override activates: `gokohostel.com` resolves to the Pi's local IP
- When internet returns, the override is deactivated within 30 seconds
- Toggle on/off from the admin UI: Management > Server Sync > Local DNS Failover

### Services
| Service | Purpose |
|---------|---------|
| `dnsmasq.service` | Local DNS server, forwards to 8.8.8.8/1.1.1.1 |
| `goko-failover.service` | Monitors internet, activates/deactivates DNS override |

### Commands
```bash
# Check failover status
sudo systemctl status goko-failover
cat /var/log/goko-failover.log

# Check if failover is currently active (non-empty = active)
cat /etc/dnsmasq.d/failover-hosts

# Manually test DNS resolution
dig @<local-ip> gokohostel.com +short

# Restart dnsmasq
sudo systemctl restart dnsmasq
```

### Router DNS Configuration (one-time per location)

For the failover to work, devices on the hostel WiFi must use the Pi as their DNS server.

**For D-Link routers (current setup):**
1. Open `http://<local-ip>` in a browser
2. Go to Setup > Network Settings (or LAN Settings)
3. Find DHCP Server Settings
4. Set **Primary DNS** to `<local-ip>` (the Pi's IP)
5. Set **Secondary DNS** to `8.8.8.8` (fallback if Pi is down)
6. Save and reboot router

**For other routers:**
- Find the DHCP settings and set the Pi's IP as the primary DNS
- Always set a public DNS (8.8.8.8) as secondary

**After configuring:** Devices will need to reconnect to WiFi (or wait for DHCP lease renewal) to pick up the new DNS server.

### SSL Certificate
- Self-signed certificate at `/etc/ssl/certs/goko-selfsigned.crt`
- Valid for 10 years, covers `gokohostel.com` and `*.gokohostel.com`
- Guests may see a browser SSL warning during failover (expected with self-signed certs)

---

## Change Log

| Date | Change |
|------|--------|
| Live deployment details are kept in local maintainer notes. | Fresh setup: Pi OS Lite 64-bit (Bookworm), Node 20, PM2, Nginx, SQLite, swap, scripts, fallback access methods |
| Live deployment details are kept in local maintainer notes. | Added local DNS failover: dnsmasq, failover monitor, self-signed SSL, admin UI toggle |
| Live deployment details are kept in local maintainer notes. | Promoted Cloudflare Tunnel to primary access method. Set `PI_PUBLIC_URL` secret on Worker. Updated docs: tunnel is method #1, local WiFi demoted to fallback. Marked all infra as deployed (was wrongly listed as "Not Yet Set Up"). |

---

> **Remember:** After adding any new service or changing config, update this document!
