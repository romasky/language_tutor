#!/bin/bash
# sync_tunnel.sh — keep n8n + Telegram webhook in sync with the ephemeral Cloudflare tunnel.
#
# The Cloudflare quick-tunnel gets a NEW random *.trycloudflare.com hostname every time
# cloudflared (re)starts. n8n bakes WEBHOOK_URL into its container env at create time, so a
# stale URL makes the Telegram Trigger fail to activate ("Bad request") and the webhook 404s.
#
# This script: waits for the tunnel + n8n -> writes the fresh URL into .env ->
# RECREATES the n8n container so it picks up the new env -> lets n8n self-activate and
# self-register the webhook -> sets the Telegram webhook directly as a safety net.
#
# Invoked by cloudflared-tunnel.service (ExecStartPost) on every boot/tunnel restart.
set -uo pipefail

APP_DIR="/opt/english-bot"
ENV_FILE="${APP_DIR}/.env"
N8N_URL="http://localhost:5678"
WEBHOOK_PATH="webhook/55b4046a-7ae5-45d1-a77d-7521e9211e5c/webhook"
CLOUDFLARED_LOG="/var/log/cloudflared.log"

# shellcheck disable=SC1090
source "${ENV_FILE}"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# 1. Discover the current tunnel hostname (retry — the log line appears a few seconds after start).
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${CLOUDFLARED_LOG}" 2>/dev/null | tail -1)
  [ -n "${TUNNEL_URL}" ] && break
  sleep 3
done
if [ -z "${TUNNEL_URL}" ]; then
  log "FATAL: could not find tunnel URL in ${CLOUDFLARED_LOG}"
  exit 1
fi
log "Tunnel URL: ${TUNNEL_URL}"

# 2. Update .env only if the URL actually changed, then recreate n8n so it loads the new env.
CURRENT=$(grep -E '^N8N_WEBHOOK_URL=' "${ENV_FILE}" | cut -d= -f2-)
DESIRED="${TUNNEL_URL}/"
if [ "${CURRENT}" != "${DESIRED}" ]; then
  log "Updating N8N_WEBHOOK_URL: ${CURRENT} -> ${DESIRED}"
  sed -i "s|^N8N_WEBHOOK_URL=.*|N8N_WEBHOOK_URL=${DESIRED}|" "${ENV_FILE}"
else
  log "N8N_WEBHOOK_URL already current"
fi

# Always force-recreate: 'restart' does NOT re-read .env; only up --force-recreate does.
log "Recreating n8n container to load env..."
( cd "${APP_DIR}" && docker compose up -d --force-recreate n8n ) 2>&1 | sed 's/^/  /'

# 3. Wait for n8n health.
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${N8N_URL}/healthz")" = "200" ] && { log "n8n healthy"; break; }
  sleep 3
done

# 4. n8n self-activates the workflow on startup (with the correct WEBHOOK_URL) and registers
#    the Telegram webhook itself. Confirm the webhook path is live; retry briefly if activation
#    is still settling.
WEBHOOK_OK=0
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{}' "${N8N_URL}/${WEBHOOK_PATH}")
  if [ "${CODE}" = "200" ]; then WEBHOOK_OK=1; log "n8n webhook path live (200)"; break; fi
  sleep 3
done
[ "${WEBHOOK_OK}" = "1" ] || log "WARN: webhook path still not 200 — check workflow activation"

# 5. Safety net: ensure Telegram points at the fresh tunnel (n8n usually does this itself).
FULL_WEBHOOK="${TUNNEL_URL}/${WEBHOOK_PATH}"
RESULT=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${FULL_WEBHOOK}" \
  --data-urlencode 'allowed_updates=["message","callback_query"]')
log "Telegram setWebhook: ${RESULT}"

log "Sync complete."
