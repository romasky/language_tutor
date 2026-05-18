CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,        -- Telegram user_id
  username      TEXT,
  first_name    TEXT,
  level         TEXT DEFAULT 'A1',        -- A1 / A2 / B1 / B2 / C1
  streak        INT  DEFAULT 0,
  total_xp      INT  DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);
