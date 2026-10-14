#!/usr/bin/env bash
# Kold: one-command install on a fresh Ubuntu server (made for Oracle Cloud Always Free, Ubuntu 24.04 ARM or x86).
#
#   curl -fsSL https://raw.githubusercontent.com/JiviteshKumar/kold/main/deploy/setup.sh | sudo bash -s -- your-name.duckdns.org
#
# Afterwards Kold runs by itself: it starts on boot, restarts if it crashes, serves https automatically,
# keeps job listings fresh, and backs up its database every night. Safe to run again (it updates in place).
set -euo pipefail

DOMAIN="${1:-}"
REPO="${KOLD_REPO:-https://github.com/JiviteshKumar/kold.git}"
DIR=/opt/kold
MODEL="${KOLD_MODEL:-qwen3.5:4b}"
RUN_USER=kold

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash setup.sh your-name.duckdns.org"; exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo."; exit 1
fi
step() { echo; echo "==> $*"; }

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates gnupg build-essential python3 python3-venv python3-dev \
  debian-keyring debian-archive-keyring apt-transport-https iptables-persistent sqlite3

# Building the web app needs memory: add swap on small servers.
if ! swapon --show | grep -q '/swapfile'; then
  step "Adding 4 GB swap"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

step "Caddy (automatic https)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

step "Ollama (Kold's local AI model runs here; no third-party AI service)"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/kold.conf <<EOF
[Service]
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_HOST=127.0.0.1:11434"
EOF
systemctl daemon-reload && systemctl enable --now ollama && systemctl restart ollama
for i in $(seq 1 30); do curl -s 127.0.0.1:11434/api/tags >/dev/null && break; sleep 2; done
ollama pull "$MODEL"

step "Kold code"
id -u $RUN_USER >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$RUN_USER --shell /usr/sbin/nologin $RUN_USER
if [[ -d $DIR/.git ]]; then
  git -C $DIR fetch --depth 1 origin main && git -C $DIR reset --hard origin/main
else
  git clone --depth 1 "$REPO" $DIR
fi
chown -R $RUN_USER:$RUN_USER $DIR

step "API server"
sudo -u $RUN_USER python3 -m venv $DIR/api/.venv
sudo -u $RUN_USER $DIR/api/.venv/bin/pip install -q --upgrade pip
sudo -u $RUN_USER $DIR/api/.venv/bin/pip install -q -r $DIR/api/requirements.txt
ENV=$DIR/api/.env
if [[ ! -f $ENV ]]; then
  cat > $ENV <<EOF
# Kold production settings (this file stays on the server; it is never committed)
KOLD_WEB_ORIGIN=https://$DOMAIN
KOLD_SECRET_KEY=$(openssl rand -hex 32)
KOLD_LLM_MODEL=$MODEL
# Small CPU-only servers are slower: give the model time.
KOLD_LLM_TIMEOUT_S=600

# Gmail sign-in (see README "Gmail setup"). Register this redirect URI in Google Cloud:
#   https://$DOMAIN/api/gmail/callback
KOLD_GOOGLE_CLIENT_ID=
KOLD_GOOGLE_CLIENT_SECRET=
EOF
  chown $RUN_USER:$RUN_USER $ENV && chmod 600 $ENV
else
  sed -i "s|^KOLD_WEB_ORIGIN=.*|KOLD_WEB_ORIGIN=https://$DOMAIN|" $ENV
fi

step "Web app (production build: this takes a few minutes)"
cd $DIR/web
sudo -u $RUN_USER npm ci --no-audit --no-fund
sudo -u $RUN_USER npm run build

step "Services (start on boot, restart on failure)"
cat > /etc/systemd/system/kold-api.service <<EOF
[Unit]
Description=Kold API
After=network-online.target ollama.service
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$DIR/api
ExecStart=$DIR/api/.venv/bin/python -m uvicorn kold.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/kold-web.service <<EOF
[Unit]
Description=Kold web app
After=network-online.target kold-api.service

[Service]
User=$RUN_USER
WorkingDirectory=$DIR/web
Environment=NODE_ENV=production
Environment=KOLD_API_ORIGIN=http://127.0.0.1:8000
ExecStart=/usr/bin/npm run start -- -p 3000 -H 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	@api path /api/*
	reverse_proxy @api 127.0.0.1:8000 {
		transport http {
			read_timeout 900s
		}
	}
	reverse_proxy 127.0.0.1:3000
}
EOF

step "Firewall: allow web traffic (80/443)"
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW --dport $port -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 5 -p tcp -m state --state NEW --dport $port -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

step "Nightly database backup (keeps 14 days)"
cat > /etc/cron.daily/kold-backup <<EOF
#!/bin/sh
mkdir -p $DIR/backups
sqlite3 $DIR/api/data/kold.db ".backup '$DIR/backups/kold-\$(date +%F).db'" 2>/dev/null
find $DIR/backups -name 'kold-*.db' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/kold-backup

systemctl daemon-reload
systemctl enable kold-api kold-web caddy
systemctl restart kold-api kold-web caddy

step "Checking"
sleep 8
curl -fsS 127.0.0.1:8000/api/health >/dev/null && echo "API: running" || echo "API: not responding yet (check: journalctl -u kold-api -n 50)"
curl -fsS -o /dev/null 127.0.0.1:3000 && echo "Web app: running" || echo "Web app: not responding yet (check: journalctl -u kold-web -n 50)"

cat <<EOF

=====================================================================
 Kold is installed and runs by itself.

   Open:  https://$DOMAIN
   (the first https certificate can take a minute to issue)

 Gmail sign-in: add your Google OAuth client to $ENV,
   then run: sudo systemctl restart kold-api
   Redirect URI to register: https://$DOMAIN/api/gmail/callback

 Update to the latest code anytime:  sudo bash $DIR/deploy/setup.sh $DOMAIN
 Logs:  journalctl -u kold-api -f     |   journalctl -u kold-web -f
=====================================================================
EOF
