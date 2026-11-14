#!/usr/bin/env bash
# After uploading new code files (NOT data/ or public/photos/), run:  sudo bash /opt/flowers/deploy/update.sh
set -e
cd /opt/flowers
npm install --omit=dev
chown -R flowers:flowers /opt/flowers
sudo -u flowers env HOME=/opt/flowers PM2_HOME=/opt/flowers/.pm2 pm2 restart flowers --update-env
echo "Restarted."
