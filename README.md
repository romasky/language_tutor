# 🌍 Language Tutor Bot

> A self-hosted AI language tutor on Telegram — powered by Claude, built on n8n.

Learn any language through natural conversation, grammar practice, and vocabulary building. The bot speaks your native language, teaches the one you want, and adapts to your level automatically.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🌐 **Multilingual** | UI in 14 languages, learn any of 80+ target languages |
| 🎯 **Auto level assessment** | 4-question AI interview determines your level (A1–C1) |
| 📚 **Vocabulary** | `/word` — definition, examples, memory tips in your native language |
| ✍️ **Grammar coach** | Corrects your sentences with explanations, tracks conversation history |
| 💬 **Conversation** | Free-form chat practice with corrections and follow-up questions |
| 🧩 **AI Quiz** | `/quiz` — exactly 20 AI-generated questions at your level, 4-button answers, full wrong-answer analysis |
| 📊 **Progress tracking** | XP system, streak counter, level display |
| 🔒 **Self-hosted** | Your data stays on your server, no third-party SaaS |

---

## 🏗 Stack

```
Telegram  ──webhook──▶  n8n (Docker)  ──▶  Claude API (Anthropic)
                              │
                    ┌─────────┴──────────┐
                 PostgreSQL            Redis
               (users, vocab,       (sessions,
                progress)           conv history)
```

- **[n8n](https://n8n.io)** — no-code workflow engine, all bot logic as visual flows
- **[Claude API](https://anthropic.com)** — Haiku model for fast, cheap AI responses
- **[DigitalOcean](https://digitalocean.com)** — $6/mo Droplet is enough
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** — free HTTPS webhook, no domain needed

---

## 🚀 Quick Start

### Prerequisites

- A DigitalOcean Droplet (Ubuntu 22.04, 2 GB RAM minimum)
- [Telegram Bot Token](https://t.me/BotFather)
- [Anthropic API Key](https://console.anthropic.com)
- Docker + Docker Compose installed on the server

### 1. Clone & configure

```bash
git clone https://github.com/romasky/language_tutor.git
cd language_tutor
cp .env.example .env
# Edit .env and fill in all values
```

### 2. Deploy to server

```bash
DROPLET_IP=your.server.ip bash scripts/deploy.sh
```

### 3. Import workflow

Open `http://YOUR_SERVER_IP:5678` → **Settings → Import Workflow** → upload `n8n/workflows/01_webhook_router.json`.

Add credentials in n8n:
- **Telegram Bot** — your bot token
- **Postgres** — connection to the DB container
- **Redis** — connection to the Redis container

### 4. Set Telegram webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=YOUR_WEBHOOK_URL"
```

> See [Wiki: Setup](../../wiki/Setup) for the full step-by-step guide.

---

## 🤖 Bot Commands

```
/start     Start learning — language selection + level assessment
/word      Look up any word:  /word ambitious
/talk      Conversation practice session
/quiz      20-question AI quiz at your level, with result analysis
/progress  Your XP, streak, and current level
/level     Change your learning level (A1 → C1)
/help      Command reference
```

---

## 🗂 Project Structure

```
language-tutor-bot/
├── docker-compose.yml          — service definitions
├── .env.example                — all required env variables
├── nginx/
│   └── default.conf            — reverse proxy config
├── n8n/
│   └── workflows/
│       └── 01_webhook_router.json   — main bot workflow (~100 nodes)
├── db/
│   └── migrations/             — PostgreSQL schema (additive only)
├── prompts/                    — Claude system prompts (markdown)
└── scripts/
    ├── deploy.sh               — one-command deploy
    └── backup.sh               — DB + workflow backup
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill in all values:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `ANTHROPIC_API_KEY` | From [Anthropic Console](https://console.anthropic.com) |
| `N8N_ENCRYPTION_KEY` | Run `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Choose a strong password |
| `N8N_BASIC_AUTH_USER` | n8n UI login |
| `N8N_BASIC_AUTH_PASSWORD` | n8n UI password |
| `ELEVENLABS_API_KEY` | Optional — for word pronunciation audio |

---

## 📖 Documentation

Full documentation is in the [GitHub Wiki](../../wiki):

- [**Home**](../../wiki/Home) — overview and architecture
- [**Setup**](../../wiki/Setup) — server setup from scratch
- [**Configuration**](../../wiki/Configuration) — all env variables explained
- [**Usage**](../../wiki/Usage) — how to use the bot
- [**Troubleshooting**](../../wiki/Troubleshooting) — common issues and fixes

---

## 🛣 Roadmap

- [x] `/quiz` — AI-generated 20-question quiz with 4-button answers and result analysis
- [ ] Voice dictation (Whisper STT)
- [ ] Daily lesson scheduler with flashcards
- [ ] Word pronunciation audio (ElevenLabs)
- [ ] SM-2 spaced repetition for vocabulary
- [ ] Admin dashboard

---

## 📄 License

MIT — fork it, deploy it, teach yourself anything.
