#!/bin/bash
set -euo pipefail

DROPLET_IP="${DROPLET_IP:-188.166.28.75}"
DEPLOY_USER="${DEPLOY_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_english_teacher}"
APP_DIR="/opt/english-bot"
SSH_OPTS="-i ${SSH_KEY} -o ConnectTimeout=10"

echo "→ Checking SSH connection..."
ssh ${SSH_OPTS} "${DEPLOY_USER}@${DROPLET_IP}" "echo OK" || {
  echo "✗ Cannot connect to ${DROPLET_IP}"
  exit 1
}

echo "→ Syncing files..."
rsync -avz --progress \
  -e "ssh -i ${SSH_KEY}" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  ./ "${DEPLOY_USER}@${DROPLET_IP}:${APP_DIR}/"

echo "→ Copying .env if not present on remote..."
ssh ${SSH_OPTS} "${DEPLOY_USER}@${DROPLET_IP}" "test -f ${APP_DIR}/.env || echo 'WARNING: .env not found on server — copy it manually'"

echo "→ Restarting containers..."
ssh ${SSH_OPTS} "${DEPLOY_USER}@${DROPLET_IP}" "
  cd ${APP_DIR}
  docker compose pull
  docker compose up -d --remove-orphans
  docker compose ps
"

echo "✓ Deploy complete"
