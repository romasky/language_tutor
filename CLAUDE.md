# CLAUDE.md — Language Tutor Bot

> Context file for Claude Code when working on this project in the IDE.

---

## Project Goal

A Telegram bot for personalized language learning.
Stack: **n8n** (orchestration) + **DigitalOcean** (infrastructure) + **Claude API / Whisper / ElevenLabs** (AI).

---

## Architecture

```
Telegram User
     │ webhook
     ▼
n8n (Droplet, Docker)
     ├── Router → [Vocabulary]    → Claude API → TG Send
     ├── Router → [Grammar]       → Claude API → TG Send
     ├── Router → [Conversation]  → Claude API → TG Send
     ├── Router → [Dictation]     → Whisper STT → compare → TG Send
     ├── Router → [Word Audio]    → ElevenLabs TTS → TG Audio
     └── Scheduler → [Daily Lesson] → flashcards / quiz → TG Send
          │
          ├── PostgreSQL  (progress, vocabulary, user profile)
          ├── Redis        (sessions, conversation history)
          └── DO Spaces    (Whisper / ElevenLabs audio files)
```

---

## Repository Structure

```
language-tutor-bot/
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── default.conf           ← reverse proxy config
├── n8n/
│   └── workflows/
│       └── 01_webhook_router.json   ← main monolithic workflow (all logic)
├── db/
│   └── migrations/
│       ├── 001_users.sql
│       ├── 002_vocabulary.sql
│       ├── 003_progress.sql
│       └── 004_lang_columns.sql
├── prompts/
│   ├── vocabulary.md
│   ├── grammar.md
│   └── conversation.md
└── scripts/
    ├── deploy.sh
    └── backup.sh
```

---

## Production Architecture

The live bot runs as a **single monolithic n8n workflow** (`01_webhook_router.json`, ~80 nodes).
All logic lives in one workflow — not the multi-workflow executeWorkflow architecture shown in other JSON files.

**Flow:**
```
Telegram Trigger → Prepare User → Get User (Postgres) → Get Session (Redis)
→ Router (Code node) → IF chain → Claude/Telegram nodes
```

**Router sets `route` field:**
- `/word ambitious` → `route: vocabulary`
- `/talk` → `route: conversation`
- `/start` (new user) → `route: start` → language selection → onboarding
- `/start` (returning) → `route: start_existing`
- single word (no slash) → `route: vocabulary`
- `session=conversation` → `route: conversation`
- fallback → `route: grammar`

---

## n8n 2.20 Critical Notes

- **PATCH ≠ publish**: PATCH updates `versionId` (draft) but execution uses `activeVersionId`
- **To deploy**: after PATCH, call `POST /rest/workflows/{id}/activate` with `{"versionId": "..."}`
- **Expression syntax**: `={{ $json.field }}` in `body` field — use Code node to build JSON string first
- **activeVersion**: separate from current version, stores the compiled execution snapshot

---

## First Deploy

```bash
# 1. Create DigitalOcean Droplet (Ubuntu 22.04, 2GB+ RAM)
ssh root@YOUR_DROPLET_IP
curl -fsSL https://get.docker.com | sh

# 2. Copy environment file
scp .env root@YOUR_DROPLET_IP:/opt/language-bot/.env

# 3. Deploy
DROPLET_IP=YOUR_DROPLET_IP bash scripts/deploy.sh

# 4. Import workflow in n8n UI
# Open http://YOUR_DROPLET_IP:5678 → Import Workflow
# Upload n8n/workflows/01_webhook_router.json
# Add credentials: Telegram Bot, PostgreSQL, Redis

# 5. Set Telegram webhook
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://YOUR_TUNNEL_URL/webhook/WEBHOOK_ID/webhook"
```

Generate `N8N_ENCRYPTION_KEY`:
```bash
openssl rand -hex 32
```

---

## SM-2 Algorithm (SuperMemo)

Used in n8n Code nodes for spaced repetition scheduling:

```javascript
function sm2(easeFactor, interval, quality) {
  if (quality < 3) return { interval: 1, easeFactor };
  const newInterval = interval === 1 ? 6 : Math.round(interval * easeFactor);
  const newEF = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return { interval: newInterval, easeFactor: newEF };
}
// quality: 0=didn't know, 3=hard, 5=easy
```

---

## Bot Commands

```
/start    — Start learning / show menu
/word     — Look up a word: /word ambitious
/talk     — Start conversation practice
/quiz     — Quiz on saved words
/progress — My progress and stats
/level    — Change level (A1–C1)
/help     — Command reference
```

---

## Development Conventions

- Claude prompts live in `/prompts/*.md`, never hardcoded in workflows.
- Secrets via `.env` only — never in code or workflow JSON.
- Export each n8n workflow to JSON after changes.
- Errors logged via n8n Error Workflow → admin Telegram channel.
- SQL migrations additive only (new tables/columns), no DROP.
- nginx `client_max_body_size 25M` — Telegram voice messages up to ~20MB.
- Language detection: `native_lang` from DB → Telegram `language_code` fallback → `'en'`.

---

## Development Status

- [x] Infrastructure: Droplet + Docker Compose + nginx
- [x] Telegram Bot: created, webhook configured (Cloudflare tunnel)
- [x] Workflow 01: Webhook → Router (monolithic, ~80 nodes)
- [x] Vocabulary mode (Claude API)
- [x] Grammar mode with conversation history (Claude API)
- [x] Conversation mode `/talk`
- [x] Onboarding: level assessment via 4-question AI interview
- [x] Multilingual UI: 14 native languages, 80+ target languages
- [x] Native language auto-detection from Telegram language_code
- [x] Progress page and level change
- [x] XP system
- [ ] Dictation (Whisper STT)
- [ ] Daily lesson scheduler
- [ ] ElevenLabs word pronunciation
- [ ] SM-2 spaced repetition
- [ ] /quiz command
