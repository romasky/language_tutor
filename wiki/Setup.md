# Setup Guide

This guide walks you through deploying the bot on a fresh DigitalOcean Droplet from scratch.

## 1. Create a Droplet

- Provider: [DigitalOcean](https://digitalocean.com) (or any Ubuntu 22.04 VPS)
- Size: **2 GB RAM minimum** (Basic $12/mo works fine)
- OS: Ubuntu 22.04 LTS
- Add your SSH key during creation

## 2. Install Docker

```bash
ssh root@YOUR_DROPLET_IP

curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

## 3. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts
3. Copy the **bot token** — you'll need it for `.env`

## 4. Get API Keys

| Service | Where to get it |
|---|---|
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| ElevenLabs (optional) | [elevenlabs.io](https://elevenlabs.io) → Profile → API Key |

## 5. Configure Environment

On your local machine:

```bash
git clone https://github.com/romasky/language_tutor.git
cd language_tutor
cp .env.example .env
```

Edit `.env` and fill in every value. See [Configuration](Configuration) for details.

Generate the n8n encryption key:

```bash
openssl rand -hex 32
# paste the result as N8N_ENCRYPTION_KEY in .env
```

## 6. Deploy

```bash
DROPLET_IP=your.server.ip bash scripts/deploy.sh
```

This script:
- Copies files to `/opt/language-bot/` on the server
- Runs `docker compose up -d`
- Runs all DB migrations

## 7. Set Up n8n

1. Open `http://YOUR_DROPLET_IP:5678` in your browser
2. Log in with `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` from your `.env`
3. Go to **Settings → Import Workflow**
4. Upload `n8n/workflows/01_webhook_router.json`
5. Add credentials:
   - **Telegram account** — paste your bot token
   - **Postgres account** — use values from your `.env`
   - **Redis account** — host `redis`, port `6379`
6. Activate the workflow (toggle in top right)

## 8. Set Up Webhook

### Option A: Cloudflare Tunnel (free, no domain needed)

```bash
# Install cloudflared on the server
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Start a temporary tunnel (copy the URL it gives you)
cloudflared tunnel --url http://localhost:5678
```

### Option B: Your own domain + nginx

Configure nginx as a reverse proxy and get a certificate:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

### Register the webhook with Telegram

```bash
WEBHOOK_URL="https://your-tunnel-or-domain.com/webhook/WORKFLOW_WEBHOOK_ID/webhook"

curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$WEBHOOK_URL"
```

Find `WORKFLOW_WEBHOOK_ID` in the Telegram Trigger node settings inside n8n.

## 9. Run DB Migrations

```bash
ssh root@YOUR_DROPLET_IP
cd /opt/language-bot

for f in db/migrations/*.sql; do
  docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < "$f"
done
```

## 10. Test the Bot

Send `/start` to your bot on Telegram. You should see the multilingual welcome message.
