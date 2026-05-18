# Configuration

All configuration is done via the `.env` file. Copy `.env.example` to `.env` and fill in the values.

## Required Variables

### Telegram

| Variable | Example | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `7123456789:AAF...` | From [@BotFather](https://t.me/BotFather) |

### AI

| Variable | Example | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude API key from [console.anthropic.com](https://console.anthropic.com) |

### n8n

| Variable | Example | Description |
|---|---|---|
| `N8N_HOST` | `0.0.0.0` | Bind address |
| `N8N_PORT` | `5678` | n8n HTTP port |
| `N8N_PROTOCOL` | `http` | `http` or `https` |
| `N8N_WEBHOOK_URL` | `https://your-tunnel.trycloudflare.com` | Public URL for webhooks |
| `N8N_ENCRYPTION_KEY` | *(run `openssl rand -hex 32`)* | Encrypts stored credentials |
| `N8N_BASIC_AUTH_USER` | `admin` | n8n UI login |
| `N8N_BASIC_AUTH_PASSWORD` | *(strong password)* | n8n UI password |

### PostgreSQL

| Variable | Example | Description |
|---|---|---|
| `POSTGRES_HOST` | `postgres` | Docker service name |
| `POSTGRES_PORT` | `5432` | Default Postgres port |
| `POSTGRES_DB` | `languagebot` | Database name |
| `POSTGRES_USER` | `botuser` | DB username |
| `POSTGRES_PASSWORD` | *(strong password)* | DB password |

### Redis

| Variable | Example | Description |
|---|---|---|
| `REDIS_HOST` | `redis` | Docker service name |
| `REDIS_PORT` | `6379` | Default Redis port |

## Optional Variables

### ElevenLabs (word pronunciation audio)

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | API key from [elevenlabs.io](https://elevenlabs.io) |
| `ELEVENLABS_VOICE_ID` | Voice ID to use for TTS |

### OpenAI (Whisper dictation — future feature)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | For Whisper speech-to-text |

## Allowed Users

The Router node has an `ALLOWED_USERS` array:

```javascript
const ALLOWED_USERS = [185674280];
```

Edit this array in the n8n workflow's Router Code node to add Telegram user IDs.
To allow everyone, replace the check with `if (false)` or remove the block.

## Claude Model

The bot uses `claude-haiku-4-5` by default (fast and cheap). To switch models, update the `model` field in these Code nodes:

- `Prep Vocab Request`
- `Prep Conv Request`
- `Prep Grammar Request`
- `Onboarding First Message`
- `Onboarding Claude`

Available options: `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7`
