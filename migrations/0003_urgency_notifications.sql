-- Urgency on messages, a "handled" mark, the owner's notification and contact settings,
-- phone notification subscriptions, a log of notifications, and reply drafts from agents.
-- Run after 0002 (D1 console or wrangler d1 execute).

ALTER TABLE posts ADD COLUMN urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'soon', 'urgent'));
ALTER TABLE posts ADD COLUMN handled_at TEXT;
CREATE INDEX IF NOT EXISTS posts_urgency ON posts(urgency, handled_at);

-- Owner settings as key/value: studio hours, when to notify, and whether urgent messages may offer a text.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Devices that receive phone notifications (the owner's installed app).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);

-- Every notification decision, sent or held, so the owner can see what happened and why.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  urgency TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Agents can draft a reply; the owner edits it if needed and sends it with the approval.
ALTER TABLE proposals ADD COLUMN reply_draft TEXT;
ALTER TABLE proposals ADD COLUMN reply_post_id TEXT;
