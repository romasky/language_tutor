# Language Tutor Bot — Wiki

Welcome to the documentation for **Language Tutor Bot**, a self-hosted AI language tutor on Telegram.

## Pages

| Page | Description |
|---|---|
| [Setup](Setup) | Server provisioning, Docker, first deploy |
| [Configuration](Configuration) | All environment variables explained |
| [Usage](Usage) | How to use the bot as a student |
| [Troubleshooting](Troubleshooting) | Common issues and how to fix them |

## Architecture Overview

```
User (Telegram)
      │  HTTPS webhook
      ▼
Cloudflare Tunnel
      │
      ▼
n8n (Docker, port 5678)
      │
      ├──► Claude API (Anthropic)   — AI responses
      ├──► PostgreSQL               — users, vocabulary, progress
      └──► Redis                    — sessions, conversation history
```

### Bot Flow

Every message follows this path inside n8n:

```
Telegram Trigger
  → Prepare User          extract userId, firstName, language_code
  → Get User (Postgres)   upsert user row, read level/langs/xp
  → Get Session (Redis)   read current session state
  → Router (Code node)    decide route based on text/cbData/session
  → IF chain              branch to the right handler
  → Claude API            generate response
  → Telegram Send         deliver message
```

### Session States (Redis)

| Key | Value | Meaning |
|---|---|---|
| `session:{userId}` | `onboarding` | User is in level assessment |
| `session:{userId}` | `conversation` | Active `/talk` session |
| `session:{userId}` | `word_input` | Waiting for word after menu tap |
| `session:{userId}` | `grammar_input` | Waiting for sentence to check |
| `onboarding:{userId}` | JSON array | Onboarding conversation history |
| `grammar:{userId}` | JSON array | Grammar conversation history |
