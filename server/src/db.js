import Database from 'better-sqlite3';

// SQLite keeps setup to zero. The SQL below is portable to PostgreSQL (see NOTES.md).
const db = new Database(process.env.DB_PATH || 'passline.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','organizer')),
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ticket_code TEXT NOT NULL UNIQUE,
  cert_id TEXT UNIQUE,
  registered_at TEXT NOT NULL DEFAULT (${NOW}),
  checked_in_at TEXT,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
CREATE TABLE IF NOT EXISTS volunteers (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  assignee_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_task_event ON tasks(event_id);
`);

export default db;
