-- Migration 006: Daily Lesson Scheduler with Flashcards
-- Additive only. No DROP. All statements idempotent (IF NOT EXISTS / IF NOT EXISTS).

-- ── vocabulary: SM-2 repetitions counter ─────────────────────────────────────
-- Standard SM-2 needs n (repetitions) to distinguish:
--   n=0 → interval=1, n=1 → interval=6, n>=2 → interval=round(interval*ef)
ALTER TABLE vocabulary
  ADD COLUMN IF NOT EXISTS repetitions INT DEFAULT 0;

-- ── users: timezone, opt-in, preferred lesson hour ───────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS utc_offset    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_opted_in   BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lesson_hour   SMALLINT NOT NULL DEFAULT 9;
-- utc_offset: integer hours offset from UTC, range -12..+14
-- lesson_hour: preferred local hour for daily push (0-23), default 9am
-- is_opted_in: false = unsubscribed from daily lessons

CREATE INDEX IF NOT EXISTS idx_users_opted_lesson
  ON users(is_opted_in, utc_offset)
  WHERE is_opted_in = true;

-- ── daily_lesson_sessions: durable session record ────────────────────────────
-- Guards against double-send on scheduler retry (idempotency).
-- Persists session metadata so analytics/streak work even if Redis is flushed.
CREATE TABLE IF NOT EXISTS daily_lesson_sessions (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  card_count   SMALLINT     NOT NULL DEFAULT 0,
  correct      SMALLINT     NOT NULL DEFAULT 0,
  xp_awarded   INT          NOT NULL DEFAULT 0,
  status       TEXT         NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'in_progress', 'completed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_dls_user_started
  ON daily_lesson_sessions(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_dls_status_date
  ON daily_lesson_sessions(status, started_at DESC);

-- Backfill: ensure existing rows have repetitions = 0 (not NULL)
UPDATE vocabulary SET repetitions = 0 WHERE repetitions IS NULL;
