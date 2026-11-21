-- Invite links: the owner sends someone a private sign-in link, so they can log in without Google.
-- Each link works once, for 14 days. Only a hash of the link's secret is stored.
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS invites_user ON invites(user_id);
