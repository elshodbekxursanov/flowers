#!/usr/bin/env bash
# Daily backup of products, admins and uploaded photos.
set -e
DEST=/var/backups/flowers
mkdir -p "$DEST"
tar -czf "$DEST/flowers-$(date +%F).tar.gz" -C /opt/flowers data public/photos
find "$DEST" -name 'flowers-*.tar.gz' -mtime +14 -delete
