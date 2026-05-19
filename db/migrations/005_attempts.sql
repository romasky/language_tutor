CREATE TABLE IF NOT EXISTS attempts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  prompt       TEXT,
  response     TEXT,
  score        INT CHECK (score >= 0 AND score <= 100),
  details      JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user      ON attempts(user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_type_date ON attempts(type, created_at DESC);
