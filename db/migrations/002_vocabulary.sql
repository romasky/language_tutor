CREATE TABLE IF NOT EXISTS vocabulary (
  id          SERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  word        TEXT NOT NULL,
  translation TEXT,
  context     TEXT,                        -- sentence where the word was encountered
  ease_factor FLOAT DEFAULT 2.5,           -- SuperMemo SM-2 algorithm
  interval    INT   DEFAULT 1,             -- days until next review
  next_review TIMESTAMPTZ DEFAULT NOW(),
  added_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocab_review ON vocabulary(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_vocab_user ON vocabulary(user_id);
