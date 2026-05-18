# Troubleshooting

## Bot doesn't respond

**Check webhook registration:**
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
Look for `"url"` — it should match your tunnel URL. If empty, re-register.

**Check n8n workflow is active:**
Open n8n UI → the workflow toggle should be ON (green).

**Check n8n executions:**
Open n8n UI → Executions tab. If you see errors, click the execution to inspect which node failed.

---

## n8n workflow changes don't take effect

n8n 2.20+ uses two version IDs:
- `versionId` — the draft (updated by PATCH/save)
- `activeVersionId` — the live version running on webhooks

After saving, you must **publish** the workflow:

```bash
# 1. Get current versionId
curl -s http://SERVER:5678/rest/workflows/WORKFLOW_ID -b cookies.txt | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['versionId'])"

# 2. Activate with that versionId
curl -s -X POST http://SERVER:5678/rest/workflows/WORKFLOW_ID/activate \
  -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"versionId":"THE_VERSION_ID"}'
```

Or simply toggle the workflow off and on again in the n8n UI.

---

## "Bad Request: message text is empty" error

This means an n8n expression evaluated to an empty string before being sent to Telegram.

Common causes:
- An `={{ ... }}` expression referencing a node that didn't run in this execution path
- Missing `{{` — n8n requires `={{ expr }}` (double curly), not `={ expr }`

Check the failing node's input/output in the Executions panel.

---

## Bot responds in the wrong language

The language chain is:
1. `native_lang` column in Postgres (set during onboarding)
2. `language_code` from Telegram `from` object (fallback)
3. `'en'` (last resort)

If the user is getting responses in the wrong language:
- Check their `native_lang` in the DB: `SELECT id, native_lang, target_lang FROM users WHERE id = USER_ID;`
- If null, the bot should prompt language selection on next `/start`
- They can reset with `/start` → "Change language"

---

## Database connection errors

```bash
# Check containers are running
docker compose ps

# Check Postgres logs
docker compose logs postgres

# Test connection manually
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;"
```

---

## Redis session stuck

If a user is stuck in an unexpected mode (e.g. always going to grammar when they want vocabulary):

```bash
# Connect to Redis
docker compose exec redis redis-cli

# Check session
GET session:USER_TELEGRAM_ID

# Clear session
DEL session:USER_TELEGRAM_ID
```

---

## n8n login / session expired

```bash
curl -s -X POST "http://SERVER:5678/rest/login" \
  -H "Content-Type: application/json" \
  -d '{"emailOrLdapLoginId":"your@email.com","password":"yourpassword"}' \
  -c /tmp/n8n_cookies.txt
```

---

## Workflow import fails

- Make sure the workflow JSON is from the same or compatible n8n version
- After import, re-add credentials (credentials are not exported for security)
- Re-activate the workflow after import

---

## Quiz issues

**Quiz gets stuck / no result after last answer**

Check the `Process Quiz Answer` node in the Executions panel. If it errored with `Cannot read properties of undefined ('correct')`, it means a duplicate button press corrupted the answers array. Clear the stale state:

```bash
docker compose exec redis redis-cli -a $REDIS_PASSWORD DEL quiz:USER_TELEGRAM_ID session:USER_TELEGRAM_ID
```

**Quiz shows fewer than 20 questions**

Claude sometimes returns 19 items if the prompt is malformed. The `Save Quiz` node will throw a hard error — check n8n Executions. This was caused by template literals (backticks) inside `={{ }}` expressions, which n8n rejects at runtime. Always use string concatenation in n8n expressions.

**"Preparing quiz" message appears but quiz never starts**

`Generate Quiz` or `Save Quiz` failed. Open the execution, check which node errored. Common cause: Claude returned malformed JSON — the regex extractor in `Save Quiz` couldn't find a valid array.

---

## Check server resources

```bash
# Memory and CPU
htop

# Docker container stats
docker stats

# Disk space
df -h
```

If RAM is low (<200MB free), n8n may crash. Upgrade to a 2GB+ Droplet or add swap:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
```
