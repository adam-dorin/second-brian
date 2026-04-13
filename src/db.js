import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.BRAIN_DB_PATH ?? join(__dirname, "..", "brain.sqlite");

let _db = null;

export function getDb(path = DB_PATH) {
  if (_db) return _db;

  const db = new Database(path);
  sqliteVec.load(db);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  migrate(db);

  _db = db;
  return db;
}

/** Used in tests to get a fresh in-memory database each time. */
export function openDb(path = ":memory:") {
  const db = new Database(path);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
  `);

  const row = db.prepare("SELECT version FROM schema_version").get();
  const version = row?.version ?? 0;

  if (version < 1) {
    db.exec(`
      -- Configurable contexts
      CREATE TABLE IF NOT EXISTS contexts (
        name TEXT PRIMARY KEY,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Primary thoughts table
      CREATE TABLE IF NOT EXISTS thoughts (
        id            INTEGER PRIMARY KEY,
        text          TEXT NOT NULL,
        context       TEXT REFERENCES contexts(name),
        project       TEXT,
        topics        TEXT DEFAULT '[]',  -- JSON array
        people        TEXT DEFAULT '[]',  -- JSON array
        action_items  TEXT DEFAULT '[]',  -- JSON array
        type          TEXT,               -- "observation"|"task"|"idea"|"reference"
        lang          TEXT DEFAULT 'en',  -- "en"|"ro"|"mixed"
        -- quality fields
        confidence    TEXT DEFAULT 'medium', -- "high"|"medium"|"low"
        source_type   TEXT DEFAULT 'firsthand', -- "firsthand"|"secondhand"|"read"|"assumed"
        verified      INTEGER DEFAULT 0,
        staleness     TEXT DEFAULT 'stable', -- "stable"|"versioned"|"volatile"
        version_ref   TEXT,
        -- usage tracking
        hit_count     INTEGER DEFAULT 0,
        last_hit      TEXT,
        confirmed_at  TEXT,
        disputed_at   TEXT,
        reviewed_at   TEXT,
        -- embed status
        embedded      INTEGER DEFAULT 0,
        vec_rowid     INTEGER,
        created_at    TEXT DEFAULT (datetime('now'))
      );

      -- Vector table for thoughts
      CREATE VIRTUAL TABLE IF NOT EXISTS thoughts_vec USING vec0(
        embedding float[384]
      );

      INSERT OR REPLACE INTO schema_version (version) VALUES (1);
    `);
  }
}

export function getContexts(db) {
  return db.prepare("SELECT name, description FROM contexts ORDER BY name").all();
}

export function addContext(db, name, description = null) {
  db.prepare("INSERT INTO contexts (name, description) VALUES (?, ?)").run(name, description);
}

export function removeContext(db, name) {
  db.prepare("DELETE FROM contexts WHERE name = ?").run(name);
}

export function contextExists(db, name) {
  return !!db.prepare("SELECT 1 FROM contexts WHERE name = ?").get(name);
}
