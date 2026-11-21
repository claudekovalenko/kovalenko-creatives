// A stand-in for Cloudflare D1 built on Node's own SQLite (node:sqlite), so the portal runs and is
// tested locally with nothing installed. It covers the parts of the D1 API the portal uses:
// prepare().bind().first() / .all() / .run(), and batch().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

process.removeAllListeners('warning'); // node:sqlite prints an "experimental" warning on every run

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params.map(p => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)));
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] : plain;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params).map(r => ({ ...r })), success: true };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function localD1(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  // Apply each migration once, in order (the local database file remembers which ran).
  db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  const done = new Set(db.prepare('SELECT name FROM _local_migrations').all().map(r => r.name));
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec(readFileSync(new URL(f, dir), 'utf8'));
    db.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run(f);
  }
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
