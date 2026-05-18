#!/bin/bash
set -euo pipefail

APP_DIR="/opt/english-bot"
BACKUP_DIR="/tmp/english-bot-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="english_bot_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Load env vars
if [ -f "${APP_DIR}/.env" ]; then
  set -a
  source "${APP_DIR}/.env"
  set +a
fi

echo "→ Dumping PostgreSQL database..."
docker exec english_teacher_postgres_1 \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

echo "→ Uploading to DO Spaces (${DO_SPACES_BUCKET})..."
AWS_ACCESS_KEY_ID="${DO_SPACES_KEY}" \
AWS_SECRET_ACCESS_KEY="${DO_SPACES_SECRET}" \
aws s3 cp \
  "${BACKUP_DIR}/${BACKUP_FILE}" \
  "s3://${DO_SPACES_BUCKET}/backups/${BACKUP_FILE}" \
  --endpoint-url "${DO_SPACES_ENDPOINT}" \
  --region "${DO_SPACES_REGION}"

echo "→ Cleaning up old local backups (keep 7 days)..."
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +7 -delete

echo "✓ Backup complete: ${BACKUP_FILE}"
