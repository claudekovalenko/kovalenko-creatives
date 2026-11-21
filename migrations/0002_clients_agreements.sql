-- Clients, agreements, payments, extra-work log, unread tracking and short versions of long posts.
-- Run after 0001_portal.sql (same way: D1 console or wrangler d1 execute).

-- Each client is a silo: their people only ever see that client's plans.
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE users ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE plans ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

-- The agreement for a plan: terms text, status, and who accepted it when.
-- draft = only the owner sees it; shared = the client can read and accept it; accepted = agreed.
ALTER TABLE plans ADD COLUMN terms TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN agreement_status TEXT NOT NULL DEFAULT 'draft' CHECK (agreement_status IN ('draft', 'shared', 'accepted'));
ALTER TABLE plans ADD COLUMN accepted_at TEXT;
ALTER TABLE plans ADD COLUMN accepted_by TEXT;

-- What is included: the list of things the studio agrees to deliver.
CREATE TABLE IF NOT EXISTS scope_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scope_plan ON scope_items(plan_id, position);

-- What the client pays and when. Amounts are whole cents. Unpaid lines make up the balance owed.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date TEXT,
  paid_at TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_plan ON payments(plan_id, position);

-- Work done outside the agreement, logged as it happens, charged now, later or never.
CREATE TABLE IF NOT EXISTS extras (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  hours REAL,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  billing TEXT NOT NULL DEFAULT 'unbilled' CHECK (billing IN ('unbilled', 'billed', 'no_charge')),
  visible INTEGER NOT NULL DEFAULT 1,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS extras_plan ON extras(plan_id, work_date);

-- When each person last read each plan's chat, for unread counts.
CREATE TABLE IF NOT EXISTS plan_reads (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, user_id)
);

-- A short version of long posts, written by Claude when ANTHROPIC_API_KEY is set.
ALTER TABLE posts ADD COLUMN summary TEXT;
