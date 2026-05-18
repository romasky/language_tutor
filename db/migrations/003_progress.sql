CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT,                         -- vocabulary / grammar / conversation / dictation
  score      INT,                          -- 0-100
  details    JSONB,                        -- errors, correct answers
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(user_id, created_at DESC);
