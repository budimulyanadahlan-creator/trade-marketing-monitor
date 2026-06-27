#!/bin/bash
# Deploy script untuk marmot.360.biz.id
# Ganti SSH_USER dengan username SSH Anda (biasanya: root, ubuntu, atau debian)

SSH_USER="root"
SERVER="marmot.360.biz.id"
DEPLOY_PATH="/opt/trade-marketing-monitor"

echo "=== Mengirim file ke $SERVER... ==="
rsync -avz --progress \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='coverage' \
  ./ "$SSH_USER@$SERVER:$DEPLOY_PATH/"

echo ""
echo "=== Build & jalankan container... ==="
ssh "$SSH_USER@$SERVER" "
  cd $DEPLOY_PATH
  docker compose down
  docker compose up -d --build
  docker compose ps
"

echo ""
echo "=== Selesai! App berjalan di https://marmot.360.biz.id ==="
