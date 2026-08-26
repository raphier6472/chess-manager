import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH ?? path.join(dataDir, "chess-manager.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    num_rounds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'setup'
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    withdrawn INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    white_id TEXT NOT NULL REFERENCES players(id),
    black_id TEXT REFERENCES players(id),
    result TEXT NOT NULL DEFAULT 'unplayed'
  );

  CREATE INDEX IF NOT EXISTS idx_players_tournament ON players(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_tournament ON rounds(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

// Migration: split the old single "name" column into last_name/first_name.
// Pairing and standings sort surname-first, so the split has to be real
// columns rather than parsed out of a free-text name at query time.
const playerColumns = db.prepare("PRAGMA table_info(players)").all() as Array<{ name: string }>;
const hasOldNameColumn = playerColumns.some((c) => c.name === "name");
const hasLastNameColumn = playerColumns.some((c) => c.name === "last_name");
if (hasOldNameColumn && !hasLastNameColumn) {
  db.exec("ALTER TABLE players ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE players ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");

  const rows = db.prepare("SELECT id, name FROM players").all() as Array<{ id: string; name: string }>;
  const update = db.prepare("UPDATE players SET last_name = ?, first_name = ? WHERE id = ?");
  const migrate = db.transaction(() => {
    for (const row of rows) {
      const parts = row.name.trim().split(/\s+/).filter(Boolean);
      // "Nombre Apellido" free text: last word is treated as the surname,
      // everything before it as the given name(s). A single word becomes
      // just the surname, since that's the field pairing sorts on.
      const lastName = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? "");
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
      update.run(lastName, firstName, row.id);
    }
  });
  migrate();

  db.exec("ALTER TABLE players DROP COLUMN name");
}
