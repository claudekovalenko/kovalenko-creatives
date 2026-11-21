// Makes the owner's first sign-in link, for before Google sign-in is set up.
//   node tools/owner-link.mjs you@gmail.com "Your Name" https://<portal address>
// Prints SQL to run once in the D1 console, and the link to open. The owner account it creates
// matches OWNER_EMAILS by email, so Google sign-in later lands in the same account.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const [email, name, origin] = process.argv.slice(2);
if (!email || !name || !origin) {
  console.error('Usage: node tools/owner-link.mjs you@gmail.com "Your Name" https://<portal address>');
  process.exit(1);
}
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const now = new Date().toISOString();
const expires = new Date(Date.now() + 14 * 86400_000).toISOString();
const q = v => `'${String(v).replace(/'/g, "''")}'`;
const id = randomUUID().replace(/-/g, '').slice(0, 16);
console.log(`-- Run once in the D1 console:
INSERT INTO users (id, email, name, role, status, created_at, approved_at) VALUES (${q(id)}, ${q(email.toLowerCase())}, ${q(name)}, 'owner', 'approved', ${q(now)}, ${q(now)})
  ON CONFLICT (email) DO UPDATE SET role = 'owner', status = 'approved';
INSERT INTO invites (token_hash, user_id, created_at, expires_at) SELECT ${q(hash)}, id, ${q(now)}, ${q(expires)} FROM users WHERE email = ${q(email.toLowerCase())};

-- Then open this link (works once, for 14 days):
-- ${origin.replace(/\/$/, '')}/auth/invite?t=${token}`);
