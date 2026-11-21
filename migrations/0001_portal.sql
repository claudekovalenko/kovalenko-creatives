-- Members portal: schema for the Cloudflare D1 database bound as DB.
-- Apply once: in the Cloudflare dashboard (D1 > kovalenko-creatives-hub > Console) or
-- `npx wrangler d1 execute kovalenko-creatives-hub --remote --file migrations/0001_portal.sql`.

PRAGMA foreign_keys = ON;

-- People who signed in with Google. Nobody sees anything until the owner approves them.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
  request_note TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  last_seen_at TEXT
);

-- Sign-in sessions. Only a hash of the cookie value is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Development plans. A member sees a plan's contents only after the owner approves them for it.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  listed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_members (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note TEXT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  PRIMARY KEY (plan_id, user_id)
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS phases_plan ON phases(plan_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  position REAL NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_plan ON tasks(plan_id, position);

-- Everything people write on a plan: chat messages, task comments (task_id set),
-- owner progress updates and member ideas.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'update', 'idea')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_plan ON posts(plan_id, kind, created_at);
CREATE INDEX IF NOT EXISTS posts_task ON posts(task_id);

-- Bots that watch activity and propose work. Each has its own token; only a hash is stored.
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

-- What agents send the owner: "I can fix this", summaries, notes. Nothing happens until the owner approves.
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fix', 'summary', 'note')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'declined', 'in_progress', 'done')),
  owner_note TEXT,
  agent_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_status ON proposals(status, created_at);

-- Append-only feed of what happened. Agents read it with an increasing id as a cursor.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_plan ON activity(plan_id, id);
