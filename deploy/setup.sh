#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 EC2 instance.
# Usage:  sudo bash setup.sh your-domain.uz   (domain is optional; omit to use the server IP)
set -euo pipefail

DOMAIN="${1:-_}"
APP_DIR=/opt/flowers
APP_USER=flowers

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo"; exit 1; fi
if [ ! -f "$APP_DIR/server.js" ]; then
  echo "Upload and unzip the project into $APP_DIR first (see DEPLOY-AWS.md)"; exit 1
fi

echo "==> Swap (t2/t3.micro has only 1 GB RAM)"
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Packages: Node 20, nginx"
apt-get update -y
apt-get install -y curl nginx ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> App user and dependencies"
id -u $APP_USER >/dev/null 2>&1 || useradd --system --home $APP_DIR --shell /usr/sbin/nologin $APP_USER
cd $APP_DIR
mkdir -p data public/photos
npm install --omit=dev
chown -R $APP_USER:$APP_USER $APP_DIR

echo "==> Start app with pm2 (bound to 127.0.0.1, nginx is the public entrance)"
sudo -u $APP_USER env HOME=$APP_DIR PM2_HOME=$APP_DIR/.pm2 HOST=127.0.0.1 PORT=3000 \
  pm2 start server.js --name flowers --update-env
sudo -u $APP_USER env HOME=$APP_DIR PM2_HOME=$APP_DIR/.pm2 pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp $APP_DIR >/dev/null

echo "==> nginx"
sed "s/__DOMAIN__/$DOMAIN/g" $APP_DIR/deploy/nginx.conf > /etc/nginx/sites-available/flowers
ln -sf /etc/nginx/sites-available/flowers /etc/nginx/sites-enabled/flowers
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall (SSH + web only)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Daily backup of data and photos (kept 14 days)"
install -m 755 $APP_DIR/deploy/backup.sh /usr/local/bin/flowers-backup
echo '30 3 * * * root /usr/local/bin/flowers-backup' > /etc/cron.d/flowers-backup

echo
echo "DONE. Open http://$([ "$DOMAIN" = "_" ] && curl -s ifconfig.me || echo $DOMAIN)"
echo "First admin password (printed once at first start):"
sleep 3
sudo -u $APP_USER env HOME=$APP_DIR PM2_HOME=$APP_DIR/.pm2 pm2 logs flowers --nostream --lines 30 | grep -i "FIRST START" || echo "(not printed: admin already existed in data/admins.json)"
